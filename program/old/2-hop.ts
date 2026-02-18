#!/usr/bin/env ts-node
/**
 * Mainnet-Fork 2-Hop Test: SOL → USDC → SOL
 * Route: SOL → USDC (Meteora DLMM V2) → SOL (Meteora DLMM)
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
import { PRIVATE_KEY } from '../constants';
import { 
  getAssociatedTokenAddressSync, 
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID as SPL_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { buildArbitrageInstructionData, DexProgram, ArbitrageRoute } from './instruction';

const PROGRAM_ID = new PublicKey('CJrTqPA9Y37bxE6VXRtjTkK8irRrEWuKh5gHSsqXJrVt');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const METEORA_DLMM_V2_PROGRAM_ID = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
const METEORA_DLMM_PROGRAM_ID = new PublicKey('Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB');
const VAULT_PROGRAM_ID = new PublicKey('24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi');
const connection = new Connection('http://localhost:8899', 'confirmed');

// Token mints
const SOL_MINT = NATIVE_MINT;
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Meteora DAMM V2 Pool: SOL/USDC (meteora_dyn2.json IDL structure)
const METEORA_V2_SOL_USDC_ACCOUNTS = {
  poolAuthority: new PublicKey('HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'),
  pool: new PublicKey('8Pm2kZpnxD3hoMmt4bjStX2Pw2Z9abpbHzZxMPqxPmie'),
  tokenAVault: new PublicKey('sx8hCMCauCdbZ7sVBGSJmH7b7JmtuN8d8YwYmBpuPLH'), // SOL vault
  tokenBVault: new PublicKey('8S8HjmPZr8tNNEmMj5pcqS5RN73uF6DmcUDEDaoUQ1Ei'), // USDC vault
  tokenAMint: SOL_MINT,
  tokenBMint: USDC_MINT,
  referralTokenAccount: new PublicKey('8S8HjmPZr8tNNEmMj5pcqS5RN73uF6DmcUDEDaoUQ1Ei'), // Use USDC vault as placeholder (referral optional)
  eventAuthority: new PublicKey('3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet'),
};

// Meteora DAMM V1 Pool: USDC/SOL
const METEORA_DLMM_USDC_SOL_ACCOUNTS = {
  pool: new PublicKey('5yuefgbJJpmFNK2iiYbLSpv1aZXq7F9AUKkZKErTYCvs'),
  aVault: new PublicKey('3ESUFCnRNgZ7Mn2mPPUMmXYaKU8jpnV9VtA17M7t2mHQ'),
  bVault: new PublicKey('FERjPVNEa7Udq8CEv68h6tPL46Tq7ieE49HrE2wea3XT'),
  aTokenVault: new PublicKey('C2QoQ111jGHEy5918XkNXQro7gGwC9PKLXd1LqBiYNwA'),
  bTokenVault: new PublicKey('HZeLxbZ9uHtSpwZC3LBr4Nubd14iHwz7bRSghRZf5VCG'),
  aVaultLpMint: new PublicKey('3RpEekjLE5cdcG15YcXJUpxSepemvq2FpmMcgo342BwC'),
  bVaultLpMint: new PublicKey('FZN7QZ8ZUUAxMPfxYEYkH3cXUASzH8EqA6B4tyCL8f1j'),
  aVaultLp: new PublicKey('CNc2A5yjKUa9Rp3CVYXF9By1qvRHXMncK9S254MS9JeV'), // Actual vault LP from pool
  bVaultLp: new PublicKey('7LHUMZd12RuanSXhXjQWPSXS6QEVQimgwxde6xYTJuA7'), // Actual vault LP from pool
  protocolTokenFee: new PublicKey('3YWmQzX9gm6EWLx72f7EUVWiVsWm1y8JzfJvTdRJe8v6'),
  vaultProgram: VAULT_PROGRAM_ID,
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
    SystemProgram.programId,
    // Meteora DAMM V2 accounts
    METEORA_V2_SOL_USDC_ACCOUNTS.poolAuthority,
    METEORA_V2_SOL_USDC_ACCOUNTS.pool,
    METEORA_V2_SOL_USDC_ACCOUNTS.tokenAVault,
    METEORA_V2_SOL_USDC_ACCOUNTS.tokenBVault,
    METEORA_V2_SOL_USDC_ACCOUNTS.tokenAMint,
    METEORA_V2_SOL_USDC_ACCOUNTS.tokenBMint,
    METEORA_V2_SOL_USDC_ACCOUNTS.referralTokenAccount,
    METEORA_V2_SOL_USDC_ACCOUNTS.eventAuthority,
    // Meteora DAMM V1 accounts
    METEORA_DLMM_USDC_SOL_ACCOUNTS.pool,
    METEORA_DLMM_USDC_SOL_ACCOUNTS.aVault,
    METEORA_DLMM_USDC_SOL_ACCOUNTS.bVault,
    METEORA_DLMM_USDC_SOL_ACCOUNTS.aTokenVault,
    METEORA_DLMM_USDC_SOL_ACCOUNTS.bTokenVault,
    METEORA_DLMM_USDC_SOL_ACCOUNTS.aVaultLpMint,
    METEORA_DLMM_USDC_SOL_ACCOUNTS.bVaultLpMint,
    METEORA_DLMM_USDC_SOL_ACCOUNTS.aVaultLp,
    METEORA_DLMM_USDC_SOL_ACCOUNTS.bVaultLp,
    METEORA_DLMM_USDC_SOL_ACCOUNTS.protocolTokenFee,
    METEORA_DLMM_USDC_SOL_ACCOUNTS.vaultProgram,
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
  let sig = await connection.sendTransaction(transaction);
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
  
  console.log(`✅ ALT created: ${sig}\n`);
  
  // Wait a bit before extending
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Batch add addresses (max 30 per transaction)
  const BATCH_SIZE = 20;
  for (let i = 0; i < addressesToAdd.length; i += BATCH_SIZE) {
    const batch = addressesToAdd.slice(i, Math.min(i + BATCH_SIZE, addressesToAdd.length));
    const extendInstruction = AddressLookupTableProgram.extendLookupTable({
      payer: payer.publicKey,
      authority: payer.publicKey,
      lookupTable: lookupTableAddress,
      addresses: batch,
    });
    
    let { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    let messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [extendInstruction],
    }).compileToV0Message();
    
    let transaction = new VersionedTransaction(messageV0);
    transaction.sign([payer]);
    let sig = await connection.sendTransaction(transaction);
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
    
    console.log(`✅ Added batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(addressesToAdd.length / BATCH_SIZE)}`);
    
    // Wait between batches
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Wait for ALT to be active
  console.log('\n⏳ Waiting for ALT to be active...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return lookupTableAddress;
}

async function main() {
  console.log('🚀 Starting 2-Hop Arbitrage Test: SOL → USDC → SOL\n');
  
  // Load payer
  const payerKeypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY))
  
  console.log(`Payer: ${payerKeypair.publicKey.toBase58()}`);
  console.log(`Program: ${PROGRAM_ID.toBase58()}\n`);
  
  // Check SOL balance
  const balance = await connection.getBalance(payerKeypair.publicKey);
  console.log(`SOL Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);
  
  // Get token accounts
  const wsolAccount = getAssociatedTokenAddressSync(SOL_MINT, payerKeypair.publicKey);
  const usdcAccount = getAssociatedTokenAddressSync(USDC_MINT, payerKeypair.publicKey);
  
  console.log(`Wrapped SOL Account: ${wsolAccount.toBase58()}`);
  console.log(`USDC Token Account: ${usdcAccount.toBase58()}\n`);
  
  // Create ALT
  const altAddress = await createALT(payerKeypair);
  const lookupTableAccount = (await connection.getAddressLookupTable(altAddress)).value;
  if (!lookupTableAccount) {
    throw new Error('Failed to fetch lookup table');
  }
  
  console.log('\n📝 Building arbitrage instruction...\n');
  
  // Define the arbitrage route
  const route: ArbitrageRoute = {
    hops: [
      {
        dexProgram: DexProgram.MeteoraDammV2,
        isSwapV2: false, // V2 uses standard swap
        poolIndex: 1, // Start after user authority account
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        minimumOutput: BigInt(1_000), // 0.001 USDC minimum (6 decimals)
      },
      {
        dexProgram: DexProgram.MeteoraDammV1,
        isSwapV2: false,
        poolIndex: 15, // After Meteora DAMM V2 accounts (14 accounts + 1 program = 15)
        inputMint: USDC_MINT,
        outputMint: SOL_MINT,
        minimumOutput: BigInt(1_000_000), // 0.001 SOL minimum
      },
    ],
    initialAmount: BigInt(10_000_000), // 0.01 SOL
    minimumFinalOutput: BigInt(1_000_000), // 0.001 SOL (loose for testing)
  };
  
  console.log('Route Configuration:');
  console.log(`  Hop 1: SOL → USDC (Meteora DLMM V2)`);
  console.log(`    Input: 0.01 SOL (10,000,000 lamports)`);
  console.log(`    Min output: 0.001 USDC`);
  console.log(`  Hop 2: USDC → SOL (Meteora DLMM)`);
  console.log(`    Min output: 0.001 SOL\n`);
  
  // Build instruction data
  const instructionData = buildArbitrageInstructionData(route);
  
  // Build account list for all hops
  const remainingAccounts: PublicKey[] = [
    // Hop 1: Meteora DAMM V2 (14 + 1 program = 15 accounts) - SOL → USDC
    // IDL: pool_authority, pool, input_token_account, output_token_account, token_a_vault, token_b_vault,
    //      token_a_mint, token_b_mint, payer, token_a_program, token_b_program, referral_token_account,
    //      event_authority, program
    METEORA_V2_SOL_USDC_ACCOUNTS.poolAuthority,        // pool_authority
    METEORA_V2_SOL_USDC_ACCOUNTS.pool,                 // pool
    wsolAccount,                                        // input_token_account (SOL)
    usdcAccount,                                        // output_token_account (USDC)
    METEORA_V2_SOL_USDC_ACCOUNTS.tokenAVault,          // token_a_vault (SOL)
    METEORA_V2_SOL_USDC_ACCOUNTS.tokenBVault,          // token_b_vault (USDC)
    METEORA_V2_SOL_USDC_ACCOUNTS.tokenAMint,           // token_a_mint
    METEORA_V2_SOL_USDC_ACCOUNTS.tokenBMint,           // token_b_mint
    payerKeypair.publicKey,                             // payer (signer)
    TOKEN_PROGRAM_ID,                                   // token_a_program
    TOKEN_PROGRAM_ID,                                   // token_b_program
    METEORA_V2_SOL_USDC_ACCOUNTS.referralTokenAccount,                                        // referral_token_account (use output as referral)
    METEORA_V2_SOL_USDC_ACCOUNTS.eventAuthority,       // event_authority
    METEORA_DLMM_V2_PROGRAM_ID,                        // program (in IDL)
    METEORA_DLMM_V2_PROGRAM_ID,                        // program (for CPI invoke)
    
    // Hop 2: Meteora DAMM V1 (15 + 1 program = 16 accounts) - USDC → SOL
    // [0-2] Core accounts
    METEORA_DLMM_USDC_SOL_ACCOUNTS.pool,               // pool
    usdcAccount,                                        // user_source_token (USDC)
    wsolAccount,                                        // user_destination_token (SOL)
    
    // [3-6] Vaults
    METEORA_DLMM_USDC_SOL_ACCOUNTS.aVault,             // a_vault (USDC)
    METEORA_DLMM_USDC_SOL_ACCOUNTS.bVault,             // b_vault (SOL)
    METEORA_DLMM_USDC_SOL_ACCOUNTS.aTokenVault,        // a_token_vault
    METEORA_DLMM_USDC_SOL_ACCOUNTS.bTokenVault,        // b_token_vault
    
    // [7-13] LP mints and misc
    METEORA_DLMM_USDC_SOL_ACCOUNTS.aVaultLpMint,       // a_vault_lp_mint
    METEORA_DLMM_USDC_SOL_ACCOUNTS.bVaultLpMint,       // b_vault_lp_mint
    METEORA_DLMM_USDC_SOL_ACCOUNTS.aVaultLp,           // a_vault_lp
    METEORA_DLMM_USDC_SOL_ACCOUNTS.bVaultLp,           // b_vault_lp
    METEORA_DLMM_USDC_SOL_ACCOUNTS.protocolTokenFee,   // protocol_token_fee (admin_token_fee)
    payerKeypair.publicKey,                             // user
    METEORA_DLMM_USDC_SOL_ACCOUNTS.vaultProgram,       // vault_program
    TOKEN_PROGRAM_ID,                                   // token_program
    
    // [15] Program ID
    METEORA_DLMM_PROGRAM_ID,
  ];
  
  console.log(`Total accounts in transaction: ${remainingAccounts.length}\n`);
  
  // Setup instructions
  const setupIxs: TransactionInstruction[] = [];
  
  // Create WSOL account if needed
  const wsolAccountInfo = await connection.getAccountInfo(wsolAccount);
  if (!wsolAccountInfo) {
    console.log('Creating wrapped SOL account...');
    setupIxs.push(
      createAssociatedTokenAccountInstruction(
        payerKeypair.publicKey,
        wsolAccount,
        payerKeypair.publicKey,
        NATIVE_MINT
      )
    );
  }
  
  // Create USDC account if needed
  const usdcAccountInfo = await connection.getAccountInfo(usdcAccount);
  if (!usdcAccountInfo) {
    console.log('Creating USDC token account...');
    setupIxs.push(
      createAssociatedTokenAccountInstruction(
        payerKeypair.publicKey,
        usdcAccount,
        payerKeypair.publicKey,
        USDC_MINT
      )
    );
  }
  
  // Wrap 0.015 SOL (0.01 for swap + 0.005 buffer)
  setupIxs.push(
    SystemProgram.transfer({
      fromPubkey: payerKeypair.publicKey,
      toPubkey: wsolAccount,
      lamports: 15_000_000,
    }),
    createSyncNativeInstruction(wsolAccount)
  );
  
  if (setupIxs.length > 0) {
    console.log(`\n⚙️  Executing ${setupIxs.length} setup instructions...`);
    
    let { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    let messageV0 = new TransactionMessage({
      payerKey: payerKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: setupIxs,
    }).compileToV0Message([lookupTableAccount]);
    
    let setupTx = new VersionedTransaction(messageV0);
    setupTx.sign([payerKeypair]);
    
    const setupSig = await connection.sendTransaction(setupTx);
    await connection.confirmTransaction({ signature: setupSig, blockhash, lastValidBlockHeight });
    console.log(`✅ Setup complete: ${setupSig}\n`);
  }
  
  // Build and send arbitrage transaction
  console.log('🔄 Executing arbitrage transaction...\n');
  
  const arbInstruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
      ...remainingAccounts.map(pubkey => ({ pubkey, isSigner: false, isWritable: true })),
    ],
    data: instructionData,
  });
  
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_000_000,
  });
  
  try {
    let { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    let messageV0 = new TransactionMessage({
      payerKey: payerKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [computeBudgetIx, arbInstruction],
    }).compileToV0Message([lookupTableAccount]);
    
    let arbTx = new VersionedTransaction(messageV0);
    arbTx.sign([payerKeypair]);
    
    // Simulate first
    const simulation = await connection.simulateTransaction(arbTx);
    if (simulation.value.err) {
      console.log('❌ Error executing arbitrage: Simulation failed.');
      console.log('Message:', simulation.value.err);
      console.log('Logs:', simulation.value.logs);
      
      console.log('\n📋 Error Logs:');
      if (simulation.value.logs) {
        simulation.value.logs.forEach(log => console.log(log));
      }
      process.exit(1);
    }
    
    console.log('✅ Simulation successful!\n');
    console.log('📋 Simulation Logs:');
    if (simulation.value.logs) {
      simulation.value.logs.forEach(log => console.log(log));
    }
    
    // Send the transaction
    const arbSig = await connection.sendTransaction(arbTx, { skipPreflight: true });
    await connection.confirmTransaction({ signature: arbSig, blockhash, lastValidBlockHeight });
    
    console.log(`\n✅ Arbitrage executed: ${arbSig}`);
    
    // Check final balances
    const finalWsolBalance = await connection.getTokenAccountBalance(wsolAccount);
    const finalUsdcBalance = await connection.getTokenAccountBalance(usdcAccount);
    
    console.log('\n💰 Final Balances:');
    console.log(`  WSOL: ${finalWsolBalance.value.uiAmount} SOL`);
    console.log(`  USDC: ${finalUsdcBalance.value.uiAmount} USDC`);
    
  } catch (error: any) {
    console.log('❌ Error executing arbitrage:', error.message);
    if (error.logs) {
      console.log('\n📋 Error Logs:');
      error.logs.forEach((log: string) => console.log(log));
    }
    process.exit(1);
  }
}

main().catch(console.error);
