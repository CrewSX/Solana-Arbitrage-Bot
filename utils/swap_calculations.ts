/**
 * Swap Output Amount Calculation Functions for Multiple DEXes
 * Supports: PumpSwap, Raydium (Standard/CPMM/CLMM), Orca Whirlpool, Meteora (DLMM/DYN2)
 * 
 * All functions accept reserves as parameters and fetch fees programmatically from pool data
 */

import { Connection, PublicKey, Keypair, EpochInfo, PUBLIC_KEY_LENGTH } from '@solana/web3.js';
import BN from 'bn.js';
import { RPC_ENDPOINT } from '../constants/constants';

// PumpSwap SDK
import { PumpAmmSdk, buyQuoteInputInternal, sellBaseInputInternal } from '@pump-fun/pump-swap-sdk';

// Raydium SDK
import { ComputeClmmPoolInfo, CurveCalculator, PoolUtils, Raydium, ReturnTypeFetchMultiplePoolTickArrays, TickUtils,TickQuery, getPdaTickArrayAddress } from '@raydium-io/raydium-sdk-v2';
// Orca SDK
import { WhirlpoolContext, buildWhirlpoolClient, swapQuoteByInputToken , Whirlpool, SwapUtils, PDAUtil} from '@orca-so/whirlpools-sdk';
import { Percentage } from '@orca-so/common-sdk';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
let clock=0;
setInterval(()=>{
  clock++;
},1000);
const ORCA_DUMMY_WALLET = new Wallet(Keypair.generate());

export function calculateEpochInfoFromSlot(slot: number, slotsPerEpoch: number = 432000): EpochInfo {
  const epoch = Math.floor(slot / slotsPerEpoch);
  const slotIndex = slot % slotsPerEpoch;
  
  return {
    epoch,
    slotIndex,
    slotsInEpoch: slotsPerEpoch,
    absoluteSlot: slot,
  };
}
// Meteora SDKs
import { CpAmm, PoolState, SwapMode, getCurrentPoint ,getPriceFromSqrtPrice} from '@meteora-ag/cp-amm-sdk';
import DLMM from '@meteora-ag/dlmm';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Liquidity ,getPdaPoolVaultId} from '@raydium-io/raydium-sdk';

export interface SwapOutputResult {
  outputAmount: BN;
  minimumOutput?: BN;
}

export interface PoolReserves {
  reserveA: BN;  // Reserve of token A
  decimalA: number;
  reserveB: BN;  // Reserve of token B
  decimalB: number;
  preReserveA: BN;
  preReserveB:BN;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      // Don't retry on non-timeout errors
      if (error.message && !error.message.includes('504') && !error.message.includes('Gateway Timeout') && !error.message.includes('timeout')) {
        throw error;
      }
      // Exponential backoff: 1s, 2s, 4s
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, initialDelay * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}
export async function calculatePumpSwapOutput(
  poolAddress: string,
  inputAmount: BN,
  reserves: PoolReserves,
  supply: number,
  isSOLToToken: boolean = true
): Promise<SwapOutputResult | undefined> {
  try {
    const spot_price=Number(reserves.reserveB.toString())/(Number(reserves.reserveA.toString()))/(10**(reserves.decimalB-reserves.decimalA))
      const mc=spot_price*supply;
      let feeRate=0;
      if(mc>=0&&mc<420){
        feeRate=1.25;
      }else if(mc>=420&&mc<1470){
        feeRate=1.2;
      }else if(mc>=1470&&mc<2460){
        feeRate=1.15;
      }else if(mc>=2460&&mc<3440){
        feeRate=1.1;
      }else if(mc>=3440&&mc<4420){
        feeRate=1.05;
      }else if(mc>=4420&&mc<9820){
        feeRate=1;
      }else if(mc>=9820&&mc<14740){
        feeRate=0.95;
      }else if(mc>=14740&&mc<19650){
        feeRate=0.9;
      }else if(mc>=19650&&mc<24560){
        feeRate=0.85;
      }else if(mc>=24560&&mc<29470){
        feeRate=0.8;
      }else if(mc>=29470&&mc<34380){
        feeRate=0.75;
      }else if(mc>=34380&&mc<39300){
        feeRate=0.7;
      }else if(mc>=39300&&mc<44210){
        feeRate=0.65;
      }else if(mc>=44210&&mc<49120){
        feeRate=0.6;
      }else if(mc>=49120&&mc<54030){
        feeRate=0.55;
      }else if(mc>=54030&&mc<58940){
        feeRate=0.525;
      }else if(mc>=58940&&mc<63860){
        feeRate=0.5;
      }else if(mc>=63860&&mc<68770){
        feeRate=0.475;
      }else if(mc>=68770&&mc<73681){
        feeRate=0.45;
      }else if(mc>=73681&&mc<78590){
        feeRate=0.425;
      }else if(mc>=78590&&mc<83500){
        feeRate=0.4;
      }else if(mc>=83500&&mc<88400){
        feeRate=0.375;
      }else if(mc>=88400&&mc<93330){
        feeRate=0.35;
      }else if(mc>=93330&&mc<98240){
        feeRate=0.325;
      }else if(mc>=98240){
        feeRate=0.3;
      }
    if (isSOLToToken) {
      const effectiveInputAmount=inputAmount.mul(new BN(100-feeRate)).div(new BN(100));
      const outputAmount=effectiveInputAmount.mul(reserves.reserveA).div(reserves.reserveB.add(effectiveInputAmount));
      return {
        outputAmount: outputAmount,
      };
    } else {
      const outputAmount=inputAmount.mul(reserves.reserveB).div(reserves.reserveA.add(inputAmount));
      const effectiveOutputAmount=outputAmount.mul(new BN(100-feeRate)).div(new BN(100));
      return {
        outputAmount: effectiveOutputAmount,
      };
    }
  } catch (error: any) {
    console.log(error)
    return undefined
  }
}

