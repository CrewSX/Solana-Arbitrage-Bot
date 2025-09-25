use anyhow::Result;
use clap::Parser;
use log::{error, info, warn};
use solana_pumpfun_bot::{
    bot::TradingBot,
    config::Config,
    error::BotError,
};
use std::process;

#[derive(Parser)]
#[command(name = "solana-pumpfun-bot")]
#[command(about = "A Solana PumpFun trading bot with PumpPortal integration")]
struct Cli {
    /// Configuration file path
    #[arg(short, long, default_value = "config.toml")]
    config: String,
    
    /// Enable debug logging
    #[arg(short, long)]
    debug: bool,
    
    /// Dry run mode (no actual trades)
    #[arg(long)]
    dry_run: bool,
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    
    // Initialize logging
    let log_level = if cli.debug { "debug" } else { "info" };
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(log_level))
        .init();
    
    info!("Starting Solana PumpFun Trading Bot");
    
    // Load configuration
    let config = match Config::load(&cli.config) {
        Ok(config) => {
            info!("Configuration loaded successfully");
            config
        }
        Err(e) => {
            error!("Failed to load configuration: {}", e);
            process::exit(1);
        }
    };
    
    // Create and run the trading bot
    let mut bot = match TradingBot::new(config, cli.dry_run).await {
        Ok(bot) => {
            info!("Trading bot initialized successfully");
            bot
        }
        Err(e) => {
            error!("Failed to initialize trading bot: {}", e);
            process::exit(1);
        }
    };
    
    // Run the bot
    if let Err(e) = bot.run().await {
        error!("Bot error: {}", e);
        process::exit(1);
    }
}
