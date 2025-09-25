use crate::error::Result;
use crate::pumpportal::TokenInfo;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TradingStrategy {
    Momentum,
    MeanReversion,
    Breakout,
    VolumeSpike,
    HolderGrowth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyConfig {
    pub strategy: TradingStrategy,
    pub parameters: HashMap<String, f64>,
    pub enabled: bool,
}

#[derive(Debug, Clone)]
pub struct TradingSignal {
    pub token: TokenInfo,
    pub action: Action,
    pub confidence: f64,
    pub reason: String,
    pub expected_price: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Buy,
    Sell,
    Hold,
}

pub struct StrategyEngine {
    strategies: Vec<StrategyConfig>,
    position_history: HashMap<String, Vec<f64>>,
}

impl StrategyEngine {
    pub fn new(strategies: Vec<StrategyConfig>) -> Self {
        Self {
            strategies,
            position_history: HashMap::new(),
        }
    }
    
    pub fn analyze_token(&mut self, token: &TokenInfo) -> Result<Vec<TradingSignal>> {
        let mut signals = Vec::new();
        
        for strategy_config in &self.strategies {
            if !strategy_config.enabled {
                continue;
            }
            
            match strategy_config.strategy {
                TradingStrategy::Momentum => {
                    if let Some(signal) = self.momentum_strategy(token, &strategy_config.parameters)? {
                        signals.push(signal);
                    }
                }
                TradingStrategy::MeanReversion => {
                    if let Some(signal) = self.mean_reversion_strategy(token, &strategy_config.parameters)? {
                        signals.push(signal);
                    }
                }
                TradingStrategy::Breakout => {
                    if let Some(signal) = self.breakout_strategy(token, &strategy_config.parameters)? {
                        signals.push(signal);
                    }
                }
                TradingStrategy::VolumeSpike => {
                    if let Some(signal) = self.volume_spike_strategy(token, &strategy_config.parameters)? {
                        signals.push(signal);
                    }
                }
                TradingStrategy::HolderGrowth => {
                    if let Some(signal) = self.holder_growth_strategy(token, &strategy_config.parameters)? {
                        signals.push(signal);
                    }
                }
            }
        }
        
        Ok(signals)
    }
    
    fn momentum_strategy(&self, token: &TokenInfo, params: &HashMap<String, f64>) -> Result<Option<TradingSignal>> {
        let min_price_change = params.get("min_price_change").unwrap_or(&5.0);
        let min_volume_ratio = params.get("min_volume_ratio").unwrap_or(&2.0);
        
        // Check if price is increasing significantly
        if token.price_change_24h >= *min_price_change {
            // Check if volume is also increasing
            let volume_ratio = token.volume_24h as f64 / token.liquidity as f64;
            if volume_ratio >= *min_volume_ratio {
                return Ok(Some(TradingSignal {
                    token: token.clone(),
                    action: Action::Buy,
                    confidence: (token.price_change_24h / 100.0).min(1.0),
                    reason: format!(
                        "Momentum: Price up {:.2}%, Volume ratio {:.2}",
                        token.price_change_24h,
                        volume_ratio
                    ),
                    expected_price: Some(token.price_usd * 1.1),
                }));
            }
        }
        
        Ok(None)
    }
    
    fn mean_reversion_strategy(&self, token: &TokenInfo, params: &HashMap<String, f64>) -> Result<Option<TradingSignal>> {
        let max_price_change = params.get("max_price_change").unwrap_or(&-10.0);
        let min_liquidity_ratio = params.get("min_liquidity_ratio").unwrap_or(&0.1);
        
        // Check if price has dropped significantly but liquidity is still good
        if token.price_change_24h <= *max_price_change {
            let liquidity_ratio = token.liquidity as f64 / token.market_cap as f64;
            if liquidity_ratio >= *min_liquidity_ratio {
                return Ok(Some(TradingSignal {
                    token: token.clone(),
                    action: Action::Buy,
                    confidence: (-token.price_change_24h / 100.0).min(1.0),
                    reason: format!(
                        "Mean Reversion: Price down {:.2}%, Liquidity ratio {:.2}",
                        token.price_change_24h,
                        liquidity_ratio
                    ),
                    expected_price: Some(token.price_usd * 1.05),
                }));
            }
        }
        
        Ok(None)
    }
    
    fn breakout_strategy(&self, token: &TokenInfo, params: &HashMap<String, f64>) -> Result<Option<TradingSignal>> {
        let min_volume_spike = params.get("min_volume_spike").unwrap_or(&3.0);
        let min_price_momentum = params.get("min_price_momentum").unwrap_or(&2.0);
        
        // Check for volume spike with price momentum
        let volume_spike = token.volume_24h as f64 / token.liquidity as f64;
        if volume_spike >= *min_volume_spike && token.price_change_24h >= *min_price_momentum {
            return Ok(Some(TradingSignal {
                token: token.clone(),
                action: Action::Buy,
                confidence: (volume_spike / 10.0).min(1.0),
                reason: format!(
                    "Breakout: Volume spike {:.2}x, Price momentum {:.2}%",
                    volume_spike,
                    token.price_change_24h
                ),
                expected_price: Some(token.price_usd * 1.15),
            }));
        }
        
        Ok(None)
    }
    
    fn volume_spike_strategy(&self, token: &TokenInfo, params: &HashMap<String, f64>) -> Result<Option<TradingSignal>> {
        let min_volume_multiplier = params.get("min_volume_multiplier").unwrap_or(&5.0);
        let min_holders = params.get("min_holders").unwrap_or(&50.0) as u32;
        
        // Check for sudden volume increase with decent holder count
        let volume_multiplier = token.volume_24h as f64 / token.liquidity as f64;
        if volume_multiplier >= *min_volume_multiplier && token.holders >= min_holders {
            return Ok(Some(TradingSignal {
                token: token.clone(),
                action: Action::Buy,
                confidence: (volume_multiplier / 20.0).min(1.0),
                reason: format!(
                    "Volume Spike: {:.2}x volume, {} holders",
                    volume_multiplier,
                    token.holders
                ),
                expected_price: Some(token.price_usd * 1.2),
            }));
        }
        
        Ok(None)
    }
    
    fn holder_growth_strategy(&self, token: &TokenInfo, params: &HashMap<String, f64>) -> Result<Option<TradingSignal>> {
        let min_holders = params.get("min_holders").unwrap_or(&100.0) as u32;
        let min_market_cap = params.get("min_market_cap").unwrap_or(&500_000.0) as u64;
        
        // Look for tokens with growing holder base and decent market cap
        if token.holders >= min_holders && token.market_cap >= min_market_cap {
            let holder_ratio = token.holders as f64 / (token.market_cap as f64 / 1_000_000.0);
            if holder_ratio >= 0.1 { // At least 0.1 holders per $1M market cap
                return Ok(Some(TradingSignal {
                    token: token.clone(),
                    action: Action::Buy,
                    confidence: (holder_ratio / 2.0).min(1.0),
                    reason: format!(
                        "Holder Growth: {} holders, ${:.0}M market cap",
                        token.holders,
                        token.market_cap as f64 / 1_000_000.0
                    ),
                    expected_price: Some(token.price_usd * 1.08),
                }));
            }
        }
        
        Ok(None)
    }
    
    pub fn update_position_history(&mut self, token_address: String, price: f64) {
        self.position_history
            .entry(token_address)
            .or_insert_with(Vec::new)
            .push(price);
    }
    
    pub fn get_position_history(&self, token_address: &str) -> Option<&Vec<f64>> {
        self.position_history.get(token_address)
    }
    
    pub fn should_sell(&self, token_address: &str, current_price: f64, entry_price: f64) -> bool {
        let profit_percent = ((current_price - entry_price) / entry_price) * 100.0;
        let loss_percent = ((entry_price - current_price) / entry_price) * 100.0;
        
        // Take profit at 20% or stop loss at 10%
        profit_percent >= 20.0 || loss_percent >= 10.0
    }
}

impl Default for StrategyConfig {
    fn default() -> Self {
        let mut parameters = HashMap::new();
        parameters.insert("min_price_change".to_string(), 5.0);
        parameters.insert("min_volume_ratio".to_string(), 2.0);
        parameters.insert("max_price_change".to_string(), -10.0);
        parameters.insert("min_liquidity_ratio".to_string(), 0.1);
        parameters.insert("min_volume_spike".to_string(), 3.0);
        parameters.insert("min_price_momentum".to_string(), 2.0);
        parameters.insert("min_volume_multiplier".to_string(), 5.0);
        parameters.insert("min_holders".to_string(), 100.0);
        parameters.insert("min_market_cap".to_string(), 500_000.0);
        
        Self {
            strategy: TradingStrategy::Momentum,
            parameters,
            enabled: true,
        }
    }
}
