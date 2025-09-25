use thiserror::Error;

#[derive(Error, Debug)]
pub enum BotError {
    #[error("Configuration error: {0}")]
    Config(String),
    
    #[error("Solana client error: {0}")]
    SolanaClient(#[from] solana_client::client_error::ClientError),
    
    #[error("HTTP request error: {0}")]
    Http(#[from] reqwest::Error),
    
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    
    #[error("Wallet error: {0}")]
    Wallet(String),
    
    #[error("Trading error: {0}")]
    Trading(String),
    
    #[error("PumpPortal API error: {0}")]
    PumpPortal(String),
    
    #[error("Insufficient funds: {0}")]
    InsufficientFunds(String),
    
    #[error("Transaction failed: {0}")]
    TransactionFailed(String),
    
    #[error("Invalid token address: {0}")]
    InvalidTokenAddress(String),
    
    #[error("Rate limit exceeded")]
    RateLimitExceeded,
    
    #[error("Network error: {0}")]
    Network(String),
    
    #[error("Unknown error: {0}")]
    Unknown(String),
}

pub type Result<T> = std::result::Result<T, BotError>;
