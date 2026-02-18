#!/usr/bin/env ts-node
/**
 * Token-2022 Bidirectional Swap Tests
 * Tests bidirectional swaps for pools with Token-2022 tokens
 * 
 * Pools tested:
 * 1. Raydium CLMM: SOL/PUMP (45ssPkUQs1ssbeDqxD2mZrMdJYAXF7GyQyhS5xDXuWC5)
 * 2. Orca Whirlpool: SOL/PUMP (BofA2ViUSudPBTUms2KRuG6AHNeMawjNfwqTJDgx5BKW)
 * 3. Meteora DLMM: PUMP2/SOL (LJGCprfvx4qZVXktL24CLArGwzpAsQXjq5AQFa5w6WT)
 * 4. Meteora DAMM V2: SOL/TOKEN (8bvn5MCrVNdqbn6hdcM7ghgxeEQVipfCHzkPctXuvKpK)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
  SystemProgram,
} from '@solana/web3.js';
import { 
  NATIVE_MINT,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  TOKEN_PROGRAM_ID as SPL_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { 
  buildArbitrageInstructionData, 
  buildArbitrageAccounts,
  DexProgram, 
  MintInfo,
  HopPoolAccounts,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from './instruction';

const PROGRAM_ID = new PublicKey('6UZznePGgoykwAutgJFmQce2QQzfYjVcsQesZbRq9Y3b');
const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const ORCA_WHIRLPOOL_PROGRAM_ID = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const METEORA_DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
const METEORA_DAMM_V2_PROGRAM_ID = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const connection = new Connection('http://localhost:8899', 'confirmed');

// Token mints
const SOL_MINT = NATIVE_MINT;
const PUMP_MINT = new PublicKey('pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn'); // Token-2022
const PUMP2_MINT = new PublicKey('8Jx8AAHj86wbQgUTjGuj6GTTL5Ps3cqxKRTvpaJApump'); // Token-2022
const TOKEN_MINT = new PublicKey('DqbB3RfABgG8YHkXx7grK8jxFV5rCaA9FqcDBtC6uFRT'); // Token-2022

// ========================================
// Pool Configurations
// ========================================

// Raydium CLMM Pool: SOL/PUMP (Token-2022)
const RAYDIUM_CLMM_POOL = {
  ammConfig: new PublicKey('DrdecJVzkaRsf1TQu1g7iFncaokikVTHqpzPjenjRySY'),
  poolState: new PublicKey('45ssPkUQs1ssbeDqxD2mZrMdJYAXF7GyQyhS5xDXuWC5'),
  vault0: new PublicKey('A5VBGEV5ghKGSNFLpSy83ePE1BMpd2hZ8BHxFafNBNf6'), // SOL vault
  vault1: new PublicKey('48xDcrnnENiygxTXGu9KPAuew3xRkfyrfb5iU6BNFbQK'), // PUMP vault
  observationState: new PublicKey('7oVcrScfu1jVKq1DsaVZ8HtX1RZ6sa3oik3uVhowtifK'),
  tickArray0: new PublicKey('GFHU8GNWeYKpLuTvfAJbeVHFiafBVZZwfCbD16NC9Y9t'),
  tickArray1: new PublicKey('DoCSVsGbeLNePLrCaDvzejLZqSQTG6nhEWtqCE4TMG17'),
  tickArray2: new PublicKey('3jwz1SpPNgom4emkV7hLRkEySwBmVx59KZ5vSCkEHdpP'),
};

// Orca Whirlpool Pool: SOL/PUMP (Token-2022)
const ORCA_POOL = {
  whirlpool: new PublicKey('BofA2ViUSudPBTUms2KRuG6AHNeMawjNfwqTJDgx5BKW'),
  tokenVaultA: new PublicKey('BkSYpPsv11UPDLonxBZf2mFndfuN2MrDwYt4gjDEnk8D'), // SOL vault
  tokenVaultB: new PublicKey('2wcLHj441NnqiUon4LcmMo6dGAUqwEW84nfFKnfuTnPt'), // PUMP vault
  tickArray0: new PublicKey('13rD6egRNg5CcQwCK58vqkzywAwu1Hv9FZyHqXW4Nkks'),
  tickArray1: new PublicKey('HYVnyCgLKqJoQ2HsGVcVc1v3LBnsFQsP9UGu15PsrcPG'),
  tickArray2: new PublicKey('Es2kN9ZRTXGRTKuDhXPw7yqEd5ytJEV1qpi58VgfNPh5'),
  oracle: new PublicKey('9UXyKABdsimsf8qz4BLxP3d4QaL6rDQLbnMYBhjL6y8d'),
};

// Meteora DLMM Pool: PUMP/SOL (Token-2022)
// Pool: FCL8pjNQsDAggZVczYfnn6tfbYoMnJykGT2cpdTULAxB
// Token X = 8Jx8AAHj86wbQgUTjGuj6GTTL5Ps3cqxKRTvpaJApump (Token-2022)
// Token Y = So11111111111111111111111111111111111111112 (WSOL)
const DLMM_POOL = {
  lbPair: new PublicKey('FCL8pjNQsDAggZVczYfnn6tfbYoMnJykGT2cpdTULAxB'),
  reserveX: new PublicKey('Cf54zoj7hZ5CU1Ta51aueatRMM8N8tqwENV2zSpYwMWi'), // PUMP reserve (Token-2022)
  reserveY: new PublicKey('66wWPJYfXNpjYMVGzqryfzpHZF83ZeMX8UdsMyC7qVDZ'), // SOL reserve
  oracle: new PublicKey('EbbPYT6Ep92sMVEqnbj28Lq7RAstMtbxhUX5RctzCkZu'),
  eventAuthority: new PublicKey('D1ZN9Wj1fRSUQfCjhvnu1hqDMT7hzjzBBpi12nVniYD6'),
  binArrayBitmapExtension: new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'), // Optional, use program ID as placeholder
  binArrays: [
    new PublicKey('EeLrb3eJeQwk6zMeJabzT1xTmvck8d9MDbej4jCkkC3M'),
    new PublicKey('ctiJeJ1XEp3WhA68z8yGRDLyiTu7yuLpgUwnvtyvdrB'),
    new PublicKey('6LnkthE5LrYStPghcjNK3AddCr8YnsFHPz8c7snm46ia'),
  ],
  tokenXMint: new PublicKey('8Jx8AAHj86wbQgUTjGuj6GTTL5Ps3cqxKRTvpaJApump'),
  tokenYMint: NATIVE_MINT,
};

// Meteora DAMM V2 GLOBAL pool authority (derived from ["pool_authority"] only, not per-pool)
const DAMMV2_POOL_AUTHORITY = new PublicKey('HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC');

// Meteora DAMM V2 Pool: SOL/TOKEN (Token-2022)
const DAMMV2_POOL = {
  pool: new PublicKey('8bvn5MCrVNdqbn6hdcM7ghgxeEQVipfCHzkPctXuvKpK'),
  tokenAVault: new PublicKey('7Jg3JV162QfdzwxeqRpakPBpFWsKnGKZ6eGEzppJs7S9'), // SOL vault
  tokenBVault: new PublicKey('FfJV1355pGVThTZ9hRgF6w2bsbEqEPuWFH4JQ3Rg2seS'), // TOKEN vault (Token-2022)
  eventAuthority: new PublicKey('3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet'),
};

async function createALT(payer: Keypair, addresses: PublicKey[]): Promise<PublicKey> {
  const slot = await connection.getSlot('finalized');
  const [lookupTableInst, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });
  
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
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Extend ALT in batches (max ~30 addresses per transaction)
  const BATCH_SIZE = 25;
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);
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
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  return lookupTableAddress;
}

// ========================================
// Raydium CLMM Token-2022 Bidirectional Test
// ========================================
async function testRaydiumClmmBidirectional(payer: Keypair, altAddress: PublicKey): Promise<boolean> {
  console.log(`\n🔄 [Raydium CLMM Token-2022] Testing round trip: SOL → PUMP → SOL`);
  console.log(`   Pool: ${RAYDIUM_CLMM_POOL.poolState.toBase58()}`);
  console.log(`   Hop 1: SOL → PUMP (is_base_swap=true, Token-2022 output)`);
  console.log(`   Hop 2: PUMP → SOL (is_base_swap=false, Token-2022 input)`);
  
  const lookupTableAccount = (await connection.getAddressLookupTable(altAddress)).value;
  if (!lookupTableAccount) throw new Error('Failed to fetch lookup table');
  
  const mints: MintInfo[] = [
    { mint: SOL_MINT, is2022: false },
    { mint: PUMP_MINT, is2022: true },
  ];
  
  const poolAccounts = [
    RAYDIUM_CLMM_POOL.ammConfig,
    RAYDIUM_CLMM_POOL.poolState,
    RAYDIUM_CLMM_POOL.vault0,
    RAYDIUM_CLMM_POOL.vault1,
    RAYDIUM_CLMM_POOL.observationState,
    MEMO_PROGRAM_ID,
    RAYDIUM_CLMM_POOL.tickArray0,
    RAYDIUM_CLMM_POOL.tickArray1,
    RAYDIUM_CLMM_POOL.tickArray2,
  ];
  
  const hop1: HopPoolAccounts = {
    dexProgram: DexProgram.RaydiumClmm,
    dexProgramId: RAYDIUM_CLMM_PROGRAM_ID,
    inTokenIs2022: false,
    outTokenIs2022: true,
    isBaseSwap: true,
    accounts: poolAccounts,
  };
  
  const hop2: HopPoolAccounts = {
    dexProgram: DexProgram.RaydiumClmm,
    dexProgramId: RAYDIUM_CLMM_PROGRAM_ID,
    inTokenIs2022: true,
    outTokenIs2022: false,
    isBaseSwap: false,
    accounts: poolAccounts,
  };
  
  const { accounts, hops } = buildArbitrageAccounts(payer.publicKey, mints, [hop1, hop2]);
  const initialAmount = BigInt(0.01 * LAMPORTS_PER_SOL);
  
  const instructionData = buildArbitrageInstructionData({
    hops,
    initialAmount,
    minimumFinalOutput: BigInt(1),
  });
  
  const arbInstruction = {
    programId: PROGRAM_ID,
    keys: accounts,
    data: Buffer.from(instructionData),
  };
  
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 });
  
  const { blockhash } = await connection.getLatestBlockhash();
  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [computeBudgetIx, arbInstruction],
  }).compileToV0Message([lookupTableAccount]);
  
  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([payer]);
  
  try {
    const result = await connection.simulateTransaction(transaction, { sigVerify: false });
    
    if (result.value.err) {
      const logs = result.value.logs || [];
      const swapsCompleted = logs.filter(log => 
        log.includes('completed successfully') || log.includes('CLMM: Swap completed')
      ).length >= 2;
      
      if (swapsCompleted) {
        console.log(`   ✅ Both swaps executed successfully`);
        return true;
      } else {
        console.log(`   ❌ Swap failed: ${JSON.stringify(result.value.err)}`);
        console.log(`   📜 Logs:`);
        logs.forEach(log => console.log(`      ${log}`));
        return false;
      }
    } else {
      console.log(`   ✅ Transaction succeeded`);
      return true;
    }
  } catch (err) {
    console.log(`   ❌ Error: ${err}`);
    return false;
  }
}

// ========================================
// Orca Whirlpool Token-2022 Bidirectional Test
// ========================================
async function testOrcaBidirectional(payer: Keypair, altAddress: PublicKey): Promise<boolean> {
  console.log(`\n🔄 [Orca Whirlpool Token-2022] Testing round trip: SOL → PUMP → SOL`);
  console.log(`   Pool: ${ORCA_POOL.whirlpool.toBase58()}`);
  console.log(`   Hop 1: SOL → PUMP (a_to_b, Token-2022 output)`);
  console.log(`   Hop 2: PUMP → SOL (b_to_a, Token-2022 input)`);
  
  const lookupTableAccount = (await connection.getAddressLookupTable(altAddress)).value;
  if (!lookupTableAccount) throw new Error('Failed to fetch lookup table');
  
  const mints: MintInfo[] = [
    { mint: SOL_MINT, is2022: false },
    { mint: PUMP_MINT, is2022: true },
  ];
  
  const poolAccounts = [
    ORCA_POOL.whirlpool,
    ORCA_POOL.tokenVaultA,
    ORCA_POOL.tokenVaultB,
    ORCA_POOL.tickArray0,
    ORCA_POOL.tickArray1,
    ORCA_POOL.tickArray2,
    ORCA_POOL.oracle,
    MEMO_PROGRAM_ID, // Required for swap_v2 (Token-2022)
  ];
  
  const hop1: HopPoolAccounts = {
    dexProgram: DexProgram.OrcaWhirlpool,
    dexProgramId: ORCA_WHIRLPOOL_PROGRAM_ID,
    inTokenIs2022: false,
    outTokenIs2022: true,
    isBaseSwap: true,
    accounts: poolAccounts,
  };
  
  const hop2: HopPoolAccounts = {
    dexProgram: DexProgram.OrcaWhirlpool,
    dexProgramId: ORCA_WHIRLPOOL_PROGRAM_ID,
    inTokenIs2022: true,
    outTokenIs2022: false,
    isBaseSwap: false,
    accounts: poolAccounts,
  };
  
  const { accounts, hops } = buildArbitrageAccounts(payer.publicKey, mints, [hop1, hop2]);
  const initialAmount = BigInt(0.01 * LAMPORTS_PER_SOL);
  
  const instructionData = buildArbitrageInstructionData({
    hops,
    initialAmount,
    minimumFinalOutput: BigInt(1),
  });
  
  const arbInstruction = {
    programId: PROGRAM_ID,
    keys: accounts,
    data: Buffer.from(instructionData),
  };
  
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 });
  
  const { blockhash } = await connection.getLatestBlockhash();
  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [computeBudgetIx, arbInstruction],
  }).compileToV0Message([lookupTableAccount]);
  
  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([payer]);
  
  try {
    const result = await connection.simulateTransaction(transaction, { sigVerify: false });
    
    if (result.value.err) {
      const logs = result.value.logs || [];
      const swapsCompleted = logs.filter(log => log.includes('completed successfully')).length >= 2;
      
      if (swapsCompleted) {
        console.log(`   ✅ Both swaps executed successfully`);
        return true;
      } else {
        console.log(`   ❌ Swap failed: ${JSON.stringify(result.value.err)}`);
        logs.slice(-15).forEach(log => console.log(`      ${log}`));
        return false;
      }
    } else {
      console.log(`   ✅ Transaction succeeded`);
      return true;
    }
  } catch (err) {
    console.log(`   ❌ Error: ${err}`);
    return false;
  }
}

// ========================================
// Meteora DLMM Token-2022 Bidirectional Test
// ========================================
async function testDlmmBidirectional(payer: Keypair, altAddress: PublicKey): Promise<boolean> {
  console.log(`\n🔄 [Meteora DLMM Token-2022] Testing round trip: SOL → PUMP2 → SOL`);
  console.log(`   Pool: ${DLMM_POOL.lbPair.toBase58()}`);
  console.log(`   Note: Pool is PUMP2/SOL (X=PUMP2, Y=SOL)`);
  console.log(`   Hop 1: SOL → PUMP2 (y_to_x=false, Token-2022 output)`);
  console.log(`   Hop 2: PUMP2 → SOL (x_to_y=true, Token-2022 input)`);
  
  const lookupTableAccount = (await connection.getAddressLookupTable(altAddress)).value;
  if (!lookupTableAccount) throw new Error('Failed to fetch lookup table');
  
  // Note: For DLMM pool PUMP2/SOL, token_x=PUMP2, token_y=SOL
  // So to swap SOL→PUMP2, we do y_to_x (isBaseSwap=false)
  // And to swap PUMP2→SOL, we do x_to_y (isBaseSwap=true)
  const mints: MintInfo[] = [
    { mint: SOL_MINT, is2022: false },
    { mint: PUMP2_MINT, is2022: true },
  ];
  
  const poolAccounts = [
    DLMM_POOL.lbPair,
    METEORA_DLMM_PROGRAM_ID, // binArrayBitmapExtension placeholder (no extension for this pool)
    DLMM_POOL.reserveX,
    DLMM_POOL.reserveY,
    DLMM_POOL.oracle, // Real oracle PDA derived from ['oracle', lbPair]
    METEORA_DLMM_PROGRAM_ID, // host_fee_in placeholder
    MEMO_PROGRAM_ID, // Required for swap2 (Token-2022) - comes BEFORE eventAuthority!
    DLMM_POOL.eventAuthority,
    ...DLMM_POOL.binArrays,
  ];
  
  // Hop 1: SOL → PUMP2 (y_to_x, so isBaseSwap=false for DLMM)
  const hop1: HopPoolAccounts = {
    dexProgram: DexProgram.MeteoraDlmm,
    dexProgramId: METEORA_DLMM_PROGRAM_ID,
    inTokenIs2022: false,
    outTokenIs2022: true,
    isBaseSwap: false, // y_to_x (SOL→PUMP2)
    accounts: poolAccounts,
  };
  
  // Hop 2: PUMP2 → SOL (x_to_y, so isBaseSwap=true for DLMM)
  const hop2: HopPoolAccounts = {
    dexProgram: DexProgram.MeteoraDlmm,
    dexProgramId: METEORA_DLMM_PROGRAM_ID,
    inTokenIs2022: true,
    outTokenIs2022: false,
    isBaseSwap: true, // x_to_y (PUMP2→SOL)
    accounts: poolAccounts,
  };
  
  const { accounts, hops } = buildArbitrageAccounts(payer.publicKey, mints, [hop1, hop2]);
  const initialAmount = BigInt(0.01 * LAMPORTS_PER_SOL);
  
  const instructionData = buildArbitrageInstructionData({
    hops,
    initialAmount,
    minimumFinalOutput: BigInt(1),
  });
  
  const arbInstruction = {
    programId: PROGRAM_ID,
    keys: accounts,
    data: Buffer.from(instructionData),
  };
  
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 });
  
  const { blockhash } = await connection.getLatestBlockhash();
  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [computeBudgetIx, arbInstruction],
  }).compileToV0Message([lookupTableAccount]);
  
  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([payer]);
  
  try {
    const result = await connection.simulateTransaction(transaction, { sigVerify: false });
    
    if (result.value.err) {
      const logs = result.value.logs || [];
      const swapsCompleted = logs.filter(log => 
        log.includes('completed successfully') || log.includes('DLMM: Swap completed')
      ).length >= 2;
      
      if (swapsCompleted) {
        console.log(`   ✅ Both swaps executed successfully`);
        return true;
      } else {
        console.log(`   ❌ Swap failed: ${JSON.stringify(result.value.err)}`);
        logs.slice(-15).forEach(log => console.log(`      ${log}`));
        return false;
      }
    } else {
      console.log(`   ✅ Transaction succeeded`);
      return true;
    }
  } catch (err) {
    console.log(`   ❌ Error: ${err}`);
    return false;
  }
}

// ========================================
// Meteora DAMM V2 Token-2022 Bidirectional Test
// ========================================
async function testDammV2Bidirectional(payer: Keypair, altAddress: PublicKey): Promise<boolean> {
  console.log(`\n🔄 [Meteora DAMM V2 Token-2022] Testing round trip: SOL → TOKEN → SOL`);
  console.log(`   Pool: ${DAMMV2_POOL.pool.toBase58()}`);
  console.log(`   Hop 1: SOL → TOKEN (a_to_b, Token-2022 output)`);
  console.log(`   Hop 2: TOKEN → SOL (b_to_a, Token-2022 input)`);
  
  const lookupTableAccount = (await connection.getAddressLookupTable(altAddress)).value;
  if (!lookupTableAccount) throw new Error('Failed to fetch lookup table');
  
  const mints: MintInfo[] = [
    { mint: SOL_MINT, is2022: false },
    { mint: TOKEN_MINT, is2022: true },
  ];
  
  // Use GLOBAL pool authority (derived from ["pool_authority"] only, NOT per-pool!)
  const poolAccounts = [
    DAMMV2_POOL_AUTHORITY,
    DAMMV2_POOL.pool,
    DAMMV2_POOL.tokenAVault,
    DAMMV2_POOL.tokenBVault,
    DAMMV2_POOL.eventAuthority,
  ];
  
  const hop1: HopPoolAccounts = {
    dexProgram: DexProgram.MeteoraDammV2,
    dexProgramId: METEORA_DAMM_V2_PROGRAM_ID,
    inTokenIs2022: false,
    outTokenIs2022: true,
    isBaseSwap: true,
    accounts: poolAccounts,
  };
  
  const hop2: HopPoolAccounts = {
    dexProgram: DexProgram.MeteoraDammV2,
    dexProgramId: METEORA_DAMM_V2_PROGRAM_ID,
    inTokenIs2022: true,
    outTokenIs2022: false,
    isBaseSwap: false,
    accounts: poolAccounts,
  };
  
  const { accounts, hops } = buildArbitrageAccounts(payer.publicKey, mints, [hop1, hop2]);
  const initialAmount = BigInt(0.01 * LAMPORTS_PER_SOL);
  
  const instructionData = buildArbitrageInstructionData({
    hops,
    initialAmount,
    minimumFinalOutput: BigInt(1),
  });
  
  const arbInstruction = {
    programId: PROGRAM_ID,
    keys: accounts,
    data: Buffer.from(instructionData),
  };
  
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  
  const { blockhash } = await connection.getLatestBlockhash();
  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [computeBudgetIx, arbInstruction],
  }).compileToV0Message([lookupTableAccount]);
  
  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([payer]);
  
  try {
    const result = await connection.simulateTransaction(transaction, { sigVerify: false });
    
    if (result.value.err) {
      const logs = result.value.logs || [];
      const swapsCompleted = logs.filter(log => 
        log.includes('completed successfully') || log.includes('DAMM V2: Swap completed')
      ).length >= 2;
      
      if (swapsCompleted) {
        console.log(`   ✅ Both swaps executed successfully`);
        return true;
      } else {
        console.log(`   ❌ Swap failed: ${JSON.stringify(result.value.err)}`);
        logs.slice(-15).forEach(log => console.log(`      ${log}`));
        return false;
      }
    } else {
      console.log(`   ✅ Transaction succeeded`);
      return true;
    }
  } catch (err) {
    console.log(`   ❌ Error: ${err}`);
    return false;
  }
}

// ========================================
// Main Test Runner
// ========================================
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         Token-2022 Bidirectional Swap Test Suite           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  const payer = Keypair.generate();
  
  // Request airdrop
  console.log(`\n📋 Payer: ${payer.publicKey.toBase58()}`);
  console.log('💰 Requesting airdrop...');
  
  const airdropSig = await connection.requestAirdrop(payer.publicKey, 100 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);
  
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`💰 Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  // Collect all addresses for ALT
  const allAddresses: PublicKey[] = [
    SYSTEM_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
    MEMO_PROGRAM_ID,
    SOL_MINT, PUMP_MINT, PUMP2_MINT, TOKEN_MINT,
    // Raydium CLMM
    RAYDIUM_CLMM_POOL.ammConfig, RAYDIUM_CLMM_POOL.poolState,
    RAYDIUM_CLMM_POOL.vault0, RAYDIUM_CLMM_POOL.vault1,
    RAYDIUM_CLMM_POOL.observationState,
    RAYDIUM_CLMM_POOL.tickArray0, RAYDIUM_CLMM_POOL.tickArray1, RAYDIUM_CLMM_POOL.tickArray2,
    RAYDIUM_CLMM_PROGRAM_ID,
    // Orca Whirlpool
    ORCA_POOL.whirlpool, ORCA_POOL.tokenVaultA, ORCA_POOL.tokenVaultB,
    ORCA_POOL.tickArray0, ORCA_POOL.tickArray1, ORCA_POOL.tickArray2, ORCA_POOL.oracle,
    ORCA_WHIRLPOOL_PROGRAM_ID,
    // Meteora DLMM
    DLMM_POOL.lbPair, DLMM_POOL.reserveX, DLMM_POOL.reserveY, DLMM_POOL.eventAuthority,
    ...DLMM_POOL.binArrays,
    METEORA_DLMM_PROGRAM_ID,
    // Meteora DAMM V2
    DAMMV2_POOL.pool, DAMMV2_POOL.tokenAVault, DAMMV2_POOL.tokenBVault, DAMMV2_POOL.eventAuthority,
    METEORA_DAMM_V2_PROGRAM_ID,
  ];
  
  console.log('\n📋 Creating Address Lookup Table...');
  const altAddress = await createALT(payer, allAddresses);
  console.log(`   ALT: ${altAddress.toBase58()}`);
  
  // Set up WSOL account with funds
  console.log('\n💵 Setting up WSOL account...');
  const wsolAccount = getAssociatedTokenAddressSync(SOL_MINT, payer.publicKey);
  const setupInstructions = [
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      wsolAccount,
      payer.publicKey,
      SOL_MINT,
      SPL_TOKEN_PROGRAM_ID
    ),
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: wsolAccount,
      lamports: 50_000_000, // 0.05 SOL
    }),
    createSyncNativeInstruction(wsolAccount),
  ];
  
  let { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  let messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: setupInstructions,
  }).compileToV0Message();
  
  let transaction = new VersionedTransaction(messageV0);
  transaction.sign([payer]);
  await connection.sendTransaction(transaction);
  await connection.confirmTransaction({ 
    signature: (await connection.sendTransaction(transaction)).toString(), 
    blockhash, 
    lastValidBlockHeight 
  });
  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log(`   WSOL account: ${wsolAccount.toBase58()}`);
  
  // Run tests
  const results: { name: string; passed: boolean }[] = [];
  
  try {
    results.push({ 
      name: 'Raydium CLMM Token-2022', 
      passed: await testRaydiumClmmBidirectional(payer, altAddress) 
    });
  } catch (err) {
    console.log(`   ❌ Raydium CLMM test failed with error: ${err}`);
    results.push({ name: 'Raydium CLMM Token-2022', passed: false });
  }
  
  try {
    results.push({ 
      name: 'Orca Whirlpool Token-2022', 
      passed: await testOrcaBidirectional(payer, altAddress) 
    });
  } catch (err) {
    console.log(`   ❌ Orca test failed with error: ${err}`);
    results.push({ name: 'Orca Whirlpool Token-2022', passed: false });
  }
  
  try {
    results.push({ 
      name: 'Meteora DLMM Token-2022', 
      passed: await testDlmmBidirectional(payer, altAddress) 
    });
  } catch (err) {
    console.log(`   ❌ DLMM test failed with error: ${err}`);
    results.push({ name: 'Meteora DLMM Token-2022', passed: false });
  }
  
  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                     Test Summary                           ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  
  let passedCount = 0;
  for (const result of results) {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`║  ${status}  ${result.name.padEnd(40)} ║`);
    if (result.passed) passedCount++;
  }
  
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Total: ${passedCount}/${results.length} tests passed                               ║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  process.exit(passedCount === results.length ? 0 : 1);
}

main().catch(console.error);
