use crate::config::Config;
use crate::error::{BotError, Result};
use crate::monitoring::{AlertThresholds, MonitoringSystem};
use crate::pumpportal::{PumpPortalClient, TokenInfo};
use crate::strategies::{StrategyConfig, StrategyEngine, TradingStrategy};
use crate::trading::{TradingEngine, Trade};
use crate::wallet::WalletManager;
use log::{error, info, warn};
use std::collections::HashMap;
use tokio::time::{sleep, Duration};

pub struct TradingBot {
    config: Config,
    wallet: WalletManager,
    pumpportal: PumpPortalClient,
    strategy_engine: StrategyEngine,
    trading_engine: TradingEngine,
    monitoring: MonitoringSystem,
    dry_run: bool,
    running: bool,
}

impl TradingBot {
    pub async fn new(config: Config, dry_run: bool) -> Result<Self> {
        // Initialize wallet
        let wallet = if std::path::Path::new(&config.wallet_path).exists() {
            WalletManager::from_file(&config.wallet_path)?
        } else {
            warn!("Wallet file not found, generating new wallet");
            let wallet = WalletManager::generate_new()?;
            // Save the new wallet
            wallet.get_keypair().write_to_file(&config.wallet_path)
                .map_err(|e| BotError::Wallet(format!("Failed to save wallet: {}", e)))?;
            wallet
        };
        
        info!("Wallet address: {}", wallet.get_address());
        
        // Initialize PumpPortal client
        let pumpportal = PumpPortalClient::new(
            config.pumpportal.api_url.clone(),
            config.pumpportal.api_key.clone(),
            config.pumpportal.refresh_interval_ms,
        );
        
        // Initialize strategy engine
        let strategies = vec![
            StrategyConfig {
                strategy: TradingStrategy::Momentum,
                parameters: HashMap::new(),
                enabled: true,
            },
            StrategyConfig {
                strategy: TradingStrategy::VolumeSpike,
                parameters: HashMap::new(),
                enabled: true,
            },
            StrategyConfig {
                strategy: TradingStrategy::HolderGrowth,
                parameters: HashMap::new(),
                enabled: true,
            },
        ];
        let strategy_engine = StrategyEngine::new(strategies);
        
        // Initialize trading engine
        let trading_engine = TradingEngine::new(
            &wallet,
            config.trading.max_positions,
            config.trading.max_buy_amount,
            config.trading.max_sell_amount,
            config.trading.profit_target_percent,
            config.trading.stop_loss_percent,
            config.trading.cooldown_seconds,
        );
        
        // Initialize monitoring system
        let monitoring = MonitoringSystem::new(
            config.monitoring.webhook_url.clone(),
            config.monitoring.alert_thresholds.clone(),
        );
        
        Ok(Self {
            config,
            wallet,
            pumpportal,
            strategy_engine,
            trading_engine,
            monitoring,
            dry_run,
            running: false,
        }
    }
    
    pub async fn run(&mut self) -> Result<()> {
        self.running = true;
        info!("Starting trading bot (dry_run: {})", self.dry_run);
        
        // Start monitoring loop
        let mut last_check = std::time::Instant::now();
        
        while self.running {
            // Check for new tokens
            if let Err(e) = self.check_new_tokens().await {
                error!("Error checking new tokens: {}", e);
            }
            
            // Check exit conditions for existing positions
            if let Err(e) = self.check_exit_conditions().await {
                error!("Error checking exit conditions: {}", e);
            }
            
            // Update monitoring metrics
            self.update_monitoring().await;
            
            // Sleep for refresh interval
            sleep(Duration::from_millis(self.config.pumpportal.refresh_interval_ms)).await;
            
            // Periodic status update
            if last_check.elapsed().as_secs() >= 60 {
                self.log_status().await;
                last_check = std::time::Instant::now();
            }
        }
        
        info!("Trading bot stopped");
        Ok(())
    }
    
    async fn check_new_tokens(&mut self) -> Result<()> {
        // Get new tokens from PumpPortal
        let tokens = self.pumpportal.get_new_tokens().await?;
        
        // Filter tokens based on criteria
        let filtered_tokens = self.pumpportal.filter_tokens_by_criteria(
            tokens,
            self.config.pumpportal.min_market_cap,
            self.config.pumpportal.max_market_cap,
            self.config.pumpportal.min_holders,
            self.config.pumpportal.max_age_hours,
        ).await;
        
        info!("Found {} new tokens matching criteria", filtered_tokens.len());
        
        // Analyze each token
        for token in filtered_tokens {
            if let Err(e) = self.analyze_and_trade_token(token).await {
                error!("Error analyzing token: {}", e);
            }
        }
        
        Ok(())
    }
    
    async fn analyze_and_trade_token(&mut self, token: TokenInfo) -> Result<()> {
        info!("Analyzing token: {} ({})", token.symbol, token.address);
        
        // Get trading signals from strategy engine
        let signals = self.strategy_engine.analyze_token(&token)?;
        
        if signals.is_empty() {
            log::debug!("No trading signals for token {}", token.symbol);
            return Ok(());
        }
        
        // Execute signals
        for signal in signals {
            if signal.confidence < 0.5 {
                log::debug!("Low confidence signal for {}: {:.2}", token.symbol, signal.confidence);
                continue;
            }
            
            info!(
                "Executing {} signal for {}: {} (confidence: {:.2})",
                signal.action, token.symbol, signal.reason, signal.confidence
            );
            
            if !self.dry_run {
                if let Some(trade) = self.trading_engine.execute_signal(signal).await? {
                    self.trading_engine.add_trade(trade);
                    info!("Trade executed successfully");
                }
            } else {
                info!("DRY RUN: Would execute trade");
            }
        }
        
        Ok(())
    }
    
    async fn check_exit_conditions(&mut self) -> Result<()> {
        let exit_signals = self.trading_engine.check_exit_conditions().await?;
        
        for signal in exit_signals {
            info!("Exit condition triggered: {}", signal.reason);
            
            if !self.dry_run {
                if let Some(trade) = self.trading_engine.execute_signal(signal).await? {
                    self.trading_engine.add_trade(trade);
                    info!("Exit trade executed successfully");
                }
            } else {
                info!("DRY RUN: Would execute exit trade");
            }
        }
        
        Ok(())
    }
    
    async fn update_monitoring(&mut self) {
        let positions = self.trading_engine.get_positions().clone();
        let trades = self.trading_engine.get_trade_history().clone();
        
        self.monitoring.update_metrics(&trades, &positions);
        
        // Check for unacknowledged alerts
        let unacknowledged = self.monitoring.get_unacknowledged_alerts();
        for alert in unacknowledged {
            match alert.level {
                crate::monitoring::AlertLevel::Critical => {
                    error!("CRITICAL ALERT: {}", alert.message);
                }
                crate::monitoring::AlertLevel::Error => {
                    error!("ERROR: {}", alert.message);
                }
                crate::monitoring::AlertLevel::Warning => {
                    warn!("WARNING: {}", alert.message);
                }
                crate::monitoring::AlertLevel::Info => {
                    info!("INFO: {}", alert.message);
                }
            }
        }
    }
    
    async fn log_status(&self) {
        let metrics = self.monitoring.get_metrics();
        let positions = self.trading_engine.get_positions();
        
        info!(
            "Status - Trades: {}, Win Rate: {:.1}%, P&L: ${:.2}, Positions: {}, Uptime: {}s",
            metrics.total_trades,
            metrics.win_rate,
            metrics.total_profit_loss,
            positions.len(),
            metrics.uptime_seconds
        );
        
        if !positions.is_empty() {
            info!("Current positions:");
            for (address, position) in positions {
                info!(
                    "  {}: {} tokens @ ${:.6}",
                    address, position.amount, position.entry_price
                );
            }
        }
    }
    
    pub fn stop(&mut self) {
        self.running = false;
    }
    
    pub async fn get_balance(&self) -> Result<u64> {
        self.wallet.get_balance().await
    }
    
    pub fn get_positions(&self) -> &HashMap<String, crate::trading::Position> {
        self.trading_engine.get_positions()
    }
    
    pub fn get_metrics(&self) -> &crate::monitoring::BotMetrics {
        self.monitoring.get_metrics()
    }
    
    pub async fn save_state(&self) -> Result<()> {
        // Save metrics
        self.monitoring.save_metrics_to_file("metrics.json")?;
        
        // Save configuration
        self.config.save("config_backup.toml")?;
        
        info!("Bot state saved");
        Ok(())
    }
}
