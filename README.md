# Solana PumpFun Trading Bot 🚀

A sophisticated Rust-based trading bot for Solana's PumpFun platform with PumpPortal integration. This bot automatically identifies and trades new tokens based on multiple trading strategies with comprehensive monitoring and risk management.

## 🎯 Features

- **Multi-Strategy Trading**: Implements momentum, mean reversion, breakout, volume spike, and holder growth strategies
- **PumpPortal Integration**: Real-time token discovery and analysis
- **Risk Management**: Configurable stop-loss, take-profit, and position sizing
- **Real-time Monitoring**: Comprehensive metrics, alerts, and webhook notifications
- **Dry Run Mode**: Test strategies without real money
- **Wallet Management**: Secure keypair handling and transaction management
- **Configurable**: Extensive configuration options for all parameters

## 🏗️ Architecture

### System Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   PumpPortal    │    │  Trading Bot    │    │   Solana RPC    │
│     API         │◄──►│                 │◄──►│                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │   Wallet        │
                       │  Management     │
                       └─────────────────┘
```

### Bot Flow Diagram

```
┌─────────────────┐
│   Start Bot     │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ Load Config     │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ Initialize      │
│ Components      │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ Main Loop       │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Fetch New       │    │ Analyze Tokens  │    │ Check Exit      │
│ Tokens          │───►│ with Strategies │───►│ Conditions      │
└─────────────────┘    └─────────┬───────┘    └─────────┬───────┘
                                 │                      │
                                 ▼                      ▼
                        ┌─────────────────┐    ┌─────────────────┐
                        │ Execute Trades  │    │ Update Metrics  │
                        └─────────┬───────┘    └─────────┬───────┘
                                  │                      │
                                  └──────────┬───────────┘
                                             │
                                             ▼
                                    ┌─────────────────┐
                                    │ Sleep & Repeat  │
                                    └─────────────────┘
```

## 🧠 Trading Logic

### Strategy Engine

The bot implements five distinct trading strategies:

#### 1. Momentum Strategy
- **Trigger**: Price increase ≥ 5% with volume ratio ≥ 2x
- **Logic**: Identifies tokens with strong upward price momentum
- **Confidence**: Based on price change percentage

#### 2. Mean Reversion Strategy
- **Trigger**: Price drop ≥ 10% with good liquidity ratio
- **Logic**: Assumes temporary price drops will recover
- **Confidence**: Based on magnitude of price drop

#### 3. Breakout Strategy
- **Trigger**: Volume spike ≥ 3x with price momentum ≥ 2%
- **Logic**: Catches tokens breaking out of consolidation
- **Confidence**: Based on volume spike magnitude

#### 4. Volume Spike Strategy
- **Trigger**: Volume multiplier ≥ 5x with ≥ 50 holders
- **Logic**: Identifies sudden interest in tokens
- **Confidence**: Based on volume spike and holder count

#### 5. Holder Growth Strategy
- **Trigger**: ≥ 100 holders with ≥ $500K market cap
- **Logic**: Organic growth in token adoption
- **Confidence**: Based on holder-to-market-cap ratio

### Risk Management

```
┌─────────────────┐
│ Position Entry  │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ Check Criteria  │
│ - Market Cap    │
│ - Holders       │
│ - Age           │
│ - Liquidity     │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ Calculate Size  │
│ - Confidence    │
│ - Max Amount    │
│ - Available SOL │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ Execute Trade   │
└─────────┬───────┘
          │
          ▼
┌─────────────────┐
│ Monitor Position│
│ - Profit Target │
│ - Stop Loss     │
│ - Time Decay    │
└─────────────────┘
```

## 📊 Monitoring & Alerts

### Metrics Tracked
- Total trades executed
- Win/loss ratio
- Total profit/loss
- Maximum drawdown
- Current positions
- Volume traded
- Uptime

### Alert System
- **Critical**: System failures, wallet issues
- **Error**: Daily loss thresholds exceeded
- **Warning**: High drawdown, low win rate
- **Info**: General status updates

### Webhook Integration
Supports Discord, Slack, and custom webhook endpoints for real-time notifications.

## 🚀 Quick Start

### Prerequisites
- Rust 1.70+ installed
- Solana CLI tools
- A Solana wallet with some SOL for trading

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd solana-pumpfun-bot
```

2. **Install dependencies**
```bash
cargo build --release
```

3. **Generate or import wallet**
```bash
# Generate new wallet
solana-keygen new --outfile wallet.json

# Or import existing wallet
solana-keygen recover 'prompt://?key=0/0' --outfile wallet.json
```

4. **Configure the bot**
```bash
cp config.example.toml config.toml
# Edit config.toml with your settings
```

5. **Run the bot**
```bash
# Dry run (recommended first)
cargo run -- --dry-run

# Live trading
cargo run
```

### Configuration

Key configuration parameters:

```toml
[trading]
max_buy_amount = 1_000_000_000  # 1 SOL max per trade
profit_target_percent = 20.0    # Take profit at 20%
stop_loss_percent = 10.0        # Stop loss at 10%
max_positions = 5               # Max concurrent positions

[pumpportal]
min_market_cap = 1_000_000      # $1M minimum
max_market_cap = 10_000_000     # $10M maximum
min_holders = 100               # Minimum holders
```

## 🔧 Advanced Usage

### Custom Strategies

Add custom trading strategies by implementing the `StrategyConfig`:

```rust
let custom_strategy = StrategyConfig {
    strategy: TradingStrategy::Custom,
    parameters: {
        let mut params = HashMap::new();
        params.insert("custom_param".to_string(), 1.5);
        params
    },
    enabled: true,
};
```

### Webhook Alerts

Configure Discord webhook for alerts:

```toml
[monitoring]
webhook_url = "https://discord.com/api/webhooks/YOUR_WEBHOOK_URL"
```

### API Integration

The bot integrates with PumpPortal API for:
- Real-time token discovery
- Market data and metrics
- Holder information
- Price and volume data

## 📈 Performance Optimization

### RPC Endpoints
Use reliable RPC endpoints for better performance:
- Mainnet: `https://api.mainnet-beta.solana.com`
- Helius: `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY`
- QuickNode: `https://YOUR_ENDPOINT.solana-mainnet.quiknode.pro/YOUR_KEY/`

### Strategy Tuning
- Adjust confidence thresholds based on market conditions
- Modify cooldown periods to prevent overtrading
- Fine-tune profit/loss targets for your risk tolerance

## 🛡️ Security Considerations

- **Wallet Security**: Never share your private key
- **API Keys**: Use environment variables for sensitive data
- **Dry Run**: Always test with dry run mode first
- **Position Limits**: Set appropriate position size limits
- **Monitoring**: Regularly check bot performance and alerts

## 📝 Logging

The bot provides comprehensive logging:
- Trade execution details
- Strategy analysis results
- Error messages and warnings
- Performance metrics
- Alert notifications

Log levels: `trace`, `debug`, `info`, `warn`, `error`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## ⚠️ Disclaimer

This software is for educational purposes only. Trading cryptocurrencies involves substantial risk of loss. The authors are not responsible for any financial losses. Always do your own research and never invest more than you can afford to lose.

## 🆘 Support

For support and questions:
- Create an issue on GitHub
- Check the documentation
- Review the configuration examples
- **Telegram Contact**: [@Kat_logic](https://t.me/Kat_logic)

## 🔄 Updates

Stay updated with the latest features and improvements:
- Watch the repository for releases
- Check the changelog
- Follow best practices for updates

---

**Happy Trading! 🚀📈**