let cpmm_fees: Record<string, BN> = {};
export async function calculateRaydiumStandardAMMOutput(
  poolAddress: string,
  inputAmount: BN,
  reserves: PoolReserves,
  inputTokenMint: string,
  isSOLToToken: boolean = true
): Promise<SwapOutputResult|undefined> {
  try {
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const poolPubkey = new PublicKey(poolAddress);
    if(!cpmm_fees[poolAddress]){
      const accountInfo=await connection.getAccountInfo(poolPubkey)
      if(!accountInfo){
        throw new Error('Pool account not found');
      }
      const config_address = bs58.encode(accountInfo.data.slice(8, 8 + 32));
      const config_accountInfo=await connection.getAccountInfo(new PublicKey(config_address))
      if(!config_accountInfo){
        throw new Error('Config account not found');
      }
      const feeRate = config_accountInfo.data.slice(12, 12+8).reverse().toString('hex');
    //   console.log(feeRate)
      cpmm_fees[poolAddress] = new BN(parseInt(feeRate, 16));
    //   console.log(cpmm_fees[poolAddress].toString())
    }
    if(isSOLToToken==true){
        const sourceReserve = reserves.reserveB;
        const destReserve = reserves.reserveA;
        // Use CurveCalculator.swap from SDK
        const result = CurveCalculator.swap(
          inputAmount,
          sourceReserve,
          destReserve,
          cpmm_fees[poolAddress]
        );
        return {
            outputAmount: result.destinationAmountSwapped,
        };
    }else{
        const sourceReserve = reserves.reserveA;
        const destReserve = reserves.reserveB;
        
        // Use CurveCalculator.swap from SDK
        const result = CurveCalculator.swap(
          inputAmount,
          sourceReserve,
          destReserve,
          cpmm_fees[poolAddress]
        );
        return {
            outputAmount: result.destinationAmountSwapped,
        };
    }
    
    
  } catch (error: any) {
    return undefined
  }
}

let raydium: Raydium;
let clmm_tickData: Record<string, ReturnTypeFetchMultiplePoolTickArrays> = {};
let clmm_poolInfo: Record<string, ComputeClmmPoolInfo> = {};
export async function calculateRaydiumCLMMOutput(
  poolAddress: string,
  inputAmount: BN,
  inputTokenMint: string,
  slippage: number = 0.01, // 1% default
  epochInfo: EpochInfo // Optional: pass epochInfo from gRPC to avoid RPC call
  
): Promise<SwapOutputResult|undefined> {
  try {
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    if(raydium==undefined||raydium==null){
      raydium = await Raydium.load({ 
        connection,
        disableLoadToken: true, // Disable token list fetching
        disableFeatureCheck: true, // Disable feature checks
        apiRequestInterval: -1 // Never request API data again
      });
    }
    if(clmm_poolInfo[poolAddress]==undefined||clmm_poolInfo[poolAddress]==null){
      const { poolInfo, computePoolInfo, tickData } = await raydium.clmm.getPoolInfoFromRpc(poolAddress)
      clmm_poolInfo[poolAddress] = computePoolInfo;
      clmm_tickData[poolAddress] = tickData;
    }
    const computePoolInfo = clmm_poolInfo[poolAddress];
    const tickData = clmm_tickData[poolAddress];
    const result = PoolUtils.computeAmountOut({
      poolInfo: computePoolInfo,
      tickArrayCache: tickData[poolAddress] || {},
      baseMint: new PublicKey(inputTokenMint),
      epochInfo: epochInfo,
      amountIn: inputAmount,
      slippage,
      catchLiquidityInsufficient: false,
    });
    
    // Extract amount from GetTransferAmountFee (which has .amount property)
    const outputAmount = (result.amountOut as any).amount || result.amountOut;
    const minAmountOut = (result.minAmountOut as any).amount || result.minAmountOut;
    
    return {
      outputAmount: outputAmount instanceof BN ? outputAmount : new BN(outputAmount.toString()),
      minimumOutput: minAmountOut instanceof BN ? minAmountOut : new BN(minAmountOut.toString()),
    };
  } catch (error: any) {
    return undefined
  }
}

