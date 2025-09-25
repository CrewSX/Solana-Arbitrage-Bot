use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub rpc_url: String,
    pub wallet_path: String,
    pub trading: TradingConfig,
    pub pumpportal: PumpPortalConfig,
    pub monitoring: MonitoringConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradingConfig {
    pub max_slippage: f64,
    pub min_liquidity: u64,
    pub max_buy_amount: u64,
    pub max_sell_amount: u64,
    pub profit_target_percent: f64,
    pub stop_loss_percent: f64,
    pub cooldown_seconds: u64,
    pub max_positions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PumpPortalConfig {
    pub api_url: String,
    pub api_key: Option<String>,
    pub refresh_interval_ms: u64,
    pub min_market_cap: u64,
    pub max_market_cap: u64,
    pub min_holders: u32,
    pub max_age_hours: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringConfig {
    pub log_level: String,
    pub save_trades: bool,
    pub webhook_url: Option<String>,
    pub alert_thresholds: AlertThresholds,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertThresholds {
    pub max_drawdown_percent: f64,
    pub min_daily_profit_percent: f64,
    pub max_daily_loss_percent: f64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            rpc_url: "https://api.mainnet-beta.solana.com".to_string(),
            wallet_path: "wallet.json".to_string(),
            trading: TradingConfig::default(),
            pumpportal: PumpPortalConfig::default(),
            monitoring: MonitoringConfig::default(),
        }
    }
}

impl Default for TradingConfig {
    fn default() -> Self {
        Self {
            max_slippage: 5.0,
            min_liquidity: 100_000_000, // 100 SOL
            max_buy_amount: 1_000_000_000, // 1 SOL
            max_sell_amount: 1_000_000_000, // 1 SOL
            profit_target_percent: 20.0,
            stop_loss_percent: 10.0,
            cooldown_seconds: 60,
            max_positions: 5,
        }
    }
}

impl Default for PumpPortalConfig {
    fn default() -> Self {
        Self {
            api_url: "https://api.pumpportal.fun".to_string(),
            api_key: None,
            refresh_interval_ms: 5000,
            min_market_cap: 1_000_000, // $1M
            max_market_cap: 10_000_000, // $10M
            min_holders: 100,
            max_age_hours: 24,
        }
    }
}

impl Default for MonitoringConfig {
    fn default() -> Self {
        Self {
            log_level: "info".to_string(),
            save_trades: true,
            webhook_url: None,
            alert_thresholds: AlertThresholds::default(),
        }
    }
}

impl Default for AlertThresholds {
    fn default() -> Self {
        Self {
            max_drawdown_percent: 20.0,
            min_daily_profit_percent: 5.0,
            max_daily_loss_percent: 15.0,
        }
    }
}

impl Config {
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self> {
        let config_str = std::fs::read_to_string(path)
            .map_err(|e| crate::error::BotError::Config(format!("Failed to read config file: {}", e)))?;
        let config: Config = toml::from_str(&config_str)
            .map_err(|e| crate::error::BotError::Config(format!("Failed to parse config: {}", e)))?;
        Ok(config)
    }
    
    pub fn save<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let config_str = toml::to_string_pretty(self)
            .map_err(|e| crate::error::BotError::Config(format!("Failed to serialize config: {}", e)))?;
        std::fs::write(path, config_str)
            .map_err(|e| crate::error::BotError::Config(format!("Failed to write config file: {}", e)))?;
        Ok(())
    }
}
