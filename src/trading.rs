use crate::error::{BotError, Result};
use crate::strategies::{Action, TradingSignal};
use crate::wallet::WalletManager;
use rust_decimal::Decimal;
use solana_sdk::{
    instruction::Instruction,
    pubkey::Pubkey,
    system_instruction,
    transaction::Transaction,
};
use spl_token::instruction as token_instruction;
use std::collections::HashMap;
use std::str::FromStr;

#[derive(Debug, Clone)]
pub struct Position {
    pub token_address: String,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub entry_price: f64,
    pub entry_time: chrono::DateTime<chrono::Utc>,
    pub token_account: Option<Pubkey>,
}

#[derive(Debug, Clone)]
pub struct Trade {
    pub id: String,
    pub token_address: String,
    pub action: Action,
    pub amount: u64,
    pub price: f64,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub signature: Option<String>,
    pub profit_loss: Option<f64>,
}

pub struct TradingEngine {
    wallet: WalletManager,
    positions: HashMap<String, Position>,
    trade_history: Vec<Trade>,
    max_positions: usize,
    max_buy_amount: u64,
    max_sell_amount: u64,
    profit_target_percent: f64,
    stop_loss_percent: f64,
    cooldown_seconds: u64,
    last_trade_time: HashMap<String, chrono::DateTime<chrono::Utc>>,
}

impl TradingEngine {
    pub fn new(
        wallet: &WalletManager,
        max_positions: usize,
        max_buy_amount: u64,
        max_sell_amount: u64,
        profit_target_percent: f64,
        stop_loss_percent: f64,
        cooldown_seconds: u64,
    ) -> Self {
        Self {
            wallet: wallet.clone(),
            positions: HashMap::new(),
            trade_history: Vec::new(),
            max_positions,
            max_buy_amount,
            max_sell_amount,
            profit_target_percent,
            stop_loss_percent,
            cooldown_seconds,
            last_trade_time: HashMap::new(),
        }
    }
    
    pub async fn execute_signal(&mut self, signal: TradingSignal) -> Result<Option<Trade>> {
        // Check cooldown
        if self.is_in_cooldown(&signal.token.address).await? {
            log::info!("Token {} is in cooldown, skipping trade", signal.token.address);
            return Ok(None);
        }
        
        match signal.action {
            Action::Buy => self.execute_buy(signal).await,
            Action::Sell => self.execute_sell(signal).await,
            Action::Hold => {
                log::debug!("Hold signal for token {}", signal.token.address);
                Ok(None)
            }
        }
    }
    
    async fn execute_buy(&mut self, signal: TradingSignal) -> Result<Option<Trade>> {
        // Check if we already have a position
        if self.positions.contains_key(&signal.token.address) {
            log::debug!("Already have position in token {}", signal.token.address);
            return Ok(None);
        }
        
        // Check max positions
        if self.positions.len() >= self.max_positions {
            log::warn!("Maximum positions reached, cannot buy {}", signal.token.address);
            return Ok(None);
        }
        
        // Calculate buy amount
        let buy_amount = self.calculate_buy_amount(&signal)?;
        if buy_amount == 0 {
            log::warn!("Buy amount is 0 for token {}", signal.token.address);
            return Ok(None);
        }
        
        // Get token mint
        let token_mint = Pubkey::from_str(&signal.token.address)
            .map_err(|e| BotError::InvalidTokenAddress(format!("Invalid token address: {}", e)))?;
        
        // Create or get token account
        let token_account = self.get_or_create_token_account(&token_mint).await?;
        
        // Execute buy transaction
        let trade = self.create_buy_trade(&signal, buy_amount, token_account).await?;
        
        // Update position
        let position = Position {
            token_address: signal.token.address.clone(),
            token_mint,
            amount: buy_amount,
            entry_price: signal.token.price_usd,
            entry_time: chrono::Utc::now(),
            token_account: Some(token_account),
        };
        
        self.positions.insert(signal.token.address.clone(), position);
        self.last_trade_time.insert(signal.token.address, chrono::Utc::now());
        
        log::info!(
            "Bought {} tokens of {} at ${:.6}",
            buy_amount,
            signal.token.symbol,
            signal.token.price_usd
        );
        
        Ok(Some(trade))
    }
    
    async fn execute_sell(&mut self, signal: TradingSignal) -> Result<Option<Trade>> {
        let position = match self.positions.get(&signal.token.address) {
            Some(pos) => pos,
            None => {
                log::debug!("No position found for token {}", signal.token.address);
                return Ok(None);
            }
        };
        
        // Calculate sell amount
        let sell_amount = self.calculate_sell_amount(position)?;
        if sell_amount == 0 {
            log::warn!("Sell amount is 0 for token {}", signal.token.address);
            return Ok(None);
        }
        
        // Execute sell transaction
        let trade = self.create_sell_trade(&signal, sell_amount, position).await?;
        
        // Update or remove position
        if sell_amount >= position.amount {
            self.positions.remove(&signal.token.address);
            log::info!("Sold entire position of {}", signal.token.symbol);
        } else {
            // Partial sell - update position
            let mut updated_position = position.clone();
            updated_position.amount -= sell_amount;
            self.positions.insert(signal.token.address.clone(), updated_position);
            log::info!("Partially sold position of {}", signal.token.symbol);
        }
        
        self.last_trade_time.insert(signal.token.address, chrono::Utc::now());
        
        Ok(Some(trade))
    }
    