const orca_poolstate: Record<string, Whirlpool> = {};
export async function calculateOrcaWhirlpoolOutput(
  poolAddress: string,
  inputAmount: BN,
  inputTokenMint: string,
  slippageBps: number = 100 // 1% default
): Promise<SwapOutputResult|undefined> {
  try {
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const ctx = WhirlpoolContext.from(connection, ORCA_DUMMY_WALLET);
    const client = buildWhirlpoolClient(ctx);
    if(orca_poolstate[poolAddress]==undefined||orca_poolstate[poolAddress]==null){
      orca_poolstate[poolAddress] = await client.getPool(new PublicKey(poolAddress))
    }else{
      if(clock%1==0){
        orca_poolstate[poolAddress] = await client.getPool(new PublicKey(poolAddress))
      }
    }
    const pool = orca_poolstate[poolAddress];
    const quote = await swapQuoteByInputToken(
      pool,
      new PublicKey(inputTokenMint),
      inputAmount,
      Percentage.fromFraction(slippageBps, 10000), // Convert bps to percentage
      ctx.program.programId,
      ctx.fetcher
    );
    return {
      outputAmount: quote.estimatedAmountOut,
      minimumOutput: quote.amount,
    };
  } catch (error: any) {
    return undefined
  }
}

const dlmmCache: Record<string, DLMM> = {};
const dlmm_accounts:Record<string, PublicKey[]>={};
export async function calculateMeteoraDLMMOutput(
  poolAddress: string,
  inputAmount: BN,
  inputTokenMint: string,
  reserves: PoolReserves,
  slippageBps: number = 100 // 1% default
): Promise<SwapOutputResult|undefined> {
  try {
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const dlmm=await DLMM.create(connection, new PublicKey(poolAddress))
    dlmmCache[poolAddress] = dlmm;


    const swapForY = dlmm.lbPair.tokenXMint.toString() === inputTokenMint;
    const binArrays=await dlmm.getBinArrayForSwap(swapForY,3)
    const result = dlmm.swapQuote(
      inputAmount,
      swapForY,
      new BN(slippageBps), // Allowed slippage in BPS
      binArrays,
      false, // isPartialFill
      undefined // maxExtraBinArrays
    );
    return {
      outputAmount: result.outAmount,
      minimumOutput: result.minOutAmount,
      
    };
  } catch (error: any) {
    return undefined
  }
}

const  dyn2_poolstate: Record<string, PoolState> = {};
let dyn2_accounts:Record<string, PublicKey[]>={}; 
export async function calculateMeteoraDYN2Output(
  poolAddress: string,
  inputAmount: BN,
  inputTokenMint: string,
  reserves: PoolReserves,
  slippage: number = 0.01, // 1% default
  currentPoint?: BN, // Optional: pass currentPoint from gRPC to avoid RPC call
  currentSlot?: number // Optional: pass current slot from gRPC for Slot activation type
): Promise<SwapOutputResult|undefined> {
  try {
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    
    const cpAmm = new CpAmm(connection);
    if(dyn2_poolstate[poolAddress]==undefined||dyn2_poolstate[poolAddress]==null){
      dyn2_poolstate[poolAddress] = await cpAmm.fetchPoolState(new PublicKey(poolAddress))
    }else{
      if(clock%1==0){
        dyn2_poolstate[poolAddress] = await cpAmm.fetchPoolState(new PublicKey(poolAddress))
      }
    }
    const poolState = dyn2_poolstate[poolAddress];
    let finalCurrentPoint: BN;
    if (currentPoint) {
      finalCurrentPoint = currentPoint;
    } else if (currentSlot !== undefined && poolState.activationType === 0) {
      finalCurrentPoint = new BN(currentSlot);
    } else {
      finalCurrentPoint = await getCurrentPoint(connection, poolState.activationType)
    }
    const result = cpAmm.getQuote2({
      inputTokenMint: new PublicKey(inputTokenMint),
      slippage,
      currentPoint: finalCurrentPoint,
      poolState,
      tokenADecimal: reserves.decimalA,
      tokenBDecimal: reserves.decimalB,
      hasReferral: false,
      swapMode: SwapMode.ExactIn,
      amountIn: inputAmount,
    });
    
    return {
      outputAmount: result.outputAmount,
      minimumOutput: result.minimumAmountOut,
    };
  } catch (error: any) {
    console.log(error)
    return undefined
  }
}

