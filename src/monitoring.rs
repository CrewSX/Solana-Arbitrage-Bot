use crate::error::Result;
use crate::trading::{Position, Trade};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotMetrics {
    pub total_trades: usize,
    pub winning_trades: usize,
    pub losing_trades: usize,
    pub total_profit_loss: f64,
    pub win_rate: f64,
    pub average_profit: f64,
    pub average_loss: f64,
    pub max_drawdown: f64,
    pub current_positions: usize,
    pub total_volume_traded: u64,
    pub uptime_seconds: u64,
    pub last_updated: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alert {
    pub id: String,
    pub level: AlertLevel,
    pub message: String,
    pub timestamp: DateTime<Utc>,
    pub acknowledged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AlertLevel {
    Info,
    Warning,
    Error,
    Critical,
}

pub struct MonitoringSystem {
    metrics: BotMetrics,
    alerts: Vec<Alert>,
    start_time: DateTime<Utc>,
    webhook_url: Option<String>,
    alert_thresholds: AlertThresholds,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertThresholds {
    pub max_drawdown_percent: f64,
    pub min_daily_profit_percent: f64,
    pub max_daily_loss_percent: f64,
}

impl MonitoringSystem {
    pub fn new(webhook_url: Option<String>, alert_thresholds: AlertThresholds) -> Self {
        Self {
            metrics: BotMetrics::default(),
            alerts: Vec::new(),
            start_time: Utc::now(),
            webhook_url,
            alert_thresholds,
        }
    }
    
    pub fn update_metrics(&mut self, trades: &[Trade], positions: &HashMap<String, Position>) {
        self.metrics.total_trades = trades.len();
        self.metrics.current_positions = positions.len();
        self.metrics.last_updated = Utc::now();
        self.metrics.uptime_seconds = (Utc::now() - self.start_time).num_seconds() as u64;
        
        // Calculate profit/loss metrics
        let mut total_profit_loss = 0.0;
        let mut winning_trades = 0;
        let mut losing_trades = 0;
        let mut total_volume = 0u64;
        
        for trade in trades {
            total_volume += trade.amount;
            
            if let Some(pl) = trade.profit_loss {
                total_profit_loss += pl;
                if pl > 0.0 {
                    winning_trades += 1;
                } else if pl < 0.0 {
                    losing_trades += 1;
                }
            }
        }
        
        self.metrics.total_profit_loss = total_profit_loss;
        self.metrics.winning_trades = winning_trades;
        self.metrics.losing_trades = losing_trades;
        self.metrics.total_volume_traded = total_volume;
        
        // Calculate rates
        if self.metrics.total_trades > 0 {
            self.metrics.win_rate = (winning_trades as f64 / self.metrics.total_trades as f64) * 100.0;
        }
        
        if winning_trades > 0 {
            let total_wins: f64 = trades.iter()
                .filter_map(|t| t.profit_loss)
                .filter(|&pl| pl > 0.0)
                .sum();
            self.metrics.average_profit = total_wins / winning_trades as f64;
        }
        
        if losing_trades > 0 {
            let total_losses: f64 = trades.iter()
                .filter_map(|t| t.profit_loss)
                .filter(|&pl| pl < 0.0)
                .sum();
            self.metrics.average_loss = total_losses.abs() / losing_trades as f64;
        }
        
        // Calculate max drawdown
        self.metrics.max_drawdown = self.calculate_max_drawdown(trades);
        
        // Check for alerts
        self.check_alerts();
    }
    
    fn calculate_max_drawdown(&self, trades: &[Trade]) -> f64 {
        let mut peak = 0.0;
        let mut max_drawdown = 0.0;
        let mut running_pl = 0.0;
        
        for trade in trades {
            if let Some(pl) = trade.profit_loss {
                running_pl += pl;
                if running_pl > peak {
                    peak = running_pl;
                }
                let drawdown = peak - running_pl;
                if drawdown > max_drawdown {
                    max_drawdown = drawdown;
                }
            }
        }
        
        max_drawdown
    }
    
    fn check_alerts(&mut self) {
        // Check drawdown alert
        if self.metrics.max_drawdown > self.alert_thresholds.max_drawdown_percent {
            self.add_alert(
                AlertLevel::Warning,
                format!(
                    "Max drawdown exceeded: {:.2}% (threshold: {:.2}%)",
                    self.metrics.max_drawdown,
                    self.alert_thresholds.max_drawdown_percent
                ),
            );
        }
        
        // Check daily profit/loss
        let daily_pl_percent = self.calculate_daily_pl_percent();
        if daily_pl_percent < -self.alert_thresholds.max_daily_loss_percent {
            self.add_alert(
                AlertLevel::Error,
                format!(
                    "Daily loss exceeded: {:.2}% (threshold: {:.2}%)",
                    daily_pl_percent.abs(),
                    self.alert_thresholds.max_daily_loss_percent
                ),
            );
        }
        
        // Check win rate
        if self.metrics.total_trades > 10 && self.metrics.win_rate < 30.0 {
            self.add_alert(
                AlertLevel::Warning,
                format!("Low win rate: {:.2}%", self.metrics.win_rate),
            );
        }
    }
    
    fn calculate_daily_pl_percent(&self) -> f64 {
        // This is a simplified calculation
        // In practice, you'd calculate based on daily P&L
        self.metrics.total_profit_loss
    }
    
    fn add_alert(&mut self, level: AlertLevel, message: String) {
        let alert = Alert {
            id: uuid::Uuid::new_v4().to_string(),
            level,
            message,
            timestamp: Utc::now(),
            acknowledged: false,
        };
        
        self.alerts.push(alert);
        
        // Send webhook if configured
        if let Some(ref webhook_url) = self.webhook_url {
            self.send_webhook_alert(&alert);
        }
    }
    
    async fn send_webhook_alert(&self, alert: &Alert) {
        if let Some(ref webhook_url) = self.webhook_url {
            let payload = serde_json::json!({
                "text": format!("[{}] {}", alert.level, alert.message),
                "timestamp": alert.timestamp.to_rfc3339(),
                "bot_metrics": self.metrics
            });
            
            if let Err(e) = reqwest::Client::new()
                .post(webhook_url)
                .json(&payload)
                .send()
                .await
            {
                log::error!("Failed to send webhook alert: {}", e);
            }
        }
    }
    
    pub fn get_metrics(&self) -> &BotMetrics {
        &self.metrics
    }
    
    pub fn get_alerts(&self) -> &[Alert] {
        &self.alerts
    }
    
    pub fn acknowledge_alert(&mut self, alert_id: &str) -> bool {
        if let Some(alert) = self.alerts.iter_mut().find(|a| a.id == alert_id) {
            alert.acknowledged = true;
            true
        } else {
            false
        }
    }
    
    pub fn get_unacknowledged_alerts(&self) -> Vec<&Alert> {
        self.alerts.iter().filter(|a| !a.acknowledged).collect()
    }
    
    pub fn save_metrics_to_file(&self, path: &str) -> Result<()> {
        let json = serde_json::to_string_pretty(&self.metrics)
            .map_err(|e| crate::error::BotError::Serialization(e))?;
        std::fs::write(path, json)
            .map_err(|e| crate::error::BotError::Unknown(format!("Failed to write metrics file: {}", e)))?;
        Ok(())
    }
    
    pub fn load_metrics_from_file(&mut self, path: &str) -> Result<()> {
        if std::path::Path::new(path).exists() {
            let json = std::fs::read_to_string(path)
                .map_err(|e| crate::error::BotError::Unknown(format!("Failed to read metrics file: {}", e)))?;
            self.metrics = serde_json::from_str(&json)
                .map_err(|e| crate::error::BotError::Serialization(e))?;
        }
        Ok(())
    }
}

impl Default for BotMetrics {
    fn default() -> Self {
        Self {
            total_trades: 0,
            winning_trades: 0,
            losing_trades: 0,
            total_profit_loss: 0.0,
            win_rate: 0.0,
            average_profit: 0.0,
            average_loss: 0.0,
            max_drawdown: 0.0,
            current_positions: 0,
            total_volume_traded: 0,
            uptime_seconds: 0,
            last_updated: Utc::now(),
        }
    }
}
