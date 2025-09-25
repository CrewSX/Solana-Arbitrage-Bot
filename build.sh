#!/bin/bash

# Solana PumpFun Trading Bot Build Script

echo "🚀 Building Solana PumpFun Trading Bot..."

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust is not installed. Please install Rust from https://rustup.rs/"
    exit 1
fi

# Check if Solana CLI is installed
if ! command -v solana &> /dev/null; then
    echo "⚠️  Solana CLI not found. Please install from https://docs.solana.com/cli/install-solana-cli-tools"
fi

# Build the project
echo "📦 Building project..."
cargo build --release

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    echo ""
    echo "📋 Next steps:"
    echo "1. Copy config.example.toml to config.toml"
    echo "2. Edit config.toml with your settings"
    echo "3. Generate or import a wallet:"
    echo "   solana-keygen new --outfile wallet.json"
    echo "4. Run in dry-run mode first:"
    echo "   cargo run -- --dry-run"
    echo "5. Run live trading:"
    echo "   cargo run"
    echo ""
    echo "⚠️  Remember: Always test with dry-run mode first!"
else
    echo "❌ Build failed. Please check the errors above."
    exit 1
fi