export async function calculateRaydiumAmmV4Output(
  poolAddress:string,
  inputAmount:BN, 
  tokenMint:string,
  isSolToToken:boolean,
  slippage:number=0
):Promise<SwapOutputResult|undefined>{
  try{
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    if(raydium==undefined||raydium==null){
      raydium = await Raydium.load({ 
        connection,
        disableLoadToken: true, // Disable token list fetching
        disableFeatureCheck: true, // Disable feature checks
        apiRequestInterval: -1 // Never request API data again
      });
    }
    const poolInfo=await raydium.liquidity.getPoolInfoFromRpc({poolId:poolAddress});
    let inMint="";
    let outMint="";
    if(isSolToToken){
      inMint=NATIVE_MINT.toString();
      outMint=tokenMint;
    }else{
      outMint=NATIVE_MINT.toString();
      inMint=tokenMint;
    }
    const result=await raydium.liquidity.computeAmountOut({
      poolInfo:poolInfo.poolInfo,
      amountIn:inputAmount,
      mintIn:inMint,
      mintOut:outMint,
      slippage
    })
    return {
      outputAmount: result.amountOut,
      minimumOutput: result.minAmountOut,
    };
  }catch(e){
    console.log(e)
    return undefined
  }

}
export async function calculateSwapOutput(
  dexType: string,
  poolAddress: string,
  inputAmount: BN,
  params: {
    reserves?: PoolReserves;
    supply?: number;
    inputTokenMint?: string;
    isSOLToToken?: boolean;
    epochInfo?: any;
    slippageBps?: number;
    currentPoint?: BN; // For Meteora DYN2: currentPoint from gRPC
    currentSlot?: number; // For Meteora DYN2: current slot from gRPC
  }
): Promise<SwapOutputResult|undefined> {
  switch (dexType) {
    case 'pumpswap':
      if (!params.reserves || params.isSOLToToken === undefined || params.supply === undefined) {
        throw new Error('Missing reserves or isSOLToToken parameter');
      }
      return calculatePumpSwapOutput(poolAddress, inputAmount, params.reserves,params.supply, params.isSOLToToken);
    
    case 'cpmm':
      if (!params.reserves || !params.inputTokenMint) {
        throw new Error('Missing reserves or inputTokenMint parameter');
      }
      return calculateRaydiumStandardAMMOutput(poolAddress, inputAmount, params.reserves, params.inputTokenMint, params.isSOLToToken);
    
    case 'clmm':
      if (!params.inputTokenMint) {
        throw new Error('Missing inputTokenMint parameter for CLMM');
      }
      return calculateRaydiumCLMMOutput(
        poolAddress, 
        inputAmount, 
        params.inputTokenMint,
        params.slippageBps ? params.slippageBps / 10000 : undefined,
        params.epochInfo // Pass epochInfo from gRPC if provided
      );
    
    case 'orcawp':
      if (!params.inputTokenMint) {
        throw new Error('Missing inputTokenMint parameter');
      }
      return calculateOrcaWhirlpoolOutput(poolAddress, inputAmount, params.inputTokenMint, params.slippageBps);
    
    case 'dlmm':
      if (!params.inputTokenMint || !params.reserves) {
        throw new Error('Missing DLMM parameters (inputTokenMint, reserves)');
      }
      return calculateMeteoraDLMMOutput(poolAddress, inputAmount, params.inputTokenMint, params.reserves, params.slippageBps);
    
    case 'dyn2':
      if (!params.inputTokenMint || !params.reserves) {
        throw new Error('Missing DYN2 parameters (inputTokenMint, reserves)');
      }
      return calculateMeteoraDYN2Output(
        poolAddress, 
        inputAmount, 
        params.inputTokenMint, 
        params.reserves, 
        params.slippageBps ? params.slippageBps / 100 : 0.01,
        params.currentPoint, // Pass currentPoint from gRPC if provided
        params.currentSlot // Pass current slot from gRPC if provided
      );
      case 'raydium':
        if (!params.inputTokenMint || !params.inputTokenMint || !params.isSOLToToken) {
          throw new Error('Missing Raydium amm v4 parameters (inputTokenMint, reserves)');
        }
        return calculateRaydiumAmmV4Output(
          poolAddress,
          inputAmount,
          params.inputTokenMint,
          params.isSOLToToken,
          0
        );
    default:
      throw new Error(`Unknown DEX type: ${dexType}`);
  }
}
