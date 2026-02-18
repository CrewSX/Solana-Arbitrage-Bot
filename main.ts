import dotenv from "dotenv";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  AccountMeta,
  TransactionInstruction,
  ComputeBudgetProgram,
  AddressLookupTableAccount,
  TransactionMessage,
  sendAndConfirmRawTransaction,
  SIGNATURE_LENGTH_IN_BYTES,
} from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { Worker } from "worker_threads";
import type { WorkerResult } from "./workers/getDexAccounts.worker";
dotenv.config();
import { RPC_ENDPOINT,SWQOS_ENDPOINT, PRIVATE_KEY , GRPC_ENDPOINT , API_KEY, COMMITMENT_LEVEL, QUOTE_AMOUNT, X_API_KEY, BLOCK_ENGINE_URL, ISJITO} from "./constants/constants";

/** Set USE_DEX_ACCOUNTS_WORKER=false to run getDexAccounts on the main thread. */
const USE_DEX_ACCOUNTS_WORKER = process.env.USE_DEX_ACCOUNTS_WORKER !== "false";
let dexAccountsWorker: Worker | null = null;
let dexAccountsPendingResolve: ((value: WorkerResult) => void) | null = null;
let dexAccountsTimeoutId: ReturnType<typeof setTimeout> | null = null;

function getDexAccountsWorker(): Worker | null {
  if (!USE_DEX_ACCOUNTS_WORKER) return null;
  if (dexAccountsWorker) return dexAccountsWorker;
  try {
    const workerPath = path.join(__dirname, "workers", "getDexAccounts.worker.ts");
    dexAccountsWorker = new Worker(workerPath, { execArgv: ["-r", "ts-node/register"] });
    dexAccountsWorker.on("message", (msg: WorkerResult) => {
      if (dexAccountsTimeoutId) clearTimeout(dexAccountsTimeoutId);
      dexAccountsTimeoutId = null;
      if (dexAccountsPendingResolve) {
        dexAccountsPendingResolve(msg);
        dexAccountsPendingResolve = null;
      } else {
        applyWorkerResults(msg);
      }
    });
    dexAccountsWorker.on("error", (err) => {
      logger.error("getDexAccounts worker error:");
      if (dexAccountsTimeoutId) clearTimeout(dexAccountsTimeoutId);
      dexAccountsTimeoutId = null;
      if (dexAccountsPendingResolve) {
        dexAccountsPendingResolve({ results: [] });
        dexAccountsPendingResolve = null;
      }
    });
  } catch (e) {
    logger.warn("Could not start getDexAccounts worker, falling back to main thread:");
  }
  return dexAccountsWorker;
}

function applyWorkerResults(msg: WorkerResult) {
  for (const r of msg.results) {
    if (r.accounts) pairAddress_accounts[r.accountKey] = r.accounts.map((s: string) => new PublicKey(s));
  }
}
import Client, { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import WebSocket from 'ws';
import { delay, logger ,calculateSwapOutput,createATA,  PoolReserves, calculateEpochInfoFromSlot} from "./utils";
import BN, { max, min } from "bn.js";
import { SqrtPriceMath  } from "@raydium-io/raydium-sdk-v2";
import { buildArbitrageInstructionData, 
  buildArbitrageAccounts,
  DexProgram, 
  MintInfo,
  HopPoolAccounts,
  SYSTEM_PROGRAM_ID,
  } from "./program/instruction";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getDexAccounts } from "./utils/getDexAccounts";
import { EpochInfo } from "@solana/web3.js";
import { getPriceOfBinByBinId } from "@meteora-ag/dlmm";
import { getPriceFromSqrtPrice } from "@meteora-ag/cp-amm-sdk";
import { getDexFee } from "./utils/getDexFee";
import { MessageV0 } from "@solana/web3.js";
let ws:any;
const connection = new Connection(RPC_ENDPOINT,"confirmed");
const swqos_connection = new Connection(SWQOS_ENDPOINT,"confirmed");
const wallet =  Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY))
const inputMint=new PublicKey("So11111111111111111111111111111111111111112");
const tokensRaw = fs
  .readFileSync("tokens.txt", "utf8")
  .split(/\r?\n/);
