🧭 Solana arbitrage bot development [Project ID: P-680]
Solana arbitrage bot detect price differences between several dexes such as pumpswap, raydium, meteora, orca and make profit.
The purpose of this bot is to build token selection module, price calculation module, arbitrage opportunity detection module and swap module.

🧩 About
This project provide several arbitrage modules and core smart contract for trying 2-hop, 3-hop, 4-hop swaps.

✨ Features
- Dynamic token selection module
 Bot update token list for arbitrage in real time for trending tokens.
- Multi hop smart contract.
 Smart contract has been optimzized for multi hop swaps by reducing transaction size using address lookup table.
- Several dexes support
 Bot currently work with 7 dexes, pumpswap, raydium amm v4, raydium clmm, raydium cpmm, orca whirlpool, meteora damm v2, meteora dlmm.
- Fast transaction building and sending method.
 For sending transaction asap, bot cache all available data and directly stream acount from geyser grpc.
- Address lookup tables
 I already configured address lookup table with the addresses in alts.txt of root directory
 If you want your own ALT, replace addresses in alts.txt and use createALT function of utils.ts

🧠 Tech Stack
Languages:  JavaScript, TypeScript
Frameworks: Node.js
Tools:   VS code, github

⚙️ Installation
Clone the repository
git clone https://github.com/katlogic/solana-arbitrage-bot.git

Navigate to the project directory
cd solana_arbitrage_bot

Install dependencies
npm install  

🚀 Usage
Start the development server
npm start  

🧾 Configuration
Replace .env.example file with a .env file and set following environment variables

PRIVATE_KEY=
COMMITMENT_LEVEL=
RPC_ENDPOINT=   //For rpc calls
SWQOS_ENDPOINT=   //For sending transactions
GRPC_ENDPOINT=
API_KEY=
QUOTE_AMOUNT=
SLIPPAGE=
BLOCK_ENGINE_URL=
ISJITO=   //If true, send tx via jito, if not , send tx via swqos

After setting environment variables, create a tokens.txt file of root directory of project and list initial tokens for arbitrage.


🖼 Screenshots

![Arbitrage testing results](https://azure-legal-macaw-413.mypinata.cloud/ipfs/bafkreihpxbndcnkkpy7k7r4k34pah4lzmpot5bkssuvckki7dn67wc3cti)
![Arbitrage testing rssults](https://azure-legal-macaw-413.mypinata.cloud/ipfs/bafkreidafhcqurlfqpot5vwx7k6skzoae43sd5ftssaszyoz7ybiuapk7i)

Arbitrage program
https://solscan.io/account/6UZznePGgoykwAutgJFmQce2QQzfYjVcsQesZbRq9Y3b

☎️ Contact

GitHub:    https://github.com/katlogic/
Telegram:  tomorrow_150
Discord:   soldev098303

🌟 Acknowledgements
- Used libraries

"@meteora-ag/cp-amm-sdk": "^1.3.2",
"@meteora-ag/dlmm": "^1.9.3",
"@meteora-sdk/core": "^1.4.6",
"@orca-so/whirlpools-sdk": "^0.17.4",
"@pump-fun/pump-sdk": "^1.3.4",
"@pump-fun/pump-swap-sdk": "^0.0.1-beta.52",
"@raydium-io/raydium-sdk": "^1.3.1-beta.47",
"@raydium-io/raydium-sdk-v2": "^0.2.2-alpha",
"@shyft-to/solana-transaction-parser": "^2.0.1",
"@solana/signers": "^2.3.0",
"@solana/spl-token": "^0.4.0",
"@solana/spl-token-metadata": "^0.1.6",
"@solana/web3.js": "^1.89.1",
"@supercharge/queue-datastructure": "^2.1.0",
"@triton-one/yellowstone-grpc": "^4.0.0",

🔎 Furture development
-Flashloan integration
 Currently the maximum trade amount is about 5k for big pools.
 If you have enough funds, you can use this bot without any problem.
 For customers who don't have enough funds, will try flashloan.
-Tip optimization
 Currently tip is static. For the best performance, I am going to optimize fee and tip setting.

This bot is beta version , so can make small profit, but can't expect big profit.
If you want more profit, please feel free to reach out me.

Telegram:  tomorrow_150
Discord:   soldev098303


📖 How to use.
-Setup environments variable such as private key, rpc, grpc urls
-Add token mints addresses you want in tokens.txt of project root directory.