    fn calculate_buy_amount(&self, signal: &TradingSignal) -> Result<u64> {
        let confidence_multiplier = signal.confidence;
        let base_amount = (self.max_buy_amount as f64 * confidence_multiplier) as u64;
        
        // Ensure we don't exceed max buy amount
        let buy_amount = base_amount.min(self.max_buy_amount);
        
        // Check if we have enough SOL balance
        // This is a simplified check - in practice, you'd need to account for transaction fees
        Ok(buy_amount)
    }
    
    fn calculate_sell_amount(&self, position: &Position) -> Result<u64> {
        // For now, sell entire position
        // In practice, you might want to implement partial selling strategies
        Ok(position.amount)
    }
    
    async fn get_or_create_token_account(&self, token_mint: &Pubkey) -> Result<Pubkey> {
        // Check if token account already exists
        let token_accounts = self.wallet.get_rpc_client()
            .get_token_accounts_by_owner(
                &self.wallet.get_address(),
                solana_client::rpc_request::TokenAccountsFilter::Mint(*token_mint),
            )
            .await
            .map_err(|e| BotError::SolanaClient(e))?;
        
        if !token_accounts.is_empty() {
            return Ok(token_accounts[0].pubkey);
        }
        
        // Create new token account
        self.wallet.create_token_account(token_mint).await
    }
    
    async fn create_buy_trade(
        &self,
        signal: &TradingSignal,
        amount: u64,
        token_account: Pubkey,
    ) -> Result<Trade> {
        // This is a simplified implementation
        // In practice, you'd need to implement the actual swap logic
        // using Raydium, Jupiter, or other DEX aggregators
        
        let trade = Trade {
            id: uuid::Uuid::new_v4().to_string(),
            token_address: signal.token.address.clone(),
            action: Action::Buy,
            amount,
            price: signal.token.price_usd,
            timestamp: chrono::Utc::now(),
            signature: None, // Would be set after transaction confirmation
            profit_loss: None,
        };
        
        Ok(trade)
    }
    
    async fn create_sell_trade(
        &self,
        signal: &TradingSignal,
        amount: u64,
        position: &Position,
    ) -> Result<Trade> {
        let profit_loss = Some(
            (signal.token.price_usd - position.entry_price) * (amount as f64 / 1_000_000.0)
        );
        
        let trade = Trade {
            id: uuid::Uuid::new_v4().to_string(),
            token_address: signal.token.address.clone(),
            action: Action::Sell,
            amount,
            price: signal.token.price_usd,
            timestamp: chrono::Utc::now(),
            signature: None, // Would be set after transaction confirmation
            profit_loss,
        };
        
        Ok(trade)
    }
    
    async fn is_in_cooldown(&self, token_address: &str) -> Result<bool> {
        if let Some(last_trade) = self.last_trade_time.get(token_address) {
            let elapsed = chrono::Utc::now() - *last_trade;
            return Ok(elapsed.num_seconds() < self.cooldown_seconds as i64);
        }
        Ok(false)
    }
    
    pub fn get_positions(&self) -> &HashMap<String, Position> {
        &self.positions
    }
    
    pub fn get_trade_history(&self) -> &Vec<Trade> {
        &self.trade_history
    }
    
    pub fn add_trade(&mut self, trade: Trade) {
        self.trade_history.push(trade);
    }
    
    pub async fn check_exit_conditions(&mut self) -> Result<Vec<TradingSignal>> {
        let mut exit_signals = Vec::new();
        
        for (token_address, position) in &self.positions.clone() {
            // Check profit/loss conditions
            let current_price = position.entry_price; // In practice, fetch current price
            let profit_percent = ((current_price - position.entry_price) / position.entry_price) * 100.0;
            let loss_percent = ((position.entry_price - current_price) / position.entry_price) * 100.0;
            
            if profit_percent >= self.profit_target_percent || loss_percent >= self.stop_loss_percent {
                // Create sell signal
                let token_info = crate::pumpportal::TokenInfo {
                    address: token_address.clone(),
                    symbol: "UNKNOWN".to_string(), // Would fetch from API
                    name: "Unknown".to_string(),
                    decimals: 6,
                    market_cap: 0,
                    holders: 0,
                    age_hours: 0,
                    liquidity: 0,
                    price_usd: current_price,
                    price_change_24h: 0.0,
                    volume_24h: 0,
                    created_at: "".to_string(),
                };
                
                let reason = if profit_percent >= self.profit_target_percent {
                    format!("Profit target reached: {:.2}%", profit_percent)
                } else {
                    format!("Stop loss triggered: {:.2}%", loss_percent)
                };
                
                exit_signals.push(TradingSignal {
                    token: token_info,
                    action: Action::Sell,
                    confidence: 1.0,
                    reason,
                    expected_price: Some(current_price),
                });
            }
        }
        
        Ok(exit_signals)
    }
}
