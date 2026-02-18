#!/usr/bin/env ts-node
/**
 * Mainnet-Fork 4-Hop Arbitrage Test with Address Lookup Table
 * Route: SOL → USDC → USDT → Em8D → SOL
 * 
 * Hop 1: Raydium AMM V4 (swap_v2) - SOL/USDC
 * Hop 2: Orca Whirlpool (swap) - USDC/USDT  
 * Hop 3: Raydium CPMM (swap_base_input) - USDT/Em8D
 * Hop 4: Raydium CPMM (swap_base_input) - Em8D/SOL
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
import { buildArbitrageInstructionData, DexProgram, ArbitrageRoute } from './instruction';

const PROGRAM_ID = new PublicKey('CJrTqPA9Y37bxE6VXRtjTkK8irRrEWuKh5gHSsqXJrVt');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// DEX Program IDs
const RAYDIUM_AMM_V4_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const ORCA_WHIRLPOOL_PROGRAM_ID = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const RAYDIUM_CPMM_PROGRAM_ID = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');

const connection = new Connection('http://localhost:8899', 'confirmed');

// Token mints
const SOL_MINT = NATIVE_MINT; // So11111111111111111111111111111111111111112
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const EM8D_MINT = new PublicKey('Em8DYuvdQ28PNZqSiAvUxjG32XbpFPm9kwu2y5pdTray');

// Pool accounts from real transactions
const ACCOUNTS = {
  // HOP 1: Raydium AMM V4 - SOL/USDC pool
  raydiumAmm: {
    ammId: new PublicKey('58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'),
    ammAuthority: new PublicKey('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'),
    ammCoinVault: new PublicKey('DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz'), // SOL vault
    ammPcVault: new PublicKey('HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz'), // USDC vault
  },
  
  // HOP 2: Orca Whirlpool - USDC/USDT pool
  orcaWhirlpool: {
    whirlpool: new PublicKey('4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4'),
    tokenVaultA: new PublicKey('4oY1eVHJrt7ywuFoQnAZwto4qcQip1QhYMAhD11PU4QL'), // USDC vault
    tokenVaultB: new PublicKey('4dSG9tKHZR4CAictyEnH9XuGZyKapodWXq5xyg7uFwE9'), // USDT vault
    tickArray0: new PublicKey('FqFkv2xNNCUyx1RYV61pGZ9AMzGfgcD8uXC9zCF5JKnR'),
    tickArray1: new PublicKey('A7sdy3NoAZp49cQNpreMGARAb9QJjYrrSyDALhThgk3D'),
    tickArray2: new PublicKey('9opqNK3dWUijw8VNLtvne4juCTq1qADaph29tZqkoZHa'),
    oracle: new PublicKey('3NxDBWt55DZnEwwQ2bhQ3xWG8Jd18TdUXAG4Zdr7jDai'),
  },
  
  // HOP 3: Raydium CPMM - USDT/Em8D pool
  cpmmPool1: {
    authority: new PublicKey('GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL'),
    ammConfig: new PublicKey('D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2'),
    poolState: new PublicKey('9UV4xi4qNXahp1zZRjiDEzAfNJcmUFmszweCKcMeM35C'),
    inputVault: new PublicKey('AZyTH7ZeyCnz47NuVq1pfDQS5SyjA6kYjyRRkSxKNh2b'), // USDT vault
    outputVault: new PublicKey('GkqVfegszpMAhr5gcUuQMNj4J9wXdjBneZtS1Zp2g6ba'), // Em8D vault
    observationState: new PublicKey('Fh8oPiF3C687QLC4ex6wMqTKtMoUDCcVqNsTmHerY6C2'),
  },
  
  // HOP 4: Raydium CPMM - Em8D/SOL pool
  cpmmPool2: {
    authority: new PublicKey('GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL'),
    ammConfig: new PublicKey('D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2'),
    poolState: new PublicKey('9N82SeWs9cFrThpNyU8dngUjRHe9vzVjDnQrgQ115tEy'),
    inputVault: new PublicKey('CrTmhbeGWPbdkuatSCoZezFzvSWX9xyRC2GTzkNUKaJF'), // Em8D vault
    outputVault: new PublicKey('GfaNhULVwq4Dk7AiYQutxfJuKMMFcSZrR17cQ1VK5zSU'), // SOL vault
    observationState: new PublicKey('3v5rWVMEEfed4PgD1L5YGebipGU4UZSEzXcZzfTtPNnn'),
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
    // Raydium AMM V4 accounts
    ACCOUNTS.raydiumAmm.ammId,
    ACCOUNTS.raydiumAmm.ammAuthority,
    ACCOUNTS.raydiumAmm.ammCoinVault,
    ACCOUNTS.raydiumAmm.ammPcVault,
    RAYDIUM_AMM_V4_PROGRAM_ID,
    // Orca Whirlpool accounts
    ACCOUNTS.orcaWhirlpool.whirlpool,
    ACCOUNTS.orcaWhirlpool.tokenVaultA,
    ACCOUNTS.orcaWhirlpool.tokenVaultB,
    ACCOUNTS.orcaWhirlpool.tickArray0,
    ACCOUNTS.orcaWhirlpool.tickArray1,
    ACCOUNTS.orcaWhirlpool.tickArray2,
    ACCOUNTS.orcaWhirlpool.oracle,
    ORCA_WHIRLPOOL_PROGRAM_ID,
    // Raydium CPMM Pool 1 accounts
    ACCOUNTS.cpmmPool1.authority,
    ACCOUNTS.cpmmPool1.ammConfig,
    ACCOUNTS.cpmmPool1.poolState,
    ACCOUNTS.cpmmPool1.inputVault,
    ACCOUNTS.cpmmPool1.outputVault,
    ACCOUNTS.cpmmPool1.observationState,
    // Raydium CPMM Pool 2 accounts
    ACCOUNTS.cpmmPool2.poolState,
    ACCOUNTS.cpmmPool2.inputVault,
    ACCOUNTS.cpmmPool2.outputVault,
    ACCOUNTS.cpmmPool2.observationState,
    RAYDIUM_CPMM_PROGRAM_ID,
    // Token mints
    SOL_MINT,
    USDC_MINT,
    USDT_MINT,
    EM8D_MINT,
  ];
  
  console.log(`Adding ${addressesToAdd.length} addresses to ALT...\n`);
  
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
    
    ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash());
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

async function test4HopWithALT() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🎯 4-HOP ARBITRAGE WITH ADDRESS LOOKUP TABLE');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('Route: SOL → USDC → USDT → Em8D → SOL\n');
  console.log('Hop 1: Raydium AMM V4 (swap_v2)');
  console.log('Hop 2: Orca Whirlpool (swap)');
  console.log('Hop 3: Raydium CPMM (swap_base_input)');
  console.log('Hop 4: Raydium CPMM (swap_base_input)\n');
  
  // Setup payer
  const payer = Keypair.generate();
  console.log('⏳ Requesting airdrop...\n');
  await connection.confirmTransaction(
    await connection.requestAirdrop(payer.publicKey, 5 * LAMPORTS_PER_SOL)
  );
  
  console.log(`Payer: ${payer.publicKey.toBase58()}\n`);
  
  // Create ALT
  const lookupTableAddress = await createALT(payer);
  
  // Fetch the lookup table
  const lookupTableAccount = await connection.getAddressLookupTable(lookupTableAddress);
  if (!lookupTableAccount.value) {
    throw new Error('Lookup table not found');
  }
  
  // Get associated token accounts for user
  const userSOL = getAssociatedTokenAddressSync(SOL_MINT, payer.publicKey);
  const userUSDC = getAssociatedTokenAddressSync(USDC_MINT, payer.publicKey);
  const userUSDT = getAssociatedTokenAddressSync(USDT_MINT, payer.publicKey);
  const userEM8D = getAssociatedTokenAddressSync(EM8D_MINT, payer.publicKey);
  
  // Create all token accounts in one transaction
  const setupInstructions = [];
  
  // Check and create wSOL account
  const solAccountInfo = await connection.getAccountInfo(userSOL);
  if (!solAccountInfo) {
    setupInstructions.push(
      createAssociatedTokenAccountInstruction(payer.publicKey, userSOL, payer.publicKey, SOL_MINT)
    );
  }
  
  // Add SOL to wSOL account and sync
  setupInstructions.push(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: userSOL,
      lamports: 105_000_000, // 0.105 SOL (rent + swap amount)
    }),
    createSyncNativeInstruction(userSOL, SPL_TOKEN_PROGRAM_ID)
  );
  
  // Create USDC account if needed
  const usdcAccountInfo = await connection.getAccountInfo(userUSDC);
  if (!usdcAccountInfo) {
    setupInstructions.push(
      createAssociatedTokenAccountInstruction(payer.publicKey, userUSDC, payer.publicKey, USDC_MINT)
    );
  }
  
  // Create USDT account if needed
  const usdtAccountInfo = await connection.getAccountInfo(userUSDT);
  if (!usdtAccountInfo) {
    setupInstructions.push(
      createAssociatedTokenAccountInstruction(payer.publicKey, userUSDT, payer.publicKey, USDT_MINT)
    );
  }
  
  // Create Em8D account if needed
  const em8dAccountInfo = await connection.getAccountInfo(userEM8D);
  if (!em8dAccountInfo) {
    setupInstructions.push(
      createAssociatedTokenAccountInstruction(payer.publicKey, userEM8D, payer.publicKey, EM8D_MINT)
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
  console.log(`User USDT ATA: ${userUSDT.toBase58()}`);
  console.log(`User Em8D ATA: ${userEM8D.toBase58()}\n`);
  
  // Build arbitrage route
  const route: ArbitrageRoute = {
    initialAmount: BigInt(100_000_000), // 0.1 SOL
    minimumFinalOutput: BigInt(1_000_000), // 0.001 SOL minimum (realistic after 4 hops with fees)
    hops: [
      {
        dexProgram: DexProgram.RaydiumAmmV4,
        isSwapV2: true, // swap_v2 instruction
        poolIndex: 0,
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        minimumOutput: BigInt(1_000_000), // ~1 USDC minimum
      },
      {
        dexProgram: DexProgram.OrcaWhirlpool,
        isSwapV2: false, // standard swap instruction (11 accounts)
        poolIndex: 1,
        inputMint: USDC_MINT,
        outputMint: USDT_MINT,
        minimumOutput: BigInt(1_000_000), // ~1 USDT minimum
      },
      {
        dexProgram: DexProgram.RaydiumCpmm,
        isSwapV2: false, // swap_base_input instruction
        poolIndex: 2,
        inputMint: USDT_MINT,
        outputMint: EM8D_MINT,
        minimumOutput: BigInt(1), // Minimal for intermediate token
      },
      {
        dexProgram: DexProgram.RaydiumCpmm,
        isSwapV2: false, // swap_base_input instruction
        poolIndex: 3,
        inputMint: EM8D_MINT,
        outputMint: SOL_MINT,
        minimumOutput: BigInt(1_000_000), // 0.001 SOL minimum
      },
    ],
  };
  
  const instructionData = buildArbitrageInstructionData(route);
  
  // Build accounts list following exact order from real transactions
  const accounts = [
    // Core account (payer/signer)
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    
    // ═══════════════════════════════════════════════════════════════════
    // HOP 1: Raydium AMM V4 swap_v2 (8 accounts + 1 program = 9)
    // ═══════════════════════════════════════════════════════════════════
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },           // token_program
    { pubkey: ACCOUNTS.raydiumAmm.ammId, isSigner: false, isWritable: true },   // amm
    { pubkey: ACCOUNTS.raydiumAmm.ammAuthority, isSigner: false, isWritable: false }, // amm_authority
    { pubkey: ACCOUNTS.raydiumAmm.ammCoinVault, isSigner: false, isWritable: true },  // amm_coin_vault (SOL)
    { pubkey: ACCOUNTS.raydiumAmm.ammPcVault, isSigner: false, isWritable: true },    // amm_pc_vault (USDC)
    { pubkey: userSOL, isSigner: false, isWritable: true },                     // user_source_token (SOL)
    { pubkey: userUSDC, isSigner: false, isWritable: true },                    // user_dest_token (USDC)
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },             // user_wallet
    { pubkey: RAYDIUM_AMM_V4_PROGRAM_ID, isSigner: false, isWritable: false },  // raydium_amm_program
    
    // ═══════════════════════════════════════════════════════════════════
    // HOP 2: Orca Whirlpool swap (11 accounts + 1 program = 12)
    // ═══════════════════════════════════════════════════════════════════
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },           // token_program
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },             // token_authority
    { pubkey: ACCOUNTS.orcaWhirlpool.whirlpool, isSigner: false, isWritable: true }, // whirlpool
    { pubkey: userUSDC, isSigner: false, isWritable: true },                    // token_owner_account_a (USDC)
    { pubkey: ACCOUNTS.orcaWhirlpool.tokenVaultA, isSigner: false, isWritable: true }, // token_vault_a
    { pubkey: userUSDT, isSigner: false, isWritable: true },                    // token_owner_account_b (USDT)
    { pubkey: ACCOUNTS.orcaWhirlpool.tokenVaultB, isSigner: false, isWritable: true }, // token_vault_b
    { pubkey: ACCOUNTS.orcaWhirlpool.tickArray0, isSigner: false, isWritable: true },  // tick_array_0
    { pubkey: ACCOUNTS.orcaWhirlpool.tickArray1, isSigner: false, isWritable: true },  // tick_array_1
    { pubkey: ACCOUNTS.orcaWhirlpool.tickArray2, isSigner: false, isWritable: true },  // tick_array_2
    { pubkey: ACCOUNTS.orcaWhirlpool.oracle, isSigner: false, isWritable: false },     // oracle
    { pubkey: ORCA_WHIRLPOOL_PROGRAM_ID, isSigner: false, isWritable: false },  // whirlpool_program
    
    // ═══════════════════════════════════════════════════════════════════
    // HOP 3: Raydium CPMM swap_base_input (14 accounts + 1 program = 15)
    // USDT → Em8D
    // ═══════════════════════════════════════════════════════════════════
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },             // payer
    { pubkey: ACCOUNTS.cpmmPool1.authority, isSigner: false, isWritable: false }, // authority
    { pubkey: ACCOUNTS.cpmmPool1.ammConfig, isSigner: false, isWritable: false }, // amm_config
    { pubkey: ACCOUNTS.cpmmPool1.poolState, isSigner: false, isWritable: true }, // pool_state
    { pubkey: userUSDT, isSigner: false, isWritable: true },                    // input_token_account
    { pubkey: userEM8D, isSigner: false, isWritable: true },                    // output_token_account
    { pubkey: ACCOUNTS.cpmmPool1.inputVault, isSigner: false, isWritable: true }, // input_vault
    { pubkey: ACCOUNTS.cpmmPool1.outputVault, isSigner: false, isWritable: true }, // output_vault
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },           // input_token_program
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },           // output_token_program
    { pubkey: USDT_MINT, isSigner: false, isWritable: false },                  // input_token_mint
    { pubkey: EM8D_MINT, isSigner: false, isWritable: false },                  // output_token_mint
    { pubkey: ACCOUNTS.cpmmPool1.observationState, isSigner: false, isWritable: true }, // observation_state
    { pubkey: RAYDIUM_CPMM_PROGRAM_ID, isSigner: false, isWritable: false },    // cpmm_program
    
    // ═══════════════════════════════════════════════════════════════════
    // HOP 4: Raydium CPMM swap_base_input (14 accounts + 1 program = 15)
    // Em8D → SOL
    // ═══════════════════════════════════════════════════════════════════
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },             // payer
    { pubkey: ACCOUNTS.cpmmPool2.authority, isSigner: false, isWritable: false }, // authority
    { pubkey: ACCOUNTS.cpmmPool2.ammConfig, isSigner: false, isWritable: false }, // amm_config (same as pool1)
    { pubkey: ACCOUNTS.cpmmPool2.poolState, isSigner: false, isWritable: true }, // pool_state
    { pubkey: userEM8D, isSigner: false, isWritable: true },                    // input_token_account
    { pubkey: userSOL, isSigner: false, isWritable: true },                     // output_token_account
    { pubkey: ACCOUNTS.cpmmPool2.inputVault, isSigner: false, isWritable: true }, // input_vault
    { pubkey: ACCOUNTS.cpmmPool2.outputVault, isSigner: false, isWritable: true }, // output_vault
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },           // input_token_program
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },           // output_token_program
    { pubkey: EM8D_MINT, isSigner: false, isWritable: false },                  // input_token_mint
    { pubkey: SOL_MINT, isSigner: false, isWritable: false },                   // output_token_mint
    { pubkey: ACCOUNTS.cpmmPool2.observationState, isSigner: false, isWritable: true }, // observation_state
    { pubkey: RAYDIUM_CPMM_PROGRAM_ID, isSigner: false, isWritable: false },    // cpmm_program
  ];
  
  const instruction = new TransactionInstruction({
    keys: accounts,
    programId: PROGRAM_ID,
    data: instructionData,
  });
  
  console.log('📦 Building versioned transaction with ALT...\n');
  console.log(`   Total accounts: ${accounts.length}`);
  
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  
  const computeUnitInstruction = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000, // 4 hops need more compute
  });
  
  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [computeUnitInstruction, instruction],
  }).compileToV0Message([lookupTableAccount.value]);
  
  const transaction = new VersionedTransaction(messageV0);
  
  console.log(`   Versioned transaction size: ~${transaction.message.serialize().length} bytes\n`);
  console.log('⏳ Executing 4-hop arbitrage...\n');
  
  transaction.sign([payer]);
  
  try {
    const signature = await connection.sendTransaction(transaction, { skipPreflight: true });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅✅✅ 4-HOP ARBITRAGE SUCCESS! ✅✅✅');
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

test4HopWithALT()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
