#!/usr/bin/env ts-node
/**
 * Mainnet-Fork 2-Hop Test: SOL → PUMP → SOL
 * Route: SOL → PUMP (Raydium CLMM V2) → SOL (Pump.Fun AMM)
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
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { buildArbitrageInstructionData, DexProgram, ArbitrageRoute } from './instruction';

const PROGRAM_ID = new PublicKey('CJrTqPA9Y37bxE6VXRtjTkK8irRrEWuKh5gHSsqXJrVt');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const PUMPFUN_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const connection = new Connection('http://localhost:8899', 'confirmed');

// Token mints
const SOL_MINT = NATIVE_MINT;
const PUMP_MINT = new PublicKey('pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn');

// Raydium CLMM Pool: SOL/PUMP
const RAYDIUM_SOL_PUMP_ACCOUNTS = {
  ammConfig: new PublicKey('DrdecJVzkaRsf1TQu1g7iFncaokikVTHqpzPjenjRySY'),
  poolState: new PublicKey('45ssPkUQs1ssbeDqxD2mZrMdJYAXF7GyQyhS5xDXuWC5'),
  inputVault: new PublicKey('A5VBGEV5ghKGSNFLpSy83ePE1BMpd2hZ8BHxFafNBNf6'), // SOL vault
  outputVault: new PublicKey('48xDcrnnENiygxTXGu9KPAuew3xRkfyrfb5iU6BNFbQK'), // PUMP vault
  observationState: new PublicKey('7oVcrScfu1jVKq1DsaVZ8HtX1RZ6sa3oik3uVhowtifK'),
  tokenProgram: TOKEN_PROGRAM_ID,
  tokenProgram2022: TOKEN_2022_PROGRAM_ID,
  memoProgram: MEMO_PROGRAM_ID,
  inputVaultMint: SOL_MINT,
  outputVaultMint: PUMP_MINT,
  tickArray1: new PublicKey('GFHU8GNWeYKpLuTvfAJbeVHFiafBVZZwfCbD16NC9Y9t'),
  tickArray2: new PublicKey('DoCSVsGbeLNePLrCaDvzejLZqSQTG6nhEWtqCE4TMG17'),
  tickArray3: new PublicKey('3jwz1SpPNgom4emkV7hLRkEySwBmVx59KZ5vSCkEHdpP'),
};

// Pump.Fun AMM Pool: PUMP/SOL
const PUMPFUN_ACCOUNTS = {
  pool: new PublicKey('8uENY6hrX9Tpveq4KMeGc7CRkq9QfMr1GHc3wWCEaZDb'),
  globalConfig: new PublicKey('ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw'),
  baseMint: PUMP_MINT,
  quoteMint: SOL_MINT,
  poolBaseTokenAccount: new PublicKey('4SsP63qw77AkiR1pffKXGi7gvSTCTmKhY5pZj4iN9Rf8'),
  poolQuoteTokenAccount: new PublicKey('9Yr5RLw3gXexPYEf5R3ecH5dJWLyoaGMvoKDUF193fMg'),
  protocolFeeRecipient: new PublicKey('G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP'),
  protocolFeeRecipientTokenAccount: new PublicKey('BWXT6RUhit9FfJQM3pBmqeFLPYmuxgmyhMGC5sGr8RbA'),
  baseTokenProgram: TOKEN_2022_PROGRAM_ID,
  quoteTokenProgram: TOKEN_PROGRAM_ID,
  systemProgram: SystemProgram.programId,
  associatedTokenProgram: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
  eventAuthority: new PublicKey('GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR'),
  coinCreatorVaultAta: new PublicKey('Ei6iux5MMYG8JxCTr58goADqFTtMroL9TXJityF3fAQc'),
  coinCreatorVaultAuthority: new PublicKey('8N3GDaZ2iwN65oxVatKTLPNooAVUJTbfiVJ1ahyqwjSk'),
  globalVolumeAccumulator: new PublicKey('C2aFPdENg4A2HQsmrd5rTw5TaYBX5Ku887cWjbFKtZpw'),
  userVolumeAccumulator: new PublicKey('5GjjTL7dfMYBCDux9gdAhh4Mv5fSJDNf2eaa7EquVkFR'),
  feeConfig: new PublicKey('5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx'),
  feeProgram: new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ'),
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
    TOKEN_2022_PROGRAM_ID,
    MEMO_PROGRAM_ID,
    SystemProgram.programId,
    // Raydium CLMM accounts
    RAYDIUM_SOL_PUMP_ACCOUNTS.ammConfig,
    RAYDIUM_SOL_PUMP_ACCOUNTS.poolState,
    RAYDIUM_SOL_PUMP_ACCOUNTS.inputVault,
    RAYDIUM_SOL_PUMP_ACCOUNTS.outputVault,
    RAYDIUM_SOL_PUMP_ACCOUNTS.observationState,
    RAYDIUM_SOL_PUMP_ACCOUNTS.inputVaultMint,
    RAYDIUM_SOL_PUMP_ACCOUNTS.outputVaultMint,
    RAYDIUM_SOL_PUMP_ACCOUNTS.tickArray1,
    RAYDIUM_SOL_PUMP_ACCOUNTS.tickArray2,
    RAYDIUM_SOL_PUMP_ACCOUNTS.tickArray3,
    // Pump.Fun AMM accounts
    PUMPFUN_ACCOUNTS.pool,
    PUMPFUN_ACCOUNTS.globalConfig,
    PUMPFUN_ACCOUNTS.baseMint,
    PUMPFUN_ACCOUNTS.quoteMint,
    PUMPFUN_ACCOUNTS.poolBaseTokenAccount,
    PUMPFUN_ACCOUNTS.poolQuoteTokenAccount,
    PUMPFUN_ACCOUNTS.protocolFeeRecipient,
    PUMPFUN_ACCOUNTS.protocolFeeRecipientTokenAccount,
    PUMPFUN_ACCOUNTS.associatedTokenProgram,
    PUMPFUN_ACCOUNTS.eventAuthority,
    PUMPFUN_ACCOUNTS.coinCreatorVaultAta,
    PUMPFUN_ACCOUNTS.coinCreatorVaultAuthority,
    PUMPFUN_ACCOUNTS.globalVolumeAccumulator,
    PUMPFUN_ACCOUNTS.userVolumeAccumulator,
    PUMPFUN_ACCOUNTS.feeConfig,
    PUMPFUN_ACCOUNTS.feeProgram,
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
    const batch = addressesToAdd.slice(i, i + BATCH_SIZE);
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
    sig = await connection.sendTransaction(transaction);
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
    console.log(`✅ Added batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(addressesToAdd.length / BATCH_SIZE)}`);
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n⏳ Waiting for ALT to be active...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return lookupTableAddress;
}

async function main() {
  console.log('🚀 Starting 2-Hop Arbitrage Test: SOL → PUMP → SOL\n');
  
  // Load payer
  const payerKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(require('fs').readFileSync('/home/ubuntu/.config/solana/id.json', 'utf-8')))
  );
  
  console.log(`Payer: ${payerKeypair.publicKey.toBase58()}`);
  console.log(`Program: ${PROGRAM_ID.toBase58()}\n`);
  
  // Check SOL balance
  const balance = await connection.getBalance(payerKeypair.publicKey);
  console.log(`SOL Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);
  
  // Create or get wrapped SOL account
  const wsolAccount = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    payerKeypair.publicKey
  );
  
  // Create PUMP token account
  const pumpAccount = getAssociatedTokenAddressSync(
    PUMP_MINT,
    payerKeypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  console.log(`Wrapped SOL Account: ${wsolAccount.toBase58()}`);
  console.log(`PUMP Token Account: ${pumpAccount.toBase58()}\n`);
  
  // Create ALT
  const altAddress = await createALT(payerKeypair);
  const lookupTableAccount = (await connection.getAddressLookupTable(altAddress)).value;
  if (!lookupTableAccount) {
    throw new Error('Failed to fetch lookup table');
  }
  
  console.log('\n📝 Building arbitrage instruction...\n');
  
  // Derive PDAs for Pump.Fun buy instruction
  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_volume_accumulator')],
    PUMPFUN_AMM_PROGRAM_ID
  );
  
  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_volume_accumulator'), payerKeypair.publicKey.toBuffer()],
    PUMPFUN_AMM_PROGRAM_ID
  );
  
  // Define the arbitrage route
  const route: ArbitrageRoute = {
    hops: [
      {
        dexProgram: DexProgram.PumpAmm,
        isSwapV2: true,  // BUY operation: SOL → PUMP (needs 24 accounts)
        poolIndex: 1, // Start after user authority account
        inputMint: SOL_MINT,
        outputMint: PUMP_MINT,
        minimumOutput: BigInt(267_000), // 0.267 PUMP minimum (6 decimals)
      },
      {
        dexProgram: DexProgram.RaydiumClmm,
        isSwapV2: true,
        poolIndex: 25, // After Pump.Fun accounts (24 accounts)
        inputMint: PUMP_MINT,
        outputMint: SOL_MINT,
        minimumOutput: BigInt(1_000_000), // 0.001 SOL minimum
      },
    ],
    initialAmount: BigInt(100_000_000), // 0.1 SOL
    minimumFinalOutput: BigInt(1_000_000), // 0.001 SOL (loose for testing)
  };
  
  console.log('Route Configuration:');
  console.log(`  Hop 1: SOL → PUMP (Pump.Fun AMM - BUY)`);
  console.log(`    Input: 0.1 SOL (100,000,000 lamports)`);
  console.log(`    Min output: 0.267 PUMP`);
  console.log(`  Hop 2: PUMP → SOL (Raydium CLMM V2)`);
  console.log(`    Min output: 0.001 SOL\n`);
  
  // Build instruction data
  const instructionData = buildArbitrageInstructionData(route);
  
  // Build account list for all hops
  const remainingAccounts: PublicKey[] = [
    // Hop 1: Pump.Fun AMM buy_exact_quote_in instruction (23 accounts + 1 program) - SOL → PUMP
    // Based on IDL: pool, user, global_config, base_mint, quote_mint, 
    // user_base_token_account, user_quote_token_account, pool_base_token_account, pool_quote_token_account,
    // protocol_fee_recipient, protocol_fee_recipient_token_account, base_token_program, quote_token_program,
    // system_program, associated_token_program, event_authority, program, 
    // coin_creator_vault_ata, coin_creator_vault_authority, global_volume_accumulator,
    // user_volume_accumulator, fee_config, fee_program
    PUMPFUN_ACCOUNTS.pool,                                   // pool
    payerKeypair.publicKey,                                  // user (signer)
    PUMPFUN_ACCOUNTS.globalConfig,                           // global_config
    PUMPFUN_ACCOUNTS.baseMint,                               // base_mint (PUMP)
    PUMPFUN_ACCOUNTS.quoteMint,                              // quote_mint (SOL)
    
    pumpAccount,                                             // user_base_token_account (OUTPUT when buying)
    wsolAccount,                                             // user_quote_token_account (INPUT when buying)
    PUMPFUN_ACCOUNTS.poolBaseTokenAccount,                   // pool_base_token_account
    PUMPFUN_ACCOUNTS.poolQuoteTokenAccount,                  // pool_quote_token_account
    PUMPFUN_ACCOUNTS.protocolFeeRecipient,                   // protocol_fee_recipient
    
    PUMPFUN_ACCOUNTS.protocolFeeRecipientTokenAccount,       // protocol_fee_recipient_token_account
    TOKEN_2022_PROGRAM_ID,                                   // base_token_program
    TOKEN_PROGRAM_ID,                                        // quote_token_program
    SystemProgram.programId,                                 // system_program
    PUMPFUN_ACCOUNTS.associatedTokenProgram,                 // associated_token_program
    
    PUMPFUN_ACCOUNTS.eventAuthority,                         // event_authority
    PUMPFUN_AMM_PROGRAM_ID,                                  // program (in accounts list per IDL)
    PUMPFUN_ACCOUNTS.coinCreatorVaultAta,                    // coin_creator_vault_ata
    PUMPFUN_ACCOUNTS.coinCreatorVaultAuthority,              // coin_creator_vault_authority
    globalVolumeAccumulator,                                 // global_volume_accumulator (PDA)
    
    userVolumeAccumulator,                                   // user_volume_accumulator (PDA)
    PUMPFUN_ACCOUNTS.feeConfig,                              // fee_config
    PUMPFUN_ACCOUNTS.feeProgram,                             // fee_program
    
    // Program ID for CPI
    PUMPFUN_AMM_PROGRAM_ID,
    
    // Hop 2: Raydium CLMM V2 (17 accounts) - PUMP → SOL
    // [0-3] Core accounts
    payerKeypair.publicKey,                         // payer/authority
    RAYDIUM_SOL_PUMP_ACCOUNTS.ammConfig,            // amm_config
    RAYDIUM_SOL_PUMP_ACCOUNTS.poolState,            // pool_state
    pumpAccount,                                     // input_token_account (PUMP)
    
    wsolAccount,                                     // output_token_account (SOL)
    RAYDIUM_SOL_PUMP_ACCOUNTS.outputVault,          // input_vault (PUMP vault - Token-2022)
    RAYDIUM_SOL_PUMP_ACCOUNTS.inputVault,           // output_vault (SOL vault - regular Token)
    RAYDIUM_SOL_PUMP_ACCOUNTS.observationState,     // observation_state
    
    // [8-13] Token programs and mints (FIXED ORDER per IDL)
    TOKEN_PROGRAM_ID,                                // token_program (index 8 - always regular token program)
    TOKEN_2022_PROGRAM_ID,                           // token_program_2022 (index 9 - always token-2022 program)
    MEMO_PROGRAM_ID,                                 // memo_program
    RAYDIUM_SOL_PUMP_ACCOUNTS.outputVaultMint,      // input_vault_mint (PUMP - Token-2022)
    RAYDIUM_SOL_PUMP_ACCOUNTS.inputVaultMint,       // output_vault_mint (SOL - regular Token)
    
    // [13-15] Tick arrays
    RAYDIUM_SOL_PUMP_ACCOUNTS.tickArray1,
    RAYDIUM_SOL_PUMP_ACCOUNTS.tickArray2,
    RAYDIUM_SOL_PUMP_ACCOUNTS.tickArray3,
    
    // [16] Program ID
    RAYDIUM_CLMM_PROGRAM_ID,
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
  
  // Create PUMP account if needed
  const pumpAccountInfo = await connection.getAccountInfo(pumpAccount);
  if (!pumpAccountInfo) {
    console.log('Creating PUMP token account...');
    setupIxs.push(
      createAssociatedTokenAccountInstruction(
        payerKeypair.publicKey,
        pumpAccount,
        payerKeypair.publicKey,
        PUMP_MINT,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }
  
  // Wrap 0.105 SOL (0.1 for swap + 0.005 buffer)
  setupIxs.push(
    SystemProgram.transfer({
      fromPubkey: payerKeypair.publicKey,
      toPubkey: wsolAccount,
      lamports: 105_000_000,
    }),
    createSyncNativeInstruction(wsolAccount)
  );
  
  if (setupIxs.length > 0) {
    console.log(`\n⚙️  Executing ${setupIxs.length} setup instructions...`);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const setupMessage = new TransactionMessage({
      payerKey: payerKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: setupIxs,
    }).compileToV0Message([lookupTableAccount]);
    
    const setupTx = new VersionedTransaction(setupMessage);
    setupTx.sign([payerKeypair]);
    
    const setupSig = await connection.sendTransaction(setupTx, { skipPreflight: false });
    await connection.confirmTransaction({ signature: setupSig, blockhash, lastValidBlockHeight });
    console.log(`✅ Setup complete: ${setupSig}\n`);
  }
  
  // Build arbitrage instruction
  const arbInstruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
      ...remainingAccounts.map(pubkey => ({ pubkey, isSigner: false, isWritable: true })),
    ],
    data: instructionData,
  });
  
  // Add compute budget
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
  
  console.log('🔄 Executing arbitrage transaction...\n');
  
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const arbMessage = new TransactionMessage({
    payerKey: payerKeypair.publicKey,
    recentBlockhash: blockhash,
    instructions: [computeBudgetIx, arbInstruction],
  }).compileToV0Message([lookupTableAccount]);
  
  const arbTx = new VersionedTransaction(arbMessage);
  arbTx.sign([payerKeypair]);
  
  try {
    const arbSig = await connection.sendTransaction(arbTx, { 
      skipPreflight: false,
      maxRetries: 3,
    });
    
    console.log(`Transaction sent: ${arbSig}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${arbSig}?cluster=custom&customUrl=http://localhost:8899\n`);
    
    const confirmation = await connection.confirmTransaction({ 
      signature: arbSig, 
      blockhash, 
      lastValidBlockHeight 
    }, 'confirmed');
    
    if (confirmation.value.err) {
      console.error('❌ Transaction failed:', confirmation.value.err);
      
      // Get transaction details
      const tx = await connection.getTransaction(arbSig, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
      
      if (tx?.meta?.logMessages) {
        console.log('\n📋 Transaction Logs:');
        tx.meta.logMessages.forEach(log => console.log(log));
      }
    } else {
      console.log('✅ Arbitrage transaction confirmed!\n');
      
      // Get final balances
      const wsolBalance = await connection.getTokenAccountBalance(wsolAccount);
      console.log(`Final Wrapped SOL Balance: ${wsolBalance.value.uiAmountString} SOL`);
    }
  } catch (error: any) {
    console.error('❌ Error executing arbitrage:', error.message);
    if (error.logs) {
      console.log('\n📋 Error Logs:');
      error.logs.forEach((log: string) => console.log(log));
    }
  }
}

main().catch(console.error);