const tokens: string[] = [];
for (let i = 0; i < tokensRaw.length; i++) {
  const trimmed = tokensRaw[i].trim();
  if (trimmed) {
    tokens.push(trimmed);
  }
}
let pairAddresses: Record<string, BN[]> = {};
let pairAddress_accounts:Record<string, PublicKey[]>={};
let prices:Record<string, number>={};
let fees:Record<string, number>={};
let isToken2022Bitmap:Record<string, boolean>={};
const lookupTableAddress=new PublicKey("4RqDUqkQqMkbQEAXvEBr5nFhh3hhfeHxeL9gUaMCFzyh");
let lookupTableAccount:AddressLookupTableAccount;
let client: Client;
try{
  client = new Client(GRPC_ENDPOINT, API_KEY, undefined);
}catch(e){
  console.log(e)
}
let stream:any;
let stream2:any;
let stream3:any;
let inter:any;
let inter1:any;
let inter2:any;
let inter3:any;
let inter5:any;
let streamStarted=false;
let streamStarted2=false;
let accountKeysForStream:string[]=[];
let stream_keys:string[]=[];
let currentSlot = new BN(0); // Track current slot from gRPC slot updates
let blockTime = new BN(0);
let jitoTipAccount:string="";
const myHeaders = new Headers();
myHeaders.append("accept", "application/json");
myHeaders.append("x-api-key", X_API_KEY);
const PROGRAM_ID = new PublicKey('6UZznePGgoykwAutgJFmQce2QQzfYjVcsQesZbRq9Y3b');
let recentBlockhash=""
const program_ids={
  "cpmm":new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
  "clmm":new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"),
  "orcawp":new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"),
  "dlmm":new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"),
  "dyn2":new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"),
  "pumpswap":new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"),
  "raydium":new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8")
}
function ws_mig_connect(){
  try{
    // Clean up existing connection if any
    if(ws){
      try{
        ws.removeAllListeners();
        if(ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING){
          ws.close();
        }
      }catch(e){}
    }
    
    logger.info("Attempting to connect to WebSocket: wss://pumpportal.fun/api/data");
    ws=new WebSocket("wss://pumpportal.fun/api/data");
    
    ws.on('open', function open() {
      let payload = {
          method: "subscribeMigration", 
      }
      ws.send(JSON.stringify(payload));
      logger.info("Token migration Subscribed");
    });
    
    ws.on('message', async function message(data:any) {
      try {
        const strData = typeof data === 'string' ? data : data.toString();
        let parsedData = JSON.parse(strData);
        if(parsedData["mint"]!=undefined){
          // const AccountInfo=await connection.getAccountInfo(new PublicKey(parsedData["mint"]));
          // if(!AccountInfo) return;
          // if(AccountInfo.owner.toString()=="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") return;
          logger.info(`New Migration-> ${parsedData["mint"]}`);
          await fs.promises.appendFile("tokens.txt", "\n"+parsedData["mint"], "utf8");
          tokens.push(parsedData["mint"]);
          const isToken2022=await createATA(new PublicKey(parsedData["mint"]), wallet, connection);
          isToken2022Bitmap[parsedData["mint"]]=isToken2022;
        }
      } catch (err) {
        console.error('Error parsing message:', err);
        return;
      }
    });
    
    ws.on("error", function error(err: any) {
      logger.error(`WebSocket error: ${err.message || err}`);
      // Don't reconnect immediately on error, let close handler do it
    });
    
    ws.on("close", function close(code: number, reason: Buffer) {
      logger.warn(`WebSocket closed. Code: ${code}, Reason: ${reason.toString() || 'No reason provided'}`);
      // Wait 5 seconds before reconnecting to avoid hammering the server
      setTimeout(() => {
        logger.info("Reconnecting to WebSocket...");
        ws_mig_connect();
      }, 5000);
    });
  }catch(e){
    logger.error(`Error in ws_mig_connect: ${e}`);
    // Wait 5 seconds before retrying
    setTimeout(() => {
      logger.info("Retrying WebSocket connection...");
      ws_mig_connect();
    }, 5000);
  }
}
ws_mig_connect();
async function getTokenPairaddressesFromDexscreener(tokenAddress:string) {
  try {
    const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${tokenAddress}`, {
        method: 'GET',
        headers: {
          "Accept": "application/json"
        },
    });

    if (!response.ok) {
      logger.error(`API error for token ${tokenAddress}: ${response.status} ${response.statusText}`);
      return {};
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const text = await response.text();
      logger.error(`Non-JSON response for token ${tokenAddress}. Content-Type: ${contentType}, First 100 chars: ${text.substring(0, 100)}`);
      return {};
    }

    const data = await response.json();
    
    // Handle case where API returns an object with pairs array
    const pairs = Array.isArray(data) ? data : (data.pairs || []);
    
    const addresses: Record<string, BN[]> = {};
    for (let info of pairs){
      try{
        if(info["baseToken"]["address"]=="So11111111111111111111111111111111111111112"||info["quoteToken"]["address"]=="So11111111111111111111111111111111111111112"){
          const supply=info["marketCap"]/info["priceUsd"];
          if(info["dexId"]=="pumpswap"){
            if(info["liquidity"] && info["liquidity"]["usd"]>=500&&info["pairAddress"]){
              addresses[`${tokenAddress}_pumpswap_${info["pairAddress"]}_${supply}_${info["baseToken"]["address"]}_${info["quoteToken"]["address"]}`]=[new BN(0),new BN(0),new BN(0),new BN(0),new BN(0)];
            }
          }
          if(info["dexId"]=="meteora"&&info["labels"].includes("DLMM")){
            if(info["liquidity"] && info["liquidity"]["usd"]>=500&&info["pairAddress"]){
              addresses[`${tokenAddress}_dlmm_${info["pairAddress"]}_${supply}_${info["baseToken"]["address"]}_${info["quoteToken"]["address"]}`]=[new BN(0),new BN(0),new BN(0),new BN(0),new BN(0)];
            }
          }
          if(info["dexId"]=="raydium"&&info["labels"]==undefined){
            if(info["liquidity"] && info["liquidity"]["usd"]>=500&&info["pairAddress"]){
              addresses[`${tokenAddress}_raydium_${info["pairAddress"]}_${supply}_${info["baseToken"]["address"]}_${info["quoteToken"]["address"]}`]=[new BN(0),new BN(0),new BN(0),new BN(0),new BN(0)];
            }
          }
          if(info["dexId"]=="raydium"&&info["labels"].includes("CLMM")){
            if(info["liquidity"] && info["liquidity"]["usd"]>=500&&info["pairAddress"]){
              addresses[`${tokenAddress}_clmm_${info["pairAddress"]}_${supply}_${info["baseToken"]["address"]}_${info["quoteToken"]["address"]}`]=[new BN(0),new BN(0),new BN(0),new BN(0),new BN(0)];
            }
          }
          if(info["dexId"]=="orca"&&info["labels"].includes("wp")){
            if(info["liquidity"] && info["liquidity"]["usd"]>=500&&info["pairAddress"]){
              addresses[`${tokenAddress}_orcawp_${info["pairAddress"]}_${supply}_${info["baseToken"]["address"]}_${info["quoteToken"]["address"]}`]=[new BN(0),new BN(0),new BN(0),new BN(0),new BN(0)];
            }
          }
          // if(info["dexId"]=="meteora"&&info["labels"].includes("DYN2")){
          //   if(info["liquidity"] && info["liquidity"]["usd"]>=50000&&info["pairAddress"]){
          //     addresses[`${tokenAddress}_dyn2_${info["pairAddress"]}_${supply}_${info["baseToken"]["address"]}_${info["quoteToken"]["address"]}`]=[new BN(0),new BN(0),new BN(0),new BN(0),new BN(0)];
          //   }
          // }
          if(info["dexId"]=="raydium"&&info["labels"].includes("CPMM")){
            if(info["liquidity"] && info["liquidity"]["usd"]>=500&&info["pairAddress"]){

              addresses[`${tokenAddress}_cpmm_${info["pairAddress"]}_${supply}_${info["baseToken"]["address"]}_${info["quoteToken"]["address"]}`]=[new BN(0),new BN(0),new BN(0),new BN(0),new BN(0)];
            }
          }
        }
      }catch(e){}
    }
    // if(Object.keys(addresses).length>2){
    //   console.log(tokenAddress)
    // }
    return addresses;
  } catch (error: any) {
    logger.error(`Error fetching pair addresses for token ${tokenAddress}: ${error.message}`);
    return {};
  }
}
async function getTokenPairaddresses(tokenAddress:string) {
  try {

    const addresses:string[]=[];
    const pumpamm_basePools = await connection.getProgramAccounts(new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"), {
      dataSlice: { offset: 0, length: 0 }, 
      filters: [
        { dataSize: 301 },
        { memcmp: { offset: 43, bytes: tokenAddress } },
      ],
    });
    const pumpamm_quotePools = await connection.getProgramAccounts(new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"), {
      dataSlice: { offset: 0, length: 0 },
      filters: [
        { dataSize: 301 },
        { memcmp: { offset: 75, bytes: tokenAddress } },
      ],
    });

    const raydium_basePools = await connection.getProgramAccounts(new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"), {
      dataSlice: { offset: 0, length: 0 }, 
      filters: [
        { dataSize: 752 },
        { memcmp: { offset: 400, bytes: tokenAddress } },
      ],
    });
    const raydium_quotePools = await connection.getProgramAccounts(new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"), {
      dataSlice: { offset: 0, length: 0 },
      filters: [
        { dataSize: 752 },
        { memcmp: { offset: 432, bytes: tokenAddress } },
      ],
    });

    const raydiumcpmm_basePools = await connection.getProgramAccounts(new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"), {
      dataSlice: { offset: 0, length: 0 }, 
      filters: [
        { dataSize: 637 },
        { memcmp: { offset: 168, bytes: tokenAddress } },
      ],
    });
    const raydiumcpmm_quotePools = await connection.getProgramAccounts(new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"), {
      dataSlice: { offset: 0, length: 0 },
      filters: [
        { dataSize: 637 },
        { memcmp: { offset: 200, bytes: tokenAddress } },
      ],
    });

    const raydiumclmm_basePools = await connection.getProgramAccounts(new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"), {
      dataSlice: { offset: 0, length: 0 }, 
      filters: [
        { dataSize: 1544 },
        { memcmp: { offset: 41, bytes: tokenAddress } },
      ],
    });
    const raydiumclmm_quotePools = await connection.getProgramAccounts(new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"), {
      dataSlice: { offset: 0, length: 0 },
      filters: [
        { dataSize: 1544 },
        { memcmp: { offset: 73, bytes: tokenAddress } },
      ],
    });

    const orcawp_basePools = await connection.getProgramAccounts(new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"), {
      dataSlice: { offset: 0, length: 0 }, 
      filters: [
        { dataSize: 653 },
        { memcmp: { offset: 101, bytes: tokenAddress } },
      ],
    });
    const orcawp_quotePools = await connection.getProgramAccounts(new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"), {
      dataSlice: { offset: 0, length: 0 },
      filters: [
        { dataSize: 653 },
        { memcmp: { offset: 197, bytes: tokenAddress } },
      ],
    });

    const meteoradlmm_basePools = await connection.getProgramAccounts(new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"), {
      dataSlice: { offset: 0, length: 0 }, 
      filters: [
        { dataSize: 904 },
        { memcmp: { offset: 88, bytes: tokenAddress } },
      ],
    });
    const meteoradlmm_quotePools = await connection.getProgramAccounts(new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"), {
      dataSlice: { offset: 0, length: 0 },
      filters: [
        { dataSize: 904 },
        { memcmp: { offset: 120, bytes: tokenAddress } },
      ],
    });

    const meteoradyn2_basePools = await connection.getProgramAccounts(new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"), {
      dataSlice: { offset: 0, length: 0 }, 
      filters: [
        { dataSize: 1112 },
        { memcmp: { offset: 168, bytes: tokenAddress } },
      ],
    });
    const meteoradyn2_quotePools = await connection.getProgramAccounts(new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"), {
      dataSlice: { offset: 0, length: 0 },
      filters: [
        { dataSize: 1112 },
        { memcmp: { offset: 200, bytes: tokenAddress } },
      ],
    });
    for (const acc of pumpamm_basePools) {
      addresses.push(acc.pubkey.toBase58());
    }
    for (const acc of pumpamm_quotePools) {
      addresses.push(acc.pubkey.toBase58());
    }
    for (const acc of raydium_basePools) {
      addresses.push(acc.pubkey.toBase58());
    }
    for (const acc of raydium_quotePools) {
      addresses.push(acc.pubkey.toBase58());
    }
    for (const acc of raydiumcpmm_basePools) {
      addresses.push(acc.pubkey.toBase58());
    }
    for (const acc of raydiumcpmm_quotePools) {
      addresses.push(acc.pubkey.toBase58());
    }
    for (const acc of raydiumclmm_basePools) {
      addresses.push(acc.pubkey.toBase58());
    }
    for (const acc of raydiumclmm_quotePools) {
      addresses.push(acc.pubkey.toBase58());
    }
    for (const acc of orcawp_basePools) {
      addresses.push(acc.pubkey.toBase58());
    }
    for (const acc of orcawp_quotePools) {
      addresses.push(acc.pubkey.toBase58());
    }
    for (const acc of meteoradlmm_basePools) {
      addresses.push(acc.pubkey.toBase58());
    }
    for (const acc of meteoradlmm_quotePools) {
      addresses.push(acc.pubkey.toBase58());
    }
    for (const acc of meteoradyn2_basePools) {
      addresses.push(acc.pubkey.toBase58());
    }
    for (const acc of meteoradyn2_quotePools) {
      addresses.push(acc.pubkey.toBase58());
    }
    if(tokenAddress=="CSrwNk6B1DwWCHRMsaoDVUfD5bBMQCJPY72ZG3Nnpump") {
      console.log(addresses.length, addresses)
    }
    // const addressesFromDexscreener=await getTokenPairaddressesFromDexscreener(tokenAddress);
    // if(addressesFromDexscreener.length>=2){
    //   addresses.push(...addressesFromDexscreener);
    // }
    return addresses;
  } catch (error: any) {
    logger.error(`Error fetching pair addresses for token ${tokenAddress}: ${error}`);
    return [];
  }
}

(async () => {
  const accounts = (await connection.getAddressLookupTable(lookupTableAddress)).value;
  if (!accounts) {
    throw new Error('Failed to fetch lookup table');
  }
  lookupTableAccount=accounts;
  for (let i = 0; i < tokens.length; i += 290) {
    const batch = tokens.slice(i, i + 290);
    const promises: Promise<Record<string, BN[]>>[] = [];
    for (let j = 0; j < batch.length; j++) {
      promises.push(getTokenPairaddressesFromDexscreener(batch[j]));
    }
    const pairAddressesResults = await Promise.allSettled(promises);
    pairAddressesResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const pairAddressesForToken = result.value;
        if(Object.keys(pairAddressesForToken).length>=2){
          Object.assign(pairAddresses, pairAddressesForToken);
        }
      } else {
        logger.error(`Failed to fetch addresses for token ${batch[index]}: ${result.reason}`);
      }
    });
    if (i + 290 < tokens.length) {
      await delay(65000);
    }
  }
  logger.info("Setting up wallet token accounts...");
  await setupATAs(tokens);
  recentBlockhash=(await connection.getLatestBlockhash({commitment:"processed"})).blockhash;
  inter1=setInterval(async ()=>{
      recentBlockhash=(await connection.getLatestBlockhash({commitment:"processed"})).blockhash;
  }, 1000)
  logger.info("Finished wallet token accounts setting")
  await start_arbitrage();
  
})();

setInterval(async () => {
  let updatedPairAddresses: Record<string, BN[]> = {};
  for (let i = 0; i < tokens.length; i += 290) {
    const batch = tokens.slice(i, i + 290);
    const promises: Promise<Record<string, BN[]>>[] = [];
    for (let j = 0; j < batch.length; j++) {
      promises.push(getTokenPairaddressesFromDexscreener(batch[j]));
    }
    const pairAddressesResults = await Promise.allSettled(promises);
    pairAddressesResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const pairAddressesForToken = result.value;
        if(Object.keys(pairAddressesForToken).length>=2){
          Object.assign(updatedPairAddresses, pairAddressesForToken);
        }
      } else {
        logger.error(`Failed to fetch addresses for token ${batch[index]}: ${result.reason}`);
      }
    });
    if (i + 290 < tokens.length) {
      await delay(65000);
    }
  }
  // if(Object.keys(pairAddresses).length!=Object.keys(updatedPairAddresses).length){
    pairAddresses=updatedPairAddresses;
    start_arbitrage();
  // }
}, 600000);

async function startStream2(){
  streamStarted2=true;
  try{
    accountKeysForStream= [...new Set(accountKeysForStream)];
    let is_running=false;
    const request: SubscribeRequest = {
      slots: {},
      accounts: {
          "arb":{
              account:accountKeysForStream,
              owner:[],
              filters:[]
          }
      },
      transactions: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.PROCESSED, // Subscribe to processed blocks for the fastest updates
      entry: {},
      transactionsStatus: {}
    }
    clearInterval(inter3);
    inter3=setInterval(async()=>{
      try{
          if(is_running==false){
              is_running=true;
              stream2=await client.subscribe();
              const streamClosed = new Promise<void>((resolve, reject) => {
                  stream2.on("error", (error:any) => {
                      reject(error);
                      if(error.code==1||error.code==7){
                          clearInterval(inter);
                      }
                      is_running=false;
                  });
                  stream2.on("end", resolve); 
                  stream2.on("close", resolve);
              });
              let signature="";
              let prev_data:Buffer;
              stream2.on("data", async (data:any) => {
                if(data.account!=undefined){                           
                  const sig=bs58.encode(data.account.account.txnSignature);
                  if(signature!=sig){
                      signature=sig;
                      try{

                        if(prev_data!=data.account.account.data){
                            currentSlot=new BN(data.account.account.slot);
                            prev_data=data.account.account.data;
                            const poolData=data.account.account.data;
                            const poolAddress=bs58.encode(data.account.account["pubkey"]);
                            if(poolData.length==1544){
                              // console.log("Raydium clmm data",1544,"\n", bs58.encode(data.account.account.pubkey));
                              
                              findArbtrageOpportunities({
                                dex:"clmm",
                                poolAddress:poolAddress,
                                poolData:poolData,
                                poolReserves:{
                                  reserveA: new BN(0),
                                  decimalA: 0,
                                  reserveB: new BN(0),
                                  decimalB: 0,
                                  preReserveA: new BN(0),
                                  preReserveB: new BN(0)
                                },
                                sig:sig
                              });
                            }else if(poolData.length==653){
                              // console.log("Orca whirlpool data",653,"\n", bs58.encode(data.account.account.pubkey));
                              findArbtrageOpportunities({
                                dex:"orcawp",
                                poolAddress:poolAddress,
                                poolData:poolData,
                                poolReserves:{
                                  reserveA: new BN(0),
                                  decimalA: 0,
                                  reserveB: new BN(0),
                                  decimalB: 0,
                                  preReserveA: new BN(0),
                                  preReserveB: new BN(0)
                                },
                                sig:sig
                              });
                            }else if(poolData.length==904){
                              // if(poolAddress=="4CTUHtiHrPHFT4Zc1qNScrposmM7xfupU7EVDWCR7PZw"){
                              //   logger.info(sig);
                              // }
                              // console.log("Meteora dlmm data",904,"\n", bs58.encode(data.account.account.pubkey));
                              findArbtrageOpportunities({
                                dex:"dlmm",
                                poolAddress:poolAddress,
                                poolData:poolData,
                                poolReserves:{
                                  reserveA: new BN(0),
                                  decimalA: 0,
                                  reserveB: new BN(0),
                                  decimalB: 0,
                                  preReserveA: new BN(0),
                                  preReserveB: new BN(0)
                                },
                                sig:sig
                              });
                            }else if(poolData.length==1112){
                              // console.log("Meteora damm v2 data",1112,"\n", bs58.encode(data.account.account.pubkey));
                              findArbtrageOpportunities({
                                dex:"dyn2",
                                poolAddress:poolAddress,
                                poolData:poolData,
                                poolReserves:{
                                  reserveA: new BN(0),
                                  decimalA: 0,
                                  reserveB: new BN(0),
                                  decimalB: 0,
                                  preReserveA: new BN(0),
                                  preReserveB: new BN(0)
                                },
                                sig:sig
                              });
                            }else{
                              // console.log("Invalid data", poolData.length, "\n", bs58.encode(data.account.account.pubkey));
                            }
                        }

                      }catch(e){console.log(e)}
                  }
                }
              })
              await new Promise<void>((resolve, reject) => {
                  stream2.write(request, (err: null | undefined) => {
                      if (err === null || err === undefined) {
                      resolve();
                      } else {
                      reject(err);
                      }
                  });
              }).catch((reason) => {
                  throw reason;
              });
              await streamClosed;
          }
      }catch(e){
        console.log(e)
      }
    }, 400)
  }catch(e){
    console.log("Error while creating stream...");
  }
}
async function startStream(){
  streamStarted=true;
  try{
    let is_running=false;
    const request: SubscribeRequest = {
        "slots": {},
        accounts: {},
        "transactions": {
          pumpfun: {
              "vote": false,
              "failed": false,
              accountInclude: stream_keys,
              accountExclude: [],
              accountRequired: []
          }
        },
        "blocks": {},
        "blocksMeta": {},
        "accountsDataSlice": [],
        "commitment": CommitmentLevel.PROCESSED, // Subscribe to processed blocks for the fastest updates
        entry: {},
        transactionsStatus: {}
    }
    clearInterval(inter);
    inter=setInterval(async()=>{
      try{
          if(is_running==false){
              is_running=true;
              stream=await client.subscribe();
              const streamClosed = new Promise<void>((resolve, reject) => {
                  stream.on("error", (error:any) => {
                      reject(error);
                      if(error.code==1||error.code==7){
                          clearInterval(inter);
                      }
                      is_running=false;
                  });
                  stream.on("end", resolve); 
                  stream.on("close", resolve);
              });
              let signature="";
              stream.on("data", async (data:any) => {       
                if(data.transaction!=undefined){         
                    currentSlot = new BN(data.transaction.slot);        
                    // console.log("tx", data)                  
                      const sig=bs58.encode(data.transaction.transaction.signature);
                      if(signature!=sig){
                        signature=sig;
                        let keys: string[]=[];
                        for (let i = 0; i < data.transaction.transaction.transaction.message.accountKeys.length; i++) {
                          const key = data.transaction.transaction.transaction.message.accountKeys[i];
                          keys.push(bs58.encode(key));
                        }
                        for (let i = 0; i < data.transaction.transaction.meta.loadedWritableAddresses.length; i++) {
                          const key = data.transaction.transaction.meta.loadedWritableAddresses[i];
                          keys.push(bs58.encode(key));
                        }
                        for (let i = 0; i < data.transaction.transaction.meta.loadedReadonlyAddresses.length; i++) {
                          const key = data.transaction.transaction.meta.loadedReadonlyAddresses[i];
                          keys.push(bs58.encode(key));
                        }
                        
                        for(let log of data.transaction.transaction.meta.logMessages){
                          if(log.includes("Program log: No arbitrage profit found!")){
                            return
                          }
                        };
                        
                        for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
                          const key = keys[keyIndex];
                          for(const pairAddress of Object.keys(pairAddresses)){
                            if(pairAddress.split("_")[2]==key){
                              try {
                                const poolReserves: PoolReserves = {
                                  reserveA: new BN(0),
                                  reserveB: new BN(0),
                                  preReserveA:new BN(0),
                                  preReserveB:new BN(0),
                                  decimalA: 0,
                                  decimalB: 0
                                }
                                if(pairAddress.split("_")[1]=="pumpswap") {
                                  for (let i = 0; i < data.transaction.transaction.meta.preTokenBalances.length; i++) {
                                    const balance = data.transaction.transaction.meta.preTokenBalances[i];
                                    if(balance.owner==key){
                                      if(balance.mint=="So11111111111111111111111111111111111111112"){
                                        poolReserves.preReserveB=new BN(balance.uiTokenAmount.amount);
                                      }else if(balance.mint==pairAddress.split("_")[0]){
                                        poolReserves.preReserveA=new BN(balance.uiTokenAmount.amount); 
                                      }                                      
                                    }
                                  }
                                  for (let i = 0; i < data.transaction.transaction.meta.postTokenBalances.length; i++) {
                                    const balance = data.transaction.transaction.meta.postTokenBalances[i];
                                    if(balance.owner==key){
                                      if(balance.mint=="So11111111111111111111111111111111111111112"){
                                        poolReserves.reserveB=new BN(balance.uiTokenAmount.amount);
                                        poolReserves.decimalB=balance.uiTokenAmount.decimals;                                     
                                      }else if(balance.mint==pairAddress.split("_")[0]){
                                        poolReserves.reserveA=new BN(balance.uiTokenAmount.amount); 
                                        poolReserves.decimalA=balance.uiTokenAmount.decimals;
                                      }                                      
                                    }
                                  }
                                  if(poolReserves.reserveA.isZero() || poolReserves.reserveB.isZero()){
                                    return;
                                  }               
                                  if((pairAddresses[pairAddress][0] && pairAddresses[pairAddress][0].eq(poolReserves.reserveA)) || 
                                     (pairAddresses[pairAddress][1] && pairAddresses[pairAddress][1].eq(poolReserves.reserveB))){
                                    return;
                                  }
                                  pairAddresses[pairAddress][0]=(poolReserves.reserveA);
                                  pairAddresses[pairAddress][1]=(poolReserves.reserveB);
                                  pairAddresses[pairAddress][2]=new BN(poolReserves.decimalA);
                                  pairAddresses[pairAddress][3]=new BN(poolReserves.decimalB);    
                                  let isBuy=true;
                                  if(poolReserves.reserveB.gt(poolReserves.preReserveB)){
                                    isBuy=true;
                                  }else{
                                    isBuy = false;
                                  }
                                  // const tradeAmount = (poolReserves.reserveB.sub(poolReserves.preReserveB)).div(new BN(LAMPORTS_PER_SOL)).abs();
                                  // logger.info(`${sig}  pumpswap`);
                                  findArbtrageOpportunities({
                                    dex:"pumpswap",
                                    poolAddress:pairAddress.split("_")[2],
                                    poolReserves:poolReserves,
                                    poolData:Buffer.from([0]),
                                    sig:sig
                                  })
                                }
                                if(pairAddress.split("_")[1]=="cpmm") {
                                  const pool_accounts=pairAddress_accounts[pairAddress];
                                  let wsolATA="";
                                  let tokenATA="";
                                  if(pool_accounts[0].toString()==NATIVE_MINT.toString()){
                                    wsolATA=pool_accounts[4].toString();
                                    tokenATA=pool_accounts[5].toString();
                                  }else{
                                    tokenATA=pool_accounts[4].toString();
                                    wsolATA=pool_accounts[5].toString();
                                  }
                                  const wsolAtaIndex=keys.indexOf(wsolATA);
                                  const tokenAtaIndex=keys.indexOf(tokenATA);
                                  for (let i = 0; i < data.transaction.transaction.meta.preTokenBalances.length; i++) {
                                    const balance = data.transaction.transaction.meta.preTokenBalances[i];
                                    if(balance.accountIndex==wsolAtaIndex){
                                      poolReserves.preReserveB=new BN(balance.uiTokenAmount.amount);
                                    }
                                    if(balance.accountIndex==tokenAtaIndex){
                                      poolReserves.preReserveA=new BN(balance.uiTokenAmount.amount);
                                    }
                                  }
                                  for (let i = 0; i < data.transaction.transaction.meta.postTokenBalances.length; i++) {
                                    const balance = data.transaction.transaction.meta.postTokenBalances[i];
                                    if(balance.accountIndex==wsolAtaIndex){
                                      poolReserves.reserveB=new BN(balance.uiTokenAmount.amount);
                                      poolReserves.decimalB=balance.uiTokenAmount.decimals
                                    }
                                    if(balance.accountIndex==tokenAtaIndex){
                                      poolReserves.reserveA=new BN(balance.uiTokenAmount.amount);
                                      poolReserves.decimalA=balance.uiTokenAmount.decimals
                                    }
                                  } 
                                  if(poolReserves.reserveA.isZero() || poolReserves.reserveB.isZero()){
                                    return;
                                  }                         
                                  if((pairAddresses[pairAddress][0] && pairAddresses[pairAddress][0].eq(poolReserves.reserveA)) || 
                                     (pairAddresses[pairAddress][1] && pairAddresses[pairAddress][1].eq(poolReserves.reserveB))){
                                    return;
                                  }
                                  pairAddresses[pairAddress][0]=(poolReserves.reserveA);
                                  pairAddresses[pairAddress][1]=(poolReserves.reserveB);
                                  pairAddresses[pairAddress][2]=new BN(poolReserves.decimalA);
                                  pairAddresses[pairAddress][3]=new BN(poolReserves.decimalB);  
                                  let isBuy=true;
                                  if(poolReserves.reserveB.gt(poolReserves.preReserveB)){
                                    isBuy=true;
                                  }else{
                                    isBuy = false;
                                  }
                                  // logger.info(`${sig}  cpmm`);
                                  // const tradeAmount = (poolReserves.reserveB.sub(poolReserves.preReserveB)).div(new BN(LAMPORTS_PER_SOL)).abs();
                                  findArbtrageOpportunities({
                                    dex:"cpmm",
                                    poolAddress:pairAddress.split("_")[2],
                                    poolReserves:poolReserves,
                                    poolData:Buffer.from([0]),
                                    sig:sig
                                  })
                                }
                                if(pairAddress.split("_")[1]=="dyn2") {
                                  const pool_accounts=pairAddress_accounts[pairAddress];
                                  let wsolATA="";
                                  let tokenATA="";
                                  if(pool_accounts[0].toString()==NATIVE_MINT.toString()){
                                    wsolATA=pool_accounts[3].toString();
                                    tokenATA=pool_accounts[4].toString();
                                  }else{
                                    tokenATA=pool_accounts[3].toString();
                                    wsolATA=pool_accounts[4].toString();
                                  }
                                  const wsolAtaIndex=keys.indexOf(wsolATA);
                                  const tokenAtaIndex=keys.indexOf(tokenATA);
                                  for (let i = 0; i < data.transaction.transaction.meta.preTokenBalances.length; i++) {
                                    const balance = data.transaction.transaction.meta.preTokenBalances[i];
                                    if(balance.accountIndex==wsolAtaIndex){
                                      poolReserves.preReserveB=new BN(balance.uiTokenAmount.amount);
                                    }
                                    if(balance.accountIndex==tokenAtaIndex){
                                      poolReserves.preReserveA=new BN(balance.uiTokenAmount.amount);
                                    }
                                  }
                                  for (let i = 0; i < data.transaction.transaction.meta.postTokenBalances.length; i++) {
                                    const balance = data.transaction.transaction.meta.postTokenBalances[i];
                                    if(balance.accountIndex==wsolAtaIndex){
                                      poolReserves.reserveB=new BN(balance.uiTokenAmount.amount);
                                      poolReserves.decimalB=balance.uiTokenAmount.decimals
                                    }
                                    if(balance.accountIndex==tokenAtaIndex){
                                      poolReserves.reserveA=new BN(balance.uiTokenAmount.amount);
                                      poolReserves.decimalA=balance.uiTokenAmount.decimals
                                    }
                                  } 
                                  if(poolReserves.reserveA.isZero() || poolReserves.reserveB.isZero()){
                                    return;
                                  }                   
                                  if((pairAddresses[pairAddress][0] && pairAddresses[pairAddress][0].eq(poolReserves.reserveA)) || 
                                     (pairAddresses[pairAddress][1] && pairAddresses[pairAddress][1].eq(poolReserves.reserveB))){
                                    return;
                                  }
                                  pairAddresses[pairAddress][0]=(poolReserves.reserveA);
                                  pairAddresses[pairAddress][1]=(poolReserves.reserveB);
                                  pairAddresses[pairAddress][2]=new BN(poolReserves.decimalA);
                                  pairAddresses[pairAddress][3]=new BN(poolReserves.decimalB);  
                                  let isBuy=true;
                                  if(poolReserves.reserveB.gt(poolReserves.preReserveB)){
                                    isBuy=true;
                                  }else{
                                    isBuy = false;
                                  }
                                  // logger.info(`${sig}  dyn2`);
                                  // const tradeAmount = (poolReserves.reserveB.sub(poolReserves.preReserveB)).div(new BN(LAMPORTS_PER_SOL)).abs();
                                  // findArbtrageOpportunities(pairAddress, "dyn2", isBuy, tradeAmount, poolReserves, sig)


                                }
                                if(pairAddress.split("_")[1]=="dlmm") {
                                  // if(key=="4CTUHtiHrPHFT4Zc1qNScrposmM7xfupU7EVDWCR7PZw"){
                                  //   logger.info(`Dlmm ,  ${sig}`);
                                  // }
                                  for (let i = 0; i < data.transaction.transaction.meta.preTokenBalances.length; i++) {
                                    const balance = data.transaction.transaction.meta.preTokenBalances[i];
                                    if(balance.owner==key){
                                      if(balance.mint=="So11111111111111111111111111111111111111112"){
                                        poolReserves.preReserveB=new BN(balance.uiTokenAmount.amount);
                                        
                                      }else if(balance.mint==pairAddress.split("_")[0]){
                                        poolReserves.preReserveA=new BN(balance.uiTokenAmount.amount); 
                                      }
                                      
                                    }
                                  }
                                  for (let i = 0; i < data.transaction.transaction.meta.postTokenBalances.length; i++) {
                                    const balance = data.transaction.transaction.meta.postTokenBalances[i];
                                    if(balance.owner==key){
                                      if(balance.mint=="So11111111111111111111111111111111111111112"){
                                        poolReserves.reserveB=new BN(balance.uiTokenAmount.amount);
                                        poolReserves.decimalB=balance.uiTokenAmount.decimals;
                                        
                                      }else if(balance.mint==pairAddress.split("_")[0]){
                                        poolReserves.reserveA=new BN(balance.uiTokenAmount.amount); 
                                        poolReserves.decimalA=balance.uiTokenAmount.decimals;
                                      }
                                      
                                    }
                                  }
                                  if(poolReserves.reserveA.isZero() || poolReserves.reserveB.isZero()){
                                    return;
                                  }               
                                  if((pairAddresses[pairAddress][0] && pairAddresses[pairAddress][0].eq(poolReserves.reserveA)) || 
                                     (pairAddresses[pairAddress][1] && pairAddresses[pairAddress][1].eq(poolReserves.reserveB))){
                                    return;
                                  }
                                  pairAddresses[pairAddress][0]=(poolReserves.reserveA);
                                  pairAddresses[pairAddress][1]=(poolReserves.reserveB);
                                  pairAddresses[pairAddress][2]=new BN(poolReserves.decimalA);
                                  pairAddresses[pairAddress][3]=new BN(poolReserves.decimalB);    
                                  let isBuy=true;
                                  if(poolReserves.reserveB.gt(poolReserves.preReserveB)){
                                    isBuy=true;
                                  }else{
                                    isBuy = false;
                                  }
                                  // logger.info(`${sig}  dlmm`);
                                  // const tradeAmount = (poolReserves.reserveB.sub(poolReserves.preReserveB)).div(new BN(LAMPORTS_PER_SOL)).abs();
                                  // findArbtrageOpportunities(pairAddress, "dlmm", isBuy, tradeAmount, poolReserves, sig)

                                }
                                if(pairAddress.split("_")[1]=="raydium") {
                                  const pool_accounts=pairAddress_accounts[pairAddress];
                                  let wsolATA="";
                                  let tokenATA="";
                                  if(pool_accounts[0].toString()==NATIVE_MINT.toString()){
                                    wsolATA=pool_accounts[3].toString();
                                    tokenATA=pool_accounts[4].toString();
                                  }else{
                                    tokenATA=pool_accounts[3].toString();
                                    wsolATA=pool_accounts[4].toString();
                                  }
                                  const wsolAtaIndex=keys.indexOf(wsolATA);
                                  const tokenAtaIndex=keys.indexOf(tokenATA);
                                  for (let i = 0; i < data.transaction.transaction.meta.preTokenBalances.length; i++) {
                                    const balance = data.transaction.transaction.meta.preTokenBalances[i];
                                    if(balance.accountIndex==wsolAtaIndex){
                                      poolReserves.preReserveB=new BN(balance.uiTokenAmount.amount);
                                    }
                                    if(balance.accountIndex==tokenAtaIndex){
                                      poolReserves.preReserveA=new BN(balance.uiTokenAmount.amount);
                                    }
                                  }
                                  for (let i = 0; i < data.transaction.transaction.meta.postTokenBalances.length; i++) {
                                    const balance = data.transaction.transaction.meta.postTokenBalances[i];
                                    if(balance.accountIndex==wsolAtaIndex){
                                      poolReserves.reserveB=new BN(balance.uiTokenAmount.amount);
                                      poolReserves.decimalB=balance.uiTokenAmount.decimals
                                    }
                                    if(balance.accountIndex==tokenAtaIndex){
                                      poolReserves.reserveA=new BN(balance.uiTokenAmount.amount);
                                      poolReserves.decimalA=balance.uiTokenAmount.decimals
                                    }
                                  } 
                                  if(poolReserves.reserveA.isZero() || poolReserves.reserveB.isZero()){
                                    return;
                                  }             
                                  if((pairAddresses[pairAddress][0] && pairAddresses[pairAddress][0].eq(poolReserves.reserveA)) || 
                                     (pairAddresses[pairAddress][1] && pairAddresses[pairAddress][1].eq(poolReserves.reserveB))){
                                    return;
                                  }
                                  pairAddresses[pairAddress][0]=poolReserves.reserveA;
                                  pairAddresses[pairAddress][1]=poolReserves.reserveB;
                                  pairAddresses[pairAddress][2]=new BN(poolReserves.decimalA);
                                  pairAddresses[pairAddress][3]=new BN(poolReserves.decimalB);
                                  let isBuy=true;
                                  if(poolReserves.reserveB.gt(poolReserves.preReserveB)){
                                    isBuy=true;
                                  }else{
                                    isBuy = false;
                                  }
                                  // logger.info(`${sig}  raydium`);
                                  // const tradeAmount = (poolReserves.reserveB.sub(poolReserves.preReserveB)).div(new BN(LAMPORTS_PER_SOL)).abs();
                                  // console.log(key, poolReserves.reserveA.toString(), poolReserves.reserveB.toString());
                                  findArbtrageOpportunities({
                                    dex:"raydium",
                                    poolAddress:pairAddress.split("_")[2],
                                    poolReserves:poolReserves,
                                    poolData:Buffer.from([0]),
                                    sig:sig
                                  })                                }
                                if(pairAddress.split("_")[1]=="clmm") {
                                  for (let i = 0; i < data.transaction.transaction.meta.preTokenBalances.length; i++) {
                                    const balance = data.transaction.transaction.meta.preTokenBalances[i];
                                    if(balance.owner==key){
                                      if(balance.mint=="So11111111111111111111111111111111111111112"){
                                        poolReserves.preReserveB=new BN(balance.uiTokenAmount.amount);
                                        
                                      }else if(balance.mint==pairAddress.split("_")[0]){
                                        poolReserves.preReserveA=new BN(balance.uiTokenAmount.amount); 
                                      }
                                      
                                    }
                                  }
                                  for (let i = 0; i < data.transaction.transaction.meta.postTokenBalances.length; i++) {
                                    const balance = data.transaction.transaction.meta.postTokenBalances[i];
                                    if(balance.owner==key){
                                      if(balance.mint=="So11111111111111111111111111111111111111112"){
                                        poolReserves.reserveB=new BN(balance.uiTokenAmount.amount);
                                        poolReserves.decimalB=balance.uiTokenAmount.decimals;
                                        
                                      }else if(balance.mint==pairAddress.split("_")[0]){
                                        poolReserves.reserveA=new BN(balance.uiTokenAmount.amount); 
                                        poolReserves.decimalA=balance.uiTokenAmount.decimals;
                                      }
                                      
                                    }
                                  } 
                                  if(poolReserves.reserveA.isZero() || poolReserves.reserveB.isZero()){
                                    return;
                                  }             
                                  if((pairAddresses[pairAddress][0] && pairAddresses[pairAddress][0].eq(poolReserves.reserveA)) || 
                                     (pairAddresses[pairAddress][1] && pairAddresses[pairAddress][1].eq(poolReserves.reserveB))){
                                    return;
                                  }
                                  pairAddresses[pairAddress][0]=(poolReserves.reserveA);
                                  pairAddresses[pairAddress][1]=(poolReserves.reserveB);
                                  pairAddresses[pairAddress][2]=new BN(poolReserves.decimalA);
                                  pairAddresses[pairAddress][3]=new BN(poolReserves.decimalB);
                                  let isBuy=true;
                                  if(poolReserves.reserveB.gt(poolReserves.preReserveB)){
                                    isBuy=true;
                                  }else{
                                    isBuy = false;
                                  }
                                  // logger.info(`${sig}  clmm`);
                                  // const tradeAmount = (poolReserves.reserveB.sub(poolReserves.preReserveB)).div(new BN(LAMPORTS_PER_SOL)).abs();
                                  // findArbtrageOpportunities(pairAddress, "clmm", isBuy, tradeAmount, poolReserves, sig)
                                }
                                if(pairAddress.split("_")[1]=="orcawp") {
                                  if(key=="GpuWWgWuiWkn9fL6EQK55rdwQExkwQJsjuDmhnT3otdK"){
                                    // console.log("orca", sig)
                                    logger.info(`orca ,  ${sig}`);
                                  }
                                  for (let i = 0; i < data.transaction.transaction.meta.preTokenBalances.length; i++) {
                                    const balance = data.transaction.transaction.meta.preTokenBalances[i];
                                    if(balance.owner==key){
                                      if(balance.mint=="So11111111111111111111111111111111111111112"){
                                        poolReserves.preReserveB=new BN(balance.uiTokenAmount.amount);
                                        
                                      }else if(balance.mint==pairAddress.split("_")[0]){
                                        poolReserves.preReserveA=new BN(balance.uiTokenAmount.amount); 
                                      }
                                      
                                    }
                                  }
                                  for (let i = 0; i < data.transaction.transaction.meta.postTokenBalances.length; i++) {
                                    const balance = data.transaction.transaction.meta.postTokenBalances[i];
                                    if(balance.owner==key){
                                      if(balance.mint=="So11111111111111111111111111111111111111112"){
                                        poolReserves.reserveB=new BN(balance.uiTokenAmount.amount);
                                        poolReserves.decimalB=balance.uiTokenAmount.decimals;
                                        
                                      }else if(balance.mint==pairAddress.split("_")[0]){
                                        poolReserves.reserveA=new BN(balance.uiTokenAmount.amount); 
                                        poolReserves.decimalA=balance.uiTokenAmount.decimals;
                                      }
                                      
                                    }
                                  }
                                  if(poolReserves.reserveA.isZero() || poolReserves.reserveB.isZero()){
                                    return;
                                  }           
                                  if((pairAddresses[pairAddress][0] && pairAddresses[pairAddress][0].eq(poolReserves.reserveA)) || 
                                     (pairAddresses[pairAddress][1] && pairAddresses[pairAddress][1].eq(poolReserves.reserveB))){
                                    return;
                                  }
                                  pairAddresses[pairAddress][0]=(poolReserves.reserveA);
                                  pairAddresses[pairAddress][1]=(poolReserves.reserveB);
                                  pairAddresses[pairAddress][2]=new BN(poolReserves.decimalA);
                                  pairAddresses[pairAddress][3]=new BN(poolReserves.decimalB);    
                                  let isBuy=true;
                                  if(poolReserves.reserveB.gt(poolReserves.preReserveB)){
                                    isBuy=true;
                                  }else{
                                    isBuy = false;
                                  }
                                  // logger.info(`${sig}  orcawp`);
                                  // const tradeAmount = (poolReserves.reserveB.sub(poolReserves.preReserveB)).div(new BN(LAMPORTS_PER_SOL)).abs();
                                  // findArbtrageOpportunities(pairAddress, "orcawp", isBuy, tradeAmount, poolReserves, sig)
                                     
                                  // const swapOutput = await calculateSwapOutput("orcawp", pairAddress.split("_")[2], new BN(QUOTE_AMOUNT*LAMPORTS_PER_SOL), {
                                  //   reserves: poolReserves,
                                  //   inputTokenMint: "So11111111111111111111111111111111111111112",
                                  //   isSOLToToken: true,
                                  //   supply: supply
                                  // });
                                  // if(swapOutput==undefined) break;
                                  // pairAddress_accounts[pairAddress]=swapOutput.accounts;
                                  // findArbtrageOpportunities(pairAddress, swapOutput.accounts, swapOutput.outputAmount, currentSlot);
                                }
                              } catch (error: any) {
                                console.log(error)
                              }
                            }
                          }
                        }
                      }
                  }
              })
              await new Promise<void>((resolve, reject) => {
                  stream.write(request, (err: null | undefined) => {
                      if (err === null || err === undefined) {
                      resolve();
                      } else {
                      reject(err);
                      }
                  });
              }).catch((reason) => {
                  throw reason;
              });
              await streamClosed;
          }
      }catch(e){
        console.log(e)
      }
    }, 400)
  }catch(e){
    console.log("Error while creating stream...")
  }
}
async function startStream3(){
  try{
    let is_running=false;
    const request: SubscribeRequest = {
        "slots": {},
        accounts: {},
        "transactions": {},
        "blocks": {},
        "blocksMeta": {"blockmetadata": {}},
        "accountsDataSlice": [],
        "commitment": CommitmentLevel.PROCESSED, // Subscribe to processed blocks for the fastest updates
        entry: {},
        transactionsStatus: {}
    }
    clearInterval(inter5);
    inter5=setInterval(async()=>{
      try{
          if(is_running==false){
              is_running=true;
              stream3=await client.subscribe();
              const streamClosed = new Promise<void>((resolve, reject) => {
                  stream3.on("error", (error:any) => {
                      reject(error);
                      if(error.code==1||error.code==7){
                          clearInterval(inter5);
                      }
                      is_running=false;
                  });
                  stream3.on("end", resolve); 
                  stream3.on("close", resolve);
              });
              let signature="";
              stream3.on("data", async (data:any) => {       
                if(data.blockMeta!=undefined){         
                    blockTime=new BN(data.blockMeta.blockTime.timestamp);
                }
              })
              await new Promise<void>((resolve, reject) => {
                  stream3.write(request, (err: null | undefined) => {
                      if (err === null || err === undefined) {
                      resolve();
                      } else {
                      reject(err);
                      }
                  });
              }).catch((reason) => {
                  throw reason;
              });
              await streamClosed;
          }
      }catch(e){
        console.log(e)
      }
    }, 400)
  }catch(e){
    console.log("Error while creating stream...")
  }
}
async function start_arbitrage(){
  jitoTipAccount=await getJitoTipAccounts();
  clearInterval(inter2);
  accountKeysForStream=[];
  stream_keys=[];
  logger.info(`Total pair counts-> ${Object.keys(pairAddresses).length}`);
  // Line 1193: initial fetch runs in worker thread; main thread waits for result
  await getDexAccountsForPairs(connection, false);
  // Lines 1194-1196: interval runs getDexAccountsForPairs in worker thread (noAwait = don't block main thread)
  inter2=setInterval(()=>{
     getDexAccountsForPairs(connection, true, { noAwait: true });
  }, 5000);
  const pairAddressKeys = Object.keys(pairAddresses);
  for (let i = 0; i < pairAddressKeys.length; i++) {
    const key = pairAddressKeys[i];
    stream_keys.push(key.split("_")[2]);
    if(key.split("_")[1]=="clmm"||key.split("_")[1]=="orcawp"||key.split("_")[1]=="dlmm"||key.split("_")[1]=="dyn2"){
      accountKeysForStream.push(key.split("_")[2]);
    }
  }
  // startStream3();
  logger.info(`Total account counts-> ${accountKeysForStream.length}`);
  if(!streamStarted){
    startStream();
  }else{
    const request: SubscribeRequest = {
      "slots": {},
      accounts: {},
      "transactions": {
        pumpfun: {
            "vote": false,
            "failed": false,
            accountInclude: stream_keys,
            accountExclude: [],
            accountRequired: []
        }
      },
      "blocks": {},
      "blocksMeta": {},
      "accountsDataSlice": [],
      "commitment": CommitmentLevel.PROCESSED, // Subscribe to processed blocks for the fastest updates
      entry: {},
      transactionsStatus: {}
    };
    await new Promise<void>((resolve, reject) => {
      stream.write(request, (err: null | undefined) => {
          if (err === null || err === undefined) {
          resolve();
          } else {
          reject(err);
          }
      });
    }).catch((reason) => {
        throw reason;
    });
  }
  
  if(!streamStarted2){
    startStream2();
  }else{
    const request: SubscribeRequest = {
      slots: {},
      accounts: {
          "arb":{
              account:accountKeysForStream,
              owner:[],
              filters:[]
          }
      },
      transactions: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.PROCESSED, // Subscribe to processed blocks for the fastest updates
      entry: {},
      transactionsStatus: {}
    }
    await new Promise<void>((resolve, reject) => {
      stream2.write(request, (err: null | undefined) => {
          if (err === null || err === undefined) {
          resolve();
          } else {
          reject(err);
          }
      });
    }).catch((reason) => {
        throw reason;
    });
  }
  
}
let preTradeAmount=BigInt(0);
async function findArbtrageOpportunities(
  params:{
    dex:string,
    poolAddress:string,
    poolData:Buffer,
    poolReserves:PoolReserves,
    sig:string,
  }
){
  try{
    let newPrice=0;
    const fee=await getDexFee(connection, params);
    
    let pairAddress="";
    for(let add of Object.keys(pairAddresses)){
      if(add.includes(params.poolAddress)){
        pairAddress=add;
        break;
      }
    }
    if(params.dex=="pumpswap"||params.dex=="cpmm"||params.dex=="raydium"){
      newPrice=Number(params.poolReserves.reserveB)/Number(params.poolReserves.reserveA);
    }
    if (params.dex == "clmm") {
      const sqrtPrice=new BN(params.poolData.slice(253, 253 + 16).reverse());
      const mintA=bs58.encode(Uint8Array.from(params.poolData.slice(73,73+32)));
      newPrice=SqrtPriceMath.sqrtPriceX64ToPrice(sqrtPrice, 0, 0).toNumber();
      if(mintA==NATIVE_MINT.toString()){
        newPrice=1/newPrice;
      }
    }
    if (params.dex == "orcawp") {
      const sqrtPrice=new BN(params.poolData.slice(65, 65 + 16).reverse());
      const mintA=bs58.encode(Uint8Array.from(params.poolData.slice(101, 101 + 32)));
      newPrice=SqrtPriceMath.sqrtPriceX64ToPrice(sqrtPrice, 0, 0).toNumber();
      if(mintA==NATIVE_MINT.toString()){
        newPrice=1/newPrice;
      }
    }
    if(params.dex=="dlmm"){
      let active_id = new BN(params.poolData.slice(76, 76 + 4).reverse()).toNumber();
      if(active_id>4294901760){
        active_id-=4294967296
      }
      const bin_step =new BN(params.poolData.slice(80, 80+2)).toNumber();
      newPrice=getPriceOfBinByBinId(active_id, bin_step).toNumber();
      const mintA=bs58.encode(Uint8Array.from(params.poolData.slice(88,88+32)));
      if(mintA==NATIVE_MINT.toString()){
        newPrice=1/newPrice;
      }
    }
    if(params.dex=="dyn2"){
      const sqrtPrice=new BN(params.poolData.slice(456, 456 + 16).reverse());
      const mintA=bs58.encode(Uint8Array.from(params.poolData.slice(168, 168 + 32)));
      newPrice=getPriceFromSqrtPrice(sqrtPrice,0, 0).toNumber();
      if(mintA==NATIVE_MINT.toString()){
        newPrice=1/newPrice;
      }
    }
    
    if(newPrice==0 || fee==undefined || fee==0) return;
    prices[params.poolAddress]=newPrice;
    fees[params.poolAddress]=fee;
    // console.log(fees)
    // if(currentSlot.isZero()||blockTime.isZero()) return;
    const pairAddressesForArbtrage=Object.keys(pairAddresses).filter((poolAddress:string)=>{
      try{
        return poolAddress.split("_")[0]==pairAddress.split("_")[0];
      }catch(e){return false;}
    });
    let minPrice=10000000000;
    let maxPrice=0;
    let minPriceAddress="";
    let maxPriceAddress="";
    for(let pairAddressForArbtrage of pairAddressesForArbtrage){
      if(prices[pairAddressForArbtrage.split("_")[2]]==undefined) continue;
      if(prices[pairAddressForArbtrage.split("_")[2]]<minPrice){
        minPrice=prices[pairAddressForArbtrage.split("_")[2]];
        minPriceAddress=pairAddressForArbtrage;
      }
      if(prices[pairAddressForArbtrage.split("_")[2]]>maxPrice){
        maxPrice=prices[pairAddressForArbtrage.split("_")[2]];
        maxPriceAddress=pairAddressForArbtrage;
      }
    }
    const buyFee=fees[minPriceAddress.split("_")[2]];
    const sellFee=fees[maxPriceAddress.split("_")[2]];
    const totalFee=(buyFee+sellFee)/100;
    let tradeAmount=BigInt(QUOTE_AMOUNT*LAMPORTS_PER_SOL);
    const reserveA=pairAddresses[minPriceAddress][1];
    const reserveB=pairAddresses[maxPriceAddress][1];
    let ratio=(maxPrice - minPrice) / minPrice;
    if(totalFee>=ratio) return;
    if(!reserveA.isZero() &&!reserveB.isZero()){
      const baseAmount = min(reserveA, reserveB).div(new BN(10));
      const SCALE = 1_000_000;
      const scaledRatio = Math.floor((ratio-totalFee) * SCALE);
      const amount = baseAmount.mul(new BN(scaledRatio)).div(new BN(SCALE));
      tradeAmount=BigInt(amount.toNumber());
    }
    if(tradeAmount==preTradeAmount) return;
    preTradeAmount=tradeAmount;
    // if(tradeAmount<0.1*LAMPORTS_PER_SOL) return;
    const profit=Number(tradeAmount)*(ratio-totalFee)/100;
    if(profit<0.000007*LAMPORTS_PER_SOL) return;
    console.log(totalFee, ratio, tradeAmount, profit);
    tryArbSwap(minPriceAddress, maxPriceAddress, params.sig, tradeAmount)

  }catch(e){console.log(e)}
}
let tx_sig=""
async function tryArbSwap(sourceAddress:string, destinationAddress:string, bigTxSig:string, initialAmount:bigint){
  try{
    const token=sourceAddress.split("_")[0];
    const mints:MintInfo[]=[
      {mint:NATIVE_MINT, is2022:false},
      {mint:new PublicKey(token), is2022:isToken2022Bitmap[token]}
    ];
      let hop1:HopPoolAccounts={
        dexProgram: DexProgram.PumpAmm,
        dexProgramId: new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"),
        accounts: [],
        inTokenIs2022: false,
        outTokenIs2022: false
      };
      let hop2:HopPoolAccounts={
        dexProgram: DexProgram.PumpAmm,
        dexProgramId: new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"),
        accounts: [],
        inTokenIs2022: false,
        outTokenIs2022: false
      };
      const hop_1_dex=sourceAddress.split("_")[1];
      const hop_2_dex=destinationAddress.split("_")[1];
      const hop_1_pairaddress=sourceAddress.split("_")[2];
      const hop_2_pairaddress=destinationAddress.split("_")[2];
      let accounts1=pairAddress_accounts[sourceAddress];
      let accounts2=pairAddress_accounts[destinationAddress];
      let hop_1_accounts:PublicKey[]=[];
      let hop_2_accounts:PublicKey[]=[];
      let hop_1_isBaseSwap=true;
      let hop_2_isBaseSwap=true;
      if(!accounts1.length || !accounts2.length) return;
      accounts1=[...accounts1];
      accounts2=[...accounts2];
      const hop_1_XMint=accounts1.shift();
      const hop_2_XMint=accounts2.shift();
      if(hop_1_XMint==undefined||hop_2_XMint==undefined) return;
      if(hop_1_XMint.equals(mints[0].mint)){
        hop_1_isBaseSwap=true;
      }else{
        hop_1_isBaseSwap=false;
      }
      if(hop_2_XMint.equals(mints[0].mint)){
        hop_2_isBaseSwap=false;
      }else{
        hop_2_isBaseSwap=true;
      }
      const [userBaseAta] = PublicKey.findProgramAddressSync(
        [
          wallet.publicKey.toBuffer(),      // owner/wallet
          TOKEN_PROGRAM_ID.toBuffer(),  // token program
          new PublicKey(token).toBuffer(),        // mint
        ],
        ASSOCIATED_TOKEN_PROGRAM_ID  // ATA program derives the PDA
      );
      const [userQuoteAta] = PublicKey.findProgramAddressSync(
        [
          wallet.publicKey.toBuffer(),      // owner/wallet
          TOKEN_PROGRAM_ID.toBuffer(),  // token program
          new PublicKey("So11111111111111111111111111111111111111112").toBuffer(),        // mint
        ],
        ASSOCIATED_TOKEN_PROGRAM_ID  // ATA program derives the PDA
      );
      if(hop_1_dex=="pumpswap"){
        hop_1_accounts=accounts1;
        hop1={
          dexProgram:DexProgram.PumpAmm,
          dexProgramId:program_ids.pumpswap,
          inTokenIs2022:mints[0].is2022,
          outTokenIs2022:mints[1].is2022,
          isBaseSwap:hop_1_isBaseSwap,
          accounts:hop_1_accounts
        };
      }
      if(hop_1_dex=="clmm"){
        accounts1.splice(-3);
        hop_1_accounts=accounts1
        hop1={
          dexProgram:DexProgram.RaydiumClmm,
          dexProgramId:program_ids.clmm,
          inTokenIs2022:mints[0].is2022,
          outTokenIs2022:true,
          isBaseSwap:hop_1_isBaseSwap,
          accounts:hop_1_accounts
        };
      }
      if(hop_1_dex=="cpmm"){
        hop_1_accounts=accounts1;
        hop1={
          dexProgram:DexProgram.RaydiumCpmm,
          dexProgramId:program_ids.cpmm,
          inTokenIs2022:mints[0].is2022,
          outTokenIs2022:mints[1].is2022,
          isBaseSwap:hop_1_isBaseSwap,
          accounts:hop_1_accounts
        };
      }
      if(hop_1_dex=="orcawp"){
        if(accounts1[3]==undefined||accounts1[4]==undefined||accounts1[5]==undefined){
          return;
        }
        hop_1_accounts.push(accounts1[0]);
        hop_1_accounts.push(accounts1[1]);
        hop_1_accounts.push(accounts1[2]);
        hop_1_accounts.push(accounts1[3]);
        hop_1_accounts.push(accounts1[4]);
        hop_1_accounts.push(accounts1[5]);
        hop_1_accounts.push(accounts1[9]);
        if(mints[1].is2022){
          hop_1_accounts.push(accounts1[10]);
        }
        hop1={
          dexProgram:DexProgram.OrcaWhirlpool,
          dexProgramId:program_ids.orcawp,
          inTokenIs2022:mints[0].is2022,
          outTokenIs2022:mints[1].is2022,
          isBaseSwap:hop_1_isBaseSwap,
          accounts:hop_1_accounts
        };
      }
      if(hop_1_dex=="dlmm"){
        if(accounts1[7]==undefined||accounts1[8]==undefined||accounts1[9]==undefined){
          return;
        }
        accounts1.splice(-3);
        hop_1_accounts=accounts1;
        if(!mints[1].is2022){
          hop_1_accounts.splice(6,1);
        }
        hop1={
          dexProgram:DexProgram.MeteoraDlmm,
          dexProgramId:program_ids.dlmm,
          inTokenIs2022:mints[0].is2022,
          outTokenIs2022:mints[1].is2022,
          isBaseSwap:hop_1_isBaseSwap,
          accounts:hop_1_accounts
        };
      }
      if(hop_1_dex=="dyn2"){
        hop_1_accounts=accounts1;
        hop1={
          dexProgram:DexProgram.MeteoraDammV2,
          dexProgramId:program_ids.dyn2,
          inTokenIs2022:mints[0].is2022,
          outTokenIs2022:mints[1].is2022,
          isBaseSwap:hop_1_isBaseSwap,
          accounts:hop_1_accounts
        };
      }
      if(hop_1_dex=="raydium"){
        hop_1_accounts=accounts1;
        hop1={
          dexProgram:DexProgram.RaydiumAmmV4,
          dexProgramId:program_ids.raydium,
          inTokenIs2022:mints[0].is2022,
          outTokenIs2022:mints[1].is2022,
          isBaseSwap:hop_1_isBaseSwap,
          accounts:hop_1_accounts
        };
      }

      if(hop_2_dex=="pumpswap"){
        hop_2_accounts=accounts2;
        hop2={
          dexProgram:DexProgram.PumpAmm,
          dexProgramId:program_ids.pumpswap,
          inTokenIs2022:mints[1].is2022,
          outTokenIs2022:mints[0].is2022,
          isBaseSwap:hop_2_isBaseSwap,
          accounts:hop_2_accounts
        };
      }
      if(hop_2_dex=="clmm"){
        hop_2_accounts.push(accounts2[0]);
        hop_2_accounts.push(accounts2[1]);
        hop_2_accounts.push(accounts2[2]);
        hop_2_accounts.push(accounts2[3]);
        hop_2_accounts.push(accounts2[4]);
        hop_2_accounts.push(accounts2[5]);
        hop_2_accounts.push(accounts2[9]);
        hop_2_accounts.push(accounts2[10]);
        hop_2_accounts.push(accounts2[11]);
        hop2={
          dexProgram:DexProgram.RaydiumClmm,
          dexProgramId:program_ids.clmm,
          inTokenIs2022:true,
          outTokenIs2022:mints[0].is2022,
          isBaseSwap:hop_2_isBaseSwap,
          accounts:hop_2_accounts
        };
      }
      if(hop_2_dex=="cpmm"){
        hop_2_accounts=accounts2;
        hop2={
          dexProgram:DexProgram.RaydiumCpmm,
          dexProgramId:program_ids.cpmm,
          inTokenIs2022:mints[1].is2022,
          outTokenIs2022:mints[0].is2022,
          isBaseSwap:hop_2_isBaseSwap,
          accounts:hop_2_accounts
        };
      }
      if(hop_2_dex=="orcawp"){
        if(accounts2[6]==undefined||accounts2[7]==undefined||accounts2[8]==undefined){
          return;
        }
        hop_2_accounts.push(accounts2[0]);
        hop_2_accounts.push(accounts2[1]);
        hop_2_accounts.push(accounts2[2]);
        hop_2_accounts.push(accounts2[6]);
        hop_2_accounts.push(accounts2[7]);
        hop_2_accounts.push(accounts2[8]);
        hop_2_accounts.push(accounts2[9]);
        if(mints[1].is2022){
          hop_2_accounts.push(accounts2[10]);
        }
        hop2={
          dexProgram:DexProgram.OrcaWhirlpool,
          dexProgramId:program_ids.orcawp,
          inTokenIs2022:mints[1].is2022,
          outTokenIs2022:mints[0].is2022,
          isBaseSwap:hop_2_isBaseSwap,
          accounts:hop_2_accounts
        };
      }
      if(hop_2_dex=="dlmm"){
        if(accounts2[12]==undefined||accounts2[10]==undefined||accounts2[11]==undefined){
          return;
        }
        hop_2_accounts.push(accounts2[0]);
        hop_2_accounts.push(accounts2[1]);
        hop_2_accounts.push(accounts2[2]);
        hop_2_accounts.push(accounts2[3]);
        hop_2_accounts.push(accounts2[4]);
        hop_2_accounts.push(accounts2[5]);
        if(mints[1].is2022){
          hop_2_accounts.push(accounts2[6]);
        }
        hop_2_accounts.push(accounts2[7]);
        hop_2_accounts.push(accounts2[11]);
        hop_2_accounts.push(accounts2[12]);
        hop_2_accounts.push(accounts2[13]);
        hop2={
          dexProgram:DexProgram.MeteoraDlmm,
          dexProgramId:program_ids.dlmm,
          inTokenIs2022:mints[1].is2022,
          outTokenIs2022:mints[0].is2022,
          isBaseSwap:hop_2_isBaseSwap,
          accounts:hop_2_accounts
        };
      }
      if(hop_2_dex=="dyn2"){
        hop_2_accounts=accounts2;
        hop2={
          dexProgram:DexProgram.MeteoraDammV2,
          dexProgramId:program_ids.dyn2,
          inTokenIs2022:mints[1].is2022,
          outTokenIs2022:mints[0].is2022,
          isBaseSwap:hop_2_isBaseSwap,
          accounts:hop_2_accounts
        };
      }
      if(hop_2_dex=="raydium"){
        hop_2_accounts=accounts2;
        hop2={
          dexProgram:DexProgram.RaydiumAmmV4,
          dexProgramId:program_ids.raydium,
          inTokenIs2022:mints[1].is2022,
          outTokenIs2022:mints[0].is2022,
          isBaseSwap:hop_2_isBaseSwap,
          accounts:hop_2_accounts
        };
      }
      const { accounts, hops } = buildArbitrageAccounts(wallet.publicKey, mints, [hop1, hop2]);
      
      // const initialAmount = BigInt(QUOTE_AMOUNT * LAMPORTS_PER_SOL);
      const instructionData = buildArbitrageInstructionData({
        hops,
        initialAmount,
        minimumFinalOutput: BigInt(1),
      });
      const arbInstruction = {
        programId: PROGRAM_ID,
        keys: accounts,
        // `buildArbitrageInstructionData` already returns a Buffer.
        data: instructionData,
      };
      
      let messageV0;
      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 700_000 });
      const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 });
      // logger.info(bigTxSig);
      if(ISJITO=="false"){
        messageV0 = new TransactionMessage({
          payerKey: wallet.publicKey,
          recentBlockhash: recentBlockhash,
          instructions: [computeBudgetIx,computePriceIx, arbInstruction],
        }).compileToV0Message([lookupTableAccount]);
        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([wallet]);
        const sig=await swqos_connection.sendTransaction(transaction, {skipPreflight:true});
        console.log("Arb executed", sig, "\n", bigTxSig,"\n");
      }else if(ISJITO=="true"){
        const tipIx = SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: new PublicKey(jitoTipAccount),
          lamports: 10000, // 0.0001 SOL tip recommended for speed
        });
        messageV0 = new TransactionMessage({
          payerKey: wallet.publicKey,
          recentBlockhash: recentBlockhash,
          instructions: [computeBudgetIx,computePriceIx, tipIx, arbInstruction],
        }).compileToV0Message([lookupTableAccount]);
        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([wallet]);
        const sig=await sendJitoTransaction(transaction);
        console.log("Arb executed", sig, "\n", bigTxSig,"\n");
      }
      // console.log(mints[0].is2022, mints[1].is2022,hop_1_XMint?.toBase58(), hop_2_XMint?.toString(),  hop_1_isBaseSwap,hop_2_isBaseSwap, "\n");
  }catch(e){
    // console.log("Error occured during executing arb instruction\n", e);
  }
}

async function setupATAs(tokens:string[]){
  for(let token of tokens){
      const isToken2022=await createATA(new PublicKey(token), wallet, connection);
      isToken2022Bitmap[token]=isToken2022;
  }
}

type GetDexAccountsOptions = { noAwait?: boolean };

async function getDexAccountsForPairs(connection:Connection, retry:Boolean, options?: GetDexAccountsOptions){
  const noAwait = options?.noAwait === true;
  const accounts=Object.keys(pairAddresses);
  const tasks = accounts
    .map((account) => ({
      accountKey: account,
      dex: account.split("_")[1],
      poolAddress: account.split("_")[2],
    }))
    .filter(
      (t) =>
        retry === false ||
        !["pumpswap", "cpmm", "dyn2", "raydium"].includes(t.dex)
    );

  const worker = getDexAccountsWorker();
  if (worker) {
    if (noAwait) {
      worker.postMessage({
        rpcEndpoint: RPC_ENDPOINT,
        walletSecretKeyBase58: PRIVATE_KEY,
        tasks,
      });
      return;
    }
    try {
      const result = await new Promise<WorkerResult>((resolve, reject) => {
        dexAccountsPendingResolve = resolve;
        worker.postMessage({
          rpcEndpoint: RPC_ENDPOINT,
          walletSecretKeyBase58: PRIVATE_KEY,
          tasks,
        });
        dexAccountsTimeoutId = setTimeout(() => {
          dexAccountsTimeoutId = null;
          if (dexAccountsPendingResolve) {
            dexAccountsPendingResolve({ results: [] });
            dexAccountsPendingResolve = null;
          }
        }, 120000);
      });
      applyWorkerResults(result);
    } catch (e) {
      logger.error("getDexAccountsForPairs worker failed:");
      await getDexAccountsForPairsMainThread(connection, retry, accounts);
    }
    return;
  }

  await getDexAccountsForPairsMainThread(connection, retry, accounts);
}

async function getDexAccountsForPairsMainThread(connection: Connection, retry: Boolean, accounts: string[]) {
  const toFetch =
    retry === true
      ? accounts.filter(
          (a) =>
            !["pumpswap", "cpmm", "dyn2", "raydium"].includes(a.split("_")[1])
        )
      : accounts;
  const promises = toFetch.map(async (account) => {
    try {
      const dex = account.split("_")[1];
      const poolAddress = account.split("_")[2];
      const dexaccounts = await getDexAccounts(dex, poolAddress, connection, wallet);
      return { account, accounts1: dexaccounts?.accounts };
    } catch (error) {
      logger.error(`Error fetching dex accounts for ${account}: ${error}`);
      return { account, accounts1: undefined };
    }
  });
  const results = await Promise.all(promises);
  for (const result of results) {
    if (result.accounts1 !== undefined)
      pairAddress_accounts[result.account] = result.accounts1;
  }
}

async function sendJitoTransaction(tx:VersionedTransaction){
  const base64Tx = Buffer.from(tx.serialize()).toString('base64');
  const response = await fetch(`${BLOCK_ENGINE_URL}/api/v1/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [base64Tx, { encoding: "base64" }]
    })
  });
  const result = await response.json();
  return result.result
}

async function getJitoTipAccounts(){
  const response = await fetch(`${BLOCK_ENGINE_URL}/api/v1/getTipAccounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTipAccounts",
      params:[]
    })
  });
  const result = await response.json();
  return result.result[0];
}