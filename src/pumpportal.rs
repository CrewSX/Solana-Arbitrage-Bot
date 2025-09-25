use crate::error::{BotError, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::time::{sleep, Duration};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenInfo {
    pub address: String,
    pub symbol: String,
    pub name: String,
    pub decimals: u8,
    pub market_cap: u64,
    pub holders: u32,
    pub age_hours: u32,
    pub liquidity: u64,
    pub price_usd: f64,
    pub price_change_24h: f64,
    pub volume_24h: u64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PumpPortalResponse {
    pub success: bool,
    pub data: Vec<TokenInfo>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenMetrics {
    pub address: String,
    pub price: f64,
    pub volume_5m: u64,
    pub volume_1h: u64,
    pub volume_24h: u64,
    pub holders: u32,
    pub market_cap: u64,
    pub liquidity: u64,
    pub price_change_5m: f64,
    pub price_change_1h: f64,
    pub price_change_24h: f64,
}

pub struct PumpPortalClient {
    client: Client,
    api_url: String,
    api_key: Option<String>,
    refresh_interval: Duration,
}

impl PumpPortalClient {
    pub fn new(api_url: String, api_key: Option<String>, refresh_interval_ms: u64) -> Self {
        Self {
            client: Client::new(),
            api_url,
            api_key,
            refresh_interval: Duration::from_millis(refresh_interval_ms),
        }
    }
    
    pub async fn get_new_tokens(&self) -> Result<Vec<TokenInfo>> {
        let url = format!("{}/api/tokens/new", self.api_url);
        let mut request = self.client.get(&url);
        
        if let Some(key) = &self.api_key {
            request = request.header("Authorization", format!("Bearer {}", key));
        }
        
        let response = request
            .send()
            .await
            .map_err(|e| BotError::Http(e))?;
            
        if !response.status().is_success() {
            return Err(BotError::PumpPortal(format!(
                "API request failed with status: {}",
                response.status()
            )));
        }
        
        let pump_response: PumpPortalResponse = response
            .json()
            .await
            .map_err(|e| BotError::Serialization(e))?;
            
        if !pump_response.success {
            return Err(BotError::PumpPortal(
                pump_response.message.unwrap_or("Unknown API error".to_string())
            ));
        }
        
        Ok(pump_response.data)
    }
    
    pub async fn get_token_metrics(&self, token_address: &str) -> Result<TokenMetrics> {
        let url = format!("{}/api/tokens/{}/metrics", self.api_url, token_address);
        let mut request = self.client.get(&url);
        
        if let Some(key) = &self.api_key {
            request = request.header("Authorization", format!("Bearer {}", key));
        }
        
        let response = request
            .send()
            .await
            .map_err(|e| BotError::Http(e))?;
            
        if !response.status().is_success() {
            return Err(BotError::PumpPortal(format!(
                "Failed to get metrics for token {}: {}",
                token_address,
                response.status()
            )));
        }
        
        let metrics: TokenMetrics = response
            .json()
            .await
            .map_err(|e| BotError::Serialization(e))?;
            
        Ok(metrics)
    }
    
    pub async fn get_trending_tokens(&self) -> Result<Vec<TokenInfo>> {
        let url = format!("{}/api/tokens/trending", self.api_url);
        let mut request = self.client.get(&url);
        
        if let Some(key) = &self.api_key {
            request = request.header("Authorization", format!("Bearer {}", key));
        }
        
        let response = request
            .send()
            .await
            .map_err(|e| BotError::Http(e))?;
            
        if !response.status().is_success() {
            return Err(BotError::PumpPortal(format!(
                "Failed to get trending tokens: {}",
                response.status()
            )));
        }
        
        let pump_response: PumpPortalResponse = response
            .json()
            .await
            .map_err(|e| BotError::Serialization(e))?;
            
        if !pump_response.success {
            return Err(BotError::PumpPortal(
                pump_response.message.unwrap_or("Unknown API error".to_string())
            ));
        }
        
        Ok(pump_response.data)
    }
    
    pub async fn filter_tokens_by_criteria(
        &self,
        tokens: Vec<TokenInfo>,
        min_market_cap: u64,
        max_market_cap: u64,
        min_holders: u32,
        max_age_hours: u32,
    ) -> Vec<TokenInfo> {
        tokens
            .into_iter()
            .filter(|token| {
                token.market_cap >= min_market_cap
                    && token.market_cap <= max_market_cap
                    && token.holders >= min_holders
                    && token.age_hours <= max_age_hours
            })
            .collect()
    }
    
    pub async fn start_monitoring<F>(&self, mut callback: F) -> Result<()>
    where
        F: FnMut(Vec<TokenInfo>) -> Result<()> + Send + 'static,
    {
        loop {
            match self.get_new_tokens().await {
                Ok(tokens) => {
                    if let Err(e) = callback(tokens).await {
                        log::error!("Error in monitoring callback: {}", e);
                    }
                }
                Err(e) => {
                    log::error!("Failed to fetch new tokens: {}", e);
                }
            }
            
            sleep(self.refresh_interval).await;
        }
    }
}
