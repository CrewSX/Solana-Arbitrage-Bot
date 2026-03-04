# Solana Arbitrage Bot

**Automated cross-DEX arbitrage bot for Solana.** Detects price discrepancies across 7 DEXes and executes multi-hop swaps in real time. Built for speed with Yellowstone gRPC streaming, Jito integration, and optimized on-chain programs.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Solana](https://img.shields.io/badge/Solana-Mainnet-purple.svg)](https://solana.com/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)

---

## Overview

A high-performance **Solana arbitrage bot** that monitors price differences between decentralized exchanges (DEXes) and executes profitable swaps. The bot supports 2-hop, 3-hop, and 4-hop arbitrage routes using a custom on-chain program with address lookup tables for minimal transaction size.

### Supported DEXes

| DEX | Program Type |
|-----|--------------|
| PumpSwap | Pump.fun bonding curve |
| Raydium AMM v4 | Constant product |
| Raydium CLMM | Concentrated liquidity |
| Raydium CPMM | Centralized liquidity |
| Orca Whirlpool | Concentrated liquidity |
| Meteora DLMM | Dynamic liquidity market maker |
| Meteora DAMM v2 | Dynamic AMM |

---

## Features

- **Real-time token discovery** — Subscribes to token migrations and trending tokens for automatic opportunity detection
- **Multi-hop arbitrage** — 2, 3, and 4-hop swap routes via optimized on-chain program
- **7 DEX integration** — PumpSwap, Raydium (AMM/CLMM/CPMM), Orca, Meteora (DLMM/DAMM)
- **Low-latency execution** — Yellowstone gRPC streaming, cached pool data, Jito block engine support
- **Address lookup tables** — Reduced transaction size for faster inclusion
- **Configurable thresholds** — Minimum profit, slippage, and price difference filters
- **Telegram alerts** — Optional notifications for executed trades

---

## Tech Stack

- **Runtime:** Node.js 22+
- **Language:** TypeScript
- **Blockchain:** Solana (mainnet-beta)
- **APIs:** Yellowstone gRPC, Jito Block Engine
- **Key SDKs:** `@solana/web3.js`, Raydium, Orca, Meteora, Pump.fun

---

## Prerequisites

- Node.js 22 or higher
- Solana RPC endpoint (Helius, QuickNode, or similar)
- Geyser gRPC endpoint (for account streaming)
- Minimum 1 SOL in wallet for transaction fees and arbitrage capital

---

## Installation

```bash
# Clone the repository
git clone https://github.com/your-username/solana-arbitrage-bot.git
cd solana-arbitrage-bot

# Install dependencies
npm install
```

---

## Configuration

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your credentials:

   | Variable | Description |
   |----------|-------------|
   | `PRIVATE_KEY` | Base58-encoded wallet secret key |
   | `RPC_ENDPOINT` | Solana RPC URL for reads |
   | `SWQOS_ENDPOINT` | RPC for sending transactions |
   | `GRPC_ENDPOINT` | Yellowstone/Geyser gRPC URL |
   | `API_KEY` | Geyser API key |
   | `QUOTE_AMOUNT` | Trade size in SOL |
   | `SLIPPAGE` | Max slippage tolerance (%) |
   | `MINIMUM_PROFIT` | Minimum profit threshold (SOL) |
   | `BLOCK_ENGINE_URL` | Jito Block Engine URL |
   | `ISJITO` | `true` to use Jito, `false` for standard RPC |

3. Create `tokens.txt` in the project root with initial token mint addresses (one per line).

---

## Usage

```bash
# Start the arbitrage bot
npm start

# Run swap calculation tests
npm run test

# Generate address lookup table from alts.txt
npm run createAlt
```

---

## Arbitrage Program

The on-chain arbitrage program is deployed at:

[**6UZznePGgoykwAutgJFmQce2QQzfYjVcsQesZbRq9Y3b**](https://solscan.io/account/6UZznePGgoykwAutgJFmQce2QQzfYjVcsQesZbRq9Y3b)

---

## Screenshots

| Arbitrage Testing | Results |
|-------------------|---------|
| ![Arbitrage testing](https://azure-legal-macaw-413.mypinata.cloud/ipfs/bafkreihpxbndcnkkpy7k7r4k34pah4lzmpot5bkssuvckki7dn67wc3cti) | ![Results](https://azure-legal-macaw-413.mypinata.cloud/ipfs/bafkreidafhcqurlfqpot5vwx7k6skzoae43sd5ftssaszyoz7ybiuapk7i) |

---

## Roadmap

- **Flash loan integration** — Enable larger trades without upfront capital
- **Dynamic tip optimization** — Adaptive Jito tip for improved inclusion rate
- **Additional DEX support** — Expand to more Solana liquidity venues

---

## Disclaimer

This software is provided as-is for educational and research purposes. Arbitrage trading involves risk. Use at your own discretion. Always verify transactions and amounts before execution.

---

## Contact

- **Telegram:** [@crewsxdev](https://t.me/crewsxdev)

---

## Acknowledgments

Built with [Raydium](https://raydium.io/), [Orca](https://orca.so/), [Meteora](https://meteora.ag/), [Pump.fun](https://pump.fun/), [Yellowstone gRPC](https://github.com/rpcpool/yellowstone-grpc), and the [Solana](https://solana.com/) ecosystem.
