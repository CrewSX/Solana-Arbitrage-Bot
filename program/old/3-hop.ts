#!/usr/bin/env ts-node
/**
 * Mainnet-Fork 3-Hop Test with Address Lookup Table
 * Tests: SOL → USDC → TRUMP → SOL using ALT to reduce transaction size
 */

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddressSync, 
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID as SPL_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { buildArbitrageInstructionData, DexProgram, ArbitrageRoute } from './program/instruction';
import { PRIVATE_KEY , RPC_ENDPOINT} from './constants';
const PROGRAM_ID = new PublicKey('CJrTqPA9Y37bxE6VXRtjTkK8irRrEWuKh5gHSsqXJrVt');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ORCA_WHIRLPOOL_PROGRAM_ID = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const METEORA_DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

const payer = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY))
// Meteora DLMM pool
const METEORA_LB_PAIR = new PublicKey('9d9mb8kooFfaD3SctgZtkxQypkshx6ezhbKio89ixyy2');

// Derive binArrayBitmapExtension PDA
const [METEORA_BIN_ARRAY_BITMAP_EXTENSION] = PublicKey.findProgramAddressSync(
  [Buffer.from('bitmap'), METEORA_LB_PAIR.toBuffer()],
  METEORA_DLMM_PROGRAM_ID
);

// Real mainnet account addresses (cloned)
const ACCOUNTS = {
  orca: {
    tokenAuthority: new PublicKey('GRV6aYozLxNaH1Yj6T2h2qfEog9ctssas6brwCcbuSK5'),
    whirlpool: new PublicKey('Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'),
    tokenVaultA: new PublicKey('EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9'),
    tokenVaultB: new PublicKey('2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP'),
    tickArray0: new PublicKey('HKFHvjsaXWqm5eJpP6minENF6EDK4r86d7G3oYfqD4Q8'),
    tickArray1: new PublicKey('8Yoy9SqpLRV1UkLiTkMkNqnuE1bcSAFiYC8jMjS7Niqp'),
    tickArray2: new PublicKey('8bnKeevCLsmbudhjkwg6GFMcsZpf78cs8pzRxzMqwZLa'),
    oracle: new PublicKey('FoKYKtRpD25TKzBMndysKpgPqbj8AdLXjfpYHXn9PGTX'),
  },
  meteora: {
    lbPair: METEORA_LB_PAIR,
    binArrayBitmapExtension: METEORA_BIN_ARRAY_BITMAP_EXTENSION,
    reserveX: new PublicKey('AK93dERw7MJsGFBUPfV1bkXzDviJZM1K6vg2yGDugk7L'),
    reserveY: new PublicKey('81BadRGfaHFpAmuXpJ65k8tYtUWsZ54EFSmsVo1rbDTV'),
    tokenXMint: new PublicKey('6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN'),
    tokenYMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    oracle: new PublicKey('6zpxLXnQxqJFpfyjUasgYKSK2w5KxSHjEDfbYWfXLoFF'),
    hostFeeIn: PublicKey.default,
    eventAuthority: new PublicKey('D1ZN9Wj1fRSUQfCjhvnu1hqDMT7hzjzBBpi12nVniYD6'),
    program: new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'),
    binArray1: new PublicKey('AhFkieZeKce2tcFYkHPnUVkanKLUQaLEPXhHaruPuNVe'),
    binArray2: new PublicKey('BdJ76QwcqTxwyaXPX3EzueM4kcQGUqyENtv3MXJf6r2o'),
    binArray3: new PublicKey('GbV9jDeB8BSNAbi4VYw8ZvVvACBNjTR1GhsqjSsA1oNA'),
  },
  raydium: {
    ammConfig: new PublicKey('E64NGkDLLCdQ2yFNPcavaKptrEgmiQaNykUuLC1Qgwyp'),
    poolState: new PublicKey('GQsPr4RJk9AZkkfWHud7v4MtotcxhaYzZHdsPCg9vNvW'),
    inputVault: new PublicKey('3DZg4BbkBj8GKEXXXRtu6wUunpCAth6n8gZur9Dronvt'),
    outputVault: new PublicKey('7bDUUvfSXFQAomGc4W9pUQt1UVrF485TVUP9iSM4d4u1'),
    observationState: new PublicKey('B39UjYJDygUfufZfwGa2BVbSnLLw9qredg3wDWarMAUx'),
    tokenProgram2022: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
    memoProgram: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
    inputVaultMint: new PublicKey('6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN'),
    outputVaultMint: new PublicKey('So11111111111111111111111111111111111111112'),
    tickArray1: new PublicKey('HcyQbUni89pmghZMG29SNLA8wFq3waamCXQHNVATVUer'),
    tickArray2: new PublicKey('6Z2KMdAVK4Y9uuMzcN1PWBAYsZXPNEu3zbFsEXxE9hgd'),
    tickArray3: new PublicKey('774XYqTharj8ECjm5WvoczixkDm6Uy4A7GyToScr6DRx'),
  },
};

async function createALT(payer: Keypair): Promise<PublicKey> {
  console.log('📋 Creating Address Lookup Table...\n');
  
  const slot = await connection.getSlot('finalized');
  const [lookupTableInst, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });
  
  console.log(`ALT Address: ${lookupTableAddress.toBase58()}`);
  
  // Collect all frequently used accounts
  const addressesToAdd: PublicKey[] = [
    TOKEN_PROGRAM_ID,
    // Orca accounts
    ACCOUNTS.orca.tokenAuthority,
    ACCOUNTS.orca.whirlpool,
    ACCOUNTS.orca.tokenVaultA,
    ACCOUNTS.orca.tokenVaultB,
    ACCOUNTS.orca.tickArray0,
    ACCOUNTS.orca.tickArray1,
    ACCOUNTS.orca.tickArray2,
    ACCOUNTS.orca.oracle,
    // Meteora accounts
    ACCOUNTS.meteora.lbPair,
    ACCOUNTS.meteora.reserveX,
    ACCOUNTS.meteora.reserveY,
    ACCOUNTS.meteora.tokenXMint,
    ACCOUNTS.meteora.tokenYMint,
    ACCOUNTS.meteora.oracle,
    ACCOUNTS.meteora.eventAuthority,
    ACCOUNTS.meteora.program,
    ACCOUNTS.meteora.binArray1,
    ACCOUNTS.meteora.binArray2,
    ACCOUNTS.meteora.binArray3,
    // Raydium accounts
    ACCOUNTS.raydium.ammConfig,
    ACCOUNTS.raydium.poolState,
    ACCOUNTS.raydium.inputVault,
    ACCOUNTS.raydium.outputVault,
    ACCOUNTS.raydium.observationState,
    ACCOUNTS.raydium.tokenProgram2022,
    ACCOUNTS.raydium.memoProgram,
    ACCOUNTS.raydium.inputVaultMint,
    ACCOUNTS.raydium.outputVaultMint,
    ACCOUNTS.raydium.tickArray1,
    ACCOUNTS.raydium.tickArray2,
    ACCOUNTS.raydium.tickArray3,
  ];
  
  console.log(`Adding ${addressesToAdd.length} addresses to ALT (in batches)...\n`);
  
  // Create the lookup table first
  let { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  let messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [lookupTableInst],
  }).compileToV0Message();
  
  let transaction = new VersionedTransaction(messageV0);
  transaction.sign([payer]);
  
  let signature = await connection.sendTransaction(transaction);
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
  
  console.log(`✅ ALT created: ${signature}`);
  
  // Extend in batches of 20 addresses
  const batchSize = 20;
  for (let i = 0; i < addressesToAdd.length; i += batchSize) {
    const batch = addressesToAdd.slice(i, Math.min(i + batchSize, addressesToAdd.length));
    
    const extendInstruction = AddressLookupTableProgram.extendLookupTable({
      payer: payer.publicKey,
      authority: payer.publicKey,
      lookupTable: lookupTableAddress,
      addresses: batch,
    });

    // Re-fetch latest blockhash for each batch (fixes lint/parse error)
    const latestBlockhashObj = await connection.getLatestBlockhash();
    blockhash = latestBlockhashObj.blockhash;
    lastValidBlockHeight = latestBlockhashObj.lastValidBlockHeight;

    messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [extendInstruction],
    }).compileToV0Message();
    
    transaction = new VersionedTransaction(messageV0);
    transaction.sign([payer]);
    
    signature = await connection.sendTransaction(transaction);
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
    
    console.log(`✅ Added batch ${Math.floor(i / batchSize) + 1}: ${batch.length} addresses`);
  }
  
  console.log(`\n✅ ALT fully populated\n`);
  
  // Wait for ALT to be usable
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return lookupTableAddress;
}

async function test3HopWithALT() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🎯 3-HOP ARBITRAGE WITH ADDRESS LOOKUP TABLE');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('Route: SOL → USDC → TRUMP → SOL\n');
  
  // // Setup payer
  // console.log('⏳ Requesting airdrop...\n');
  // await connection.confirmTransaction(
  //   await connection.requestAirdrop(payer.publicKey, 5 * LAMPORTS_PER_SOL)
  // );
  
  console.log(`Payer: ${payer.publicKey.toBase58()}\n`);
  
  // Create ALT
  // const lookupTableAddress = await createALT(payer);
  const lookupTableAddress=new PublicKey("4Koh8sJUJ8tLNiesfUqoCpUxfnMTmQhopZvPUR9iWoNd");
  // Fetch the lookup table
  const lookupTableAccount = await connection.getAddressLookupTable(lookupTableAddress);
  if (!lookupTableAccount.value) {
    throw new Error('Lookup table not found');
  }
  // console.log(lookupTableAccount)
  // Define mint addresses
  const solMint = new PublicKey('So11111111111111111111111111111111111111112');
  const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const trumpMint = new PublicKey('6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN');
  
  // Get associated token accounts for user
  const userSOL = getAssociatedTokenAddressSync(solMint, payer.publicKey);
  const userUSDC = getAssociatedTokenAddressSync(usdcMint, payer.publicKey);
  const userTRUMP = getAssociatedTokenAddressSync(trumpMint, payer.publicKey);
  
  // Create all token accounts in one transaction
  const setupInstructions = [];
  
  // Check and create wSOL account
  const solAccountInfo = await connection.getAccountInfo(userSOL);
  if (!solAccountInfo) {
    setupInstructions.push(
      createAssociatedTokenAccountInstruction(payer.publicKey, userSOL, payer.publicKey, solMint)
    );
    setupInstructions.push(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: userSOL,
        lamports: 105_000_000, // 0.105 SOL total (includes rent-exempt ~2M + 0.1 for swap)
      }),
      // Sync native instruction to recognize the SOL as wSOL tokens
      createSyncNativeInstruction(userSOL, SPL_TOKEN_PROGRAM_ID)
    );
  }
  // Add SOL to wSOL account (rent + balance) and sync
  // Note: Token account needs ~2M lamports for rent-exempt + amount for swap
  
  
  // Create USDC account if needed
  const usdcAccountInfo = await connection.getAccountInfo(userUSDC);
  if (!usdcAccountInfo) {
    setupInstructions.push(
      createAssociatedTokenAccountInstruction(payer.publicKey, userUSDC, payer.publicKey, usdcMint)
    );
  }
  
  // Create TRUMP account if needed
  const trumpAccountInfo = await connection.getAccountInfo(userTRUMP);
  if (!trumpAccountInfo) {
    setupInstructions.push(
      createAssociatedTokenAccountInstruction(payer.publicKey, userTRUMP, payer.publicKey, trumpMint)
    );
  }
  
  // Send setup transaction
  if (setupInstructions.length > 0) {
    const setupTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        instructions: setupInstructions,
      }).compileToV0Message()
    );
    setupTx.sign([payer]);
    await connection.sendTransaction(setupTx);
    console.log(`✅ Token accounts created and funded\n`);
  }
  
  console.log(`User wSOL ATA: ${userSOL.toBase58()}`);
  console.log(`User USDC ATA: ${userUSDC.toBase58()}`);
  console.log(`User TRUMP ATA: ${userTRUMP.toBase58()}\n`);
  
  // Build arbitrage route - Using Orca Whirlpool V2
  const route: ArbitrageRoute = {
    initialAmount: BigInt(50_000_000), // 0.05 SOL
    minimumFinalOutput: BigInt(1_000_000), // Expect at least 0.001 SOL back (realistic after 3 hops with fees)
    hops: [
      {
        dexProgram: DexProgram.OrcaWhirlpool,
        isSwapV2: true, // Use swapV2 instruction (16 accounts)
        poolIndex: 0,
        inputMint: solMint,
        outputMint: usdcMint,
        minimumOutput: BigInt(3_000_000), // ~5 USDC minimum (very loose)
      },
      {
        dexProgram: DexProgram.MeteoraDlmm,
        isSwapV2: false, // Use standard swap instruction (19 accounts)
        poolIndex: 1,
        inputMint: usdcMint,
        outputMint: trumpMint,
        minimumOutput: BigInt(100_000), // 0.1 TRUMP minimum (6 decimals)
      },
      {
        dexProgram: DexProgram.RaydiumClmm,
        isSwapV2: true, // Use swap_v2 instruction (14 accounts)
        poolIndex: 2,
        inputMint: trumpMint,
        outputMint: solMint,
        minimumOutput: BigInt(1_000_000), // 0.001 SOL minimum (realistic for this pool)
      },
    ],
  };
  
  const instructionData = buildArbitrageInstructionData(route);
  
  // Build accounts - now many will come from ALT
  const accounts = [
    // Core accounts (must be explicit)
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    
    // Hop 1: Orca V2 (15 accounts) - includes token mints and memo program
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program_a
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program_b
    { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false }, // memo_program
    { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // token_authority (signer)
    { pubkey: ACCOUNTS.orca.whirlpool, isSigner: false, isWritable: true }, // whirlpool
    { pubkey: solMint, isSigner: false, isWritable: false }, // token_mint_a (SOL)
    { pubkey: usdcMint, isSigner: false, isWritable: false }, // token_mint_b (USDC)
    { pubkey: userSOL, isSigner: false, isWritable: true }, // token_owner_account_a
    { pubkey: ACCOUNTS.orca.tokenVaultA, isSigner: false, isWritable: true }, // token_vault_a
    { pubkey: userUSDC, isSigner: false, isWritable: true }, // token_owner_account_b
    { pubkey: ACCOUNTS.orca.tokenVaultB, isSigner: false, isWritable: true }, // token_vault_b
    { pubkey: ACCOUNTS.orca.tickArray0, isSigner: false, isWritable: true }, // tick_array_0
    { pubkey: ACCOUNTS.orca.tickArray1, isSigner: false, isWritable: true }, // tick_array_1
    { pubkey: ACCOUNTS.orca.tickArray2, isSigner: false, isWritable: true }, // tick_array_2
    { pubkey: ACCOUNTS.orca.oracle, isSigner: false, isWritable: true }, // oracle (mutable in V2)
    { pubkey: ORCA_WHIRLPOOL_PROGRAM_ID, isSigner: false, isWritable: false }, // whirlpool_program (needed for CPI)
    
    // Hop 2: Meteora DLMM swap (14 base + 3 bin_arrays + 1 program = 18 accounts)
    { pubkey: METEORA_LB_PAIR, isSigner: false, isWritable: true }, // lb_pair
    { pubkey: METEORA_DLMM_PROGRAM_ID, isSigner: false, isWritable: false }, // bin_array_bitmap_extension (optional - use program ID when doesn't exist)
    { pubkey: ACCOUNTS.meteora.reserveX, isSigner: false, isWritable: true }, // reserve_x (TRUMP)
    { pubkey: ACCOUNTS.meteora.reserveY, isSigner: false, isWritable: true }, // reserve_y (USDC)
    { pubkey: userUSDC, isSigner: false, isWritable: true }, // user_token_in (USDC)
    { pubkey: userTRUMP, isSigner: false, isWritable: true }, // user_token_out (TRUMP)
    { pubkey: ACCOUNTS.meteora.tokenXMint, isSigner: false, isWritable: false }, // token_x_mint (TRUMP)
    { pubkey: ACCOUNTS.meteora.tokenYMint, isSigner: false, isWritable: false }, // token_y_mint (USDC)
    { pubkey: ACCOUNTS.meteora.oracle, isSigner: false, isWritable: true }, // oracle
    { pubkey: METEORA_DLMM_PROGRAM_ID, isSigner: false, isWritable: false }, // host_fee_in (optional - use program ID when doesn't exist)
    { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // user (signer)
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_x_program
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_y_program
    { pubkey: ACCOUNTS.meteora.eventAuthority, isSigner: false, isWritable: false }, // event_authority
    { pubkey: METEORA_DLMM_PROGRAM_ID, isSigner: false, isWritable: false }, // meteora_program (needed for CPI)
    { pubkey: ACCOUNTS.meteora.binArray1, isSigner: false, isWritable: true }, // bin_array (remaining)
    { pubkey: ACCOUNTS.meteora.binArray2, isSigner: false, isWritable: true }, // bin_array (remaining)
    { pubkey: ACCOUNTS.meteora.binArray3, isSigner: false, isWritable: true }, // bin_array (remaining)
    { pubkey: METEORA_DLMM_PROGRAM_ID, isSigner: false, isWritable: false }, // meteora_program (needed for CPI)
    
    // Hop 3: Raydium CLMM swap_v2 (13 base + 1 program = 14 accounts)
    { pubkey: payer.publicKey, isSigner: true, isWritable: false }, // payer (signer)
    { pubkey: ACCOUNTS.raydium.ammConfig, isSigner: false, isWritable: false }, // amm_config
    { pubkey: ACCOUNTS.raydium.poolState, isSigner: false, isWritable: true }, // pool_state
    { pubkey: userTRUMP, isSigner: false, isWritable: true }, // input_token_account
    { pubkey: userSOL, isSigner: false, isWritable: true }, // output_token_account
    { pubkey: ACCOUNTS.raydium.inputVault, isSigner: false, isWritable: true }, // input_vault
    { pubkey: ACCOUNTS.raydium.outputVault, isSigner: false, isWritable: true }, // output_vault
    { pubkey: ACCOUNTS.raydium.observationState, isSigner: false, isWritable: true }, // observation_state
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
    { pubkey: ACCOUNTS.raydium.tokenProgram2022, isSigner: false, isWritable: false }, // token_program_2022
    { pubkey: ACCOUNTS.raydium.memoProgram, isSigner: false, isWritable: false }, // memo_program
    { pubkey: ACCOUNTS.raydium.inputVaultMint, isSigner: false, isWritable: false }, // input_vault_mint
    { pubkey: ACCOUNTS.raydium.outputVaultMint, isSigner: false, isWritable: false }, // output_vault_mint
    { pubkey: ACCOUNTS.raydium.tickArray1, isSigner: false, isWritable: true }, // tick_array (remaining)
    { pubkey: ACCOUNTS.raydium.tickArray2, isSigner: false, isWritable: true }, // tick_array (remaining)
    { pubkey: ACCOUNTS.raydium.tickArray3, isSigner: false, isWritable: true }, // tick_array (remaining)
    { pubkey: RAYDIUM_CLMM_PROGRAM_ID, isSigner: false, isWritable: false }, // raydium_program (needed for CPI)
  ];
  
  const instruction = new TransactionInstruction({
    keys: accounts,
    programId: PROGRAM_ID,
    data: instructionData,
  });
  
  console.log('📦 Building versioned transaction with ALT...\n');
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  
  const computeUnitInstruction = ComputeBudgetProgram.setComputeUnitLimit({
    units: 800_000,
  });
  
  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [computeUnitInstruction, instruction],
  }).compileToV0Message([lookupTableAccount.value]);
  const transaction = new VersionedTransaction(messageV0);
  
  console.log(`   Versioned transaction size: ~${transaction.message.serialize().length} bytes\n`);
  console.log('⏳ Executing 3-hop arbitrage...\n');
  
  transaction.sign([payer]);
  
  try {
    const signature = await connection.sendTransaction(transaction, { skipPreflight: true });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅✅✅ 3-HOP ARBITRAGE SUCCESS! ✅✅✅');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`🔗 Signature: ${signature}\n`);
    
    const txDetails = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    
    if (txDetails?.meta?.logMessages) {
      console.log('📝 Logs:');
      txDetails.meta.logMessages.forEach(log => console.log(`   ${log}`));
    }
    
    return true;
  } catch (error: any) {
    console.log('❌ Transaction Failed\n');
    
    if (error.logs) {
      console.log('📝 Logs:');
      error.logs.forEach((log: string) => console.log(`   ${log}`));
      console.log('');
    }
    
    console.log(`Error: ${error.message}\n`);
    return false;
  }
}

test3HopWithALT()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
