#!/usr/bin/env ts-node
/**
 * Raydium CLMM Bidirectional Test
 * Tests: 2-hop round trip SOL → PUMP → SOL using same pool in both directions
 * This verifies that is_base_swap works correctly for both directions
 * Uses swap_v2 for Token-2022 (PUMP)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableProgram,
  LAMPORTS_PER_SOL,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddressSync, 
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID as SPL_TOKEN_2022,
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
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const connection = new Connection('http://localhost:8899', 'confirmed');

// Token mints
const SOL_MINT = NATIVE_MINT;
const PUMP_MINT = new PublicKey('pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn'); // Token-2022

// Raydium CLMM Pool: SOL/PUMP
const RAYDIUM_CLMM_POOL = {
  ammConfig: new PublicKey('DrdecJVzkaRsf1TQu1g7iFncaokikVTHqpzPjenjRySY'),
  poolState: new PublicKey('45ssPkUQs1ssbeDqxD2mZrMdJYAXF7GyQyhS5xDXuWC5'),
  vault0: new PublicKey('A5VBGEV5ghKGSNFLpSy83ePE1BMpd2hZ8BHxFafNBNf6'), // SOL vault
  vault1: new PublicKey('48xDcrnnENiygxTXGu9KPAuew3xRkfyrfb5iU6BNFbQK'), // PUMP vault
  observationState: new PublicKey('7oVcrScfu1jVKq1DsaVZ8HtX1RZ6sa3oik3uVhowtifK'),
  tickArray1: new PublicKey('GFHU8GNWeYKpLuTvfAJbeVHFiafBVZZwfCbD16NC9Y9t'),
  tickArray2: new PublicKey('DoCSVsGbeLNePLrCaDvzejLZqSQTG6nhEWtqCE4TMG17'),
  tickArray3: new PublicKey('3jwz1SpPNgom4emkV7hLRkEySwBmVx59KZ5vSCkEHdpP'),
};

async function createALT(payer: Keypair): Promise<PublicKey> {
  const slot = await connection.getSlot('finalized');
  const [lookupTableInst, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });
  
  const addressesToAdd: PublicKey[] = [
    SYSTEM_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
    MEMO_PROGRAM_ID,
    SOL_MINT, PUMP_MINT,
    RAYDIUM_CLMM_POOL.ammConfig, RAYDIUM_CLMM_POOL.poolState,
    RAYDIUM_CLMM_POOL.vault0, RAYDIUM_CLMM_POOL.vault1,
    RAYDIUM_CLMM_POOL.observationState,
    RAYDIUM_CLMM_POOL.tickArray1, RAYDIUM_CLMM_POOL.tickArray2, RAYDIUM_CLMM_POOL.tickArray3,
    RAYDIUM_CLMM_PROGRAM_ID,
  ];
  
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
  
  const extendInstruction = AddressLookupTableProgram.extendLookupTable({
    payer: payer.publicKey,
    authority: payer.publicKey,
    lookupTable: lookupTableAddress,
    addresses: addressesToAdd,
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
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  return lookupTableAddress;
}

async function testRoundTrip(
  payer: Keypair,
  altAddress: PublicKey
): Promise<boolean> {
  console.log(`\n🔄 Testing 2-hop round trip: SOL → PUMP → SOL (same pool, both directions)`);
  console.log(`   Hop 1: SOL → PUMP (is_base_swap=true)`);
  console.log(`   Hop 2: PUMP → SOL (is_base_swap=false)`);
  
  const lookupTableAccount = (await connection.getAddressLookupTable(altAddress)).value;
  if (!lookupTableAccount) throw new Error('Failed to fetch lookup table');
  
  // 2-hop: SOL → PUMP → SOL
  const mints: MintInfo[] = [
    { mint: SOL_MINT, is2022: false },
    { mint: PUMP_MINT, is2022: true },
  ];
  
  // Raydium CLMM with swap_v2 (Token-2022) needs:
  // ammConfig, poolState, inputVault, outputVault, observationState, memo_program, tickArray1, tickArray2, tickArray3
  const poolAccounts = [
    RAYDIUM_CLMM_POOL.ammConfig,
    RAYDIUM_CLMM_POOL.poolState,
    RAYDIUM_CLMM_POOL.vault0,
    RAYDIUM_CLMM_POOL.vault1,
    RAYDIUM_CLMM_POOL.observationState,
    MEMO_PROGRAM_ID,
    RAYDIUM_CLMM_POOL.tickArray1,
    RAYDIUM_CLMM_POOL.tickArray2,
    RAYDIUM_CLMM_POOL.tickArray3,
  ];
  
  // Hop 1: SOL → PUMP (token0 → token1)
  const hop1: HopPoolAccounts = {
    dexProgram: DexProgram.RaydiumClmm,
    dexProgramId: RAYDIUM_CLMM_PROGRAM_ID,
    inTokenIs2022: false,  // SOL is not Token-2022
    outTokenIs2022: true,  // PUMP is Token-2022
    isBaseSwap: true,      // token0 → token1
    accounts: poolAccounts,
  };
  
  // Hop 2: PUMP → SOL (token1 → token0)
  const hop2: HopPoolAccounts = {
    dexProgram: DexProgram.RaydiumClmm,
    dexProgramId: RAYDIUM_CLMM_PROGRAM_ID,
    inTokenIs2022: true,   // PUMP is Token-2022
    outTokenIs2022: false, // SOL is not Token-2022
    isBaseSwap: false,     // token1 → token0
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
      const swapsCompleted = logs.filter(log => log.includes('completed successfully') || log.includes('CLMM: Swap completed')).length >= 2;
      
      if (swapsCompleted) {
        console.log(`   ✅ Both swaps executed successfully (profitability check may have failed - expected)`);
        return true;
      } else {
        console.log(`   ❌ Swap failed: ${JSON.stringify(result.value.err)}`);
        logs.slice(-15).forEach(log => console.log(`      ${log}`));
        return false;
      }
    } else {
      console.log(`   ✅ Transaction succeeded (both directions work)`);
      return true;
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🧪 Raydium CLMM Bidirectional Test');
  console.log('   Pool: SOL/PUMP (Token-2022, uses swap_v2)');
  console.log('   Test: 2-hop round trip using same pool in both directions');
  console.log('═══════════════════════════════════════════════════════════');
  
  const payer = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(require('fs').readFileSync('/home/ubuntu/.config/solana/id.json', 'utf-8')))
  );
  console.log(`Payer: ${payer.publicKey.toBase58()}`);
  
  const wsolAccount = getAssociatedTokenAddressSync(SOL_MINT, payer.publicKey);
  const pumpAccount = getAssociatedTokenAddressSync(PUMP_MINT, payer.publicKey, false, SPL_TOKEN_2022);
  
  console.log('\n📋 Creating ALT...');
  const altAddress = await createALT(payer);
  console.log(`   ALT: ${altAddress.toBase58()}`);
  
  // Setup: Create PUMP account and fund WSOL
  const setupInstructions = [];
  
  const pumpAccountInfo = await connection.getAccountInfo(pumpAccount);
  if (!pumpAccountInfo) {
    setupInstructions.push(
      createAssociatedTokenAccountInstruction(payer.publicKey, pumpAccount, payer.publicKey, PUMP_MINT, SPL_TOKEN_2022)
    );
  }
  
  setupInstructions.push(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: wsolAccount,
      lamports: 100_000_000,
    }),
    createSyncNativeInstruction(wsolAccount)
  );
  
  let { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  let messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: setupInstructions,
  }).compileToV0Message();
  
  let transaction = new VersionedTransaction(messageV0);
  transaction.sign([payer]);
  await connection.sendTransaction(transaction);
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const success = await testRoundTrip(payer, altAddress);
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`📊 Result: ${success ? '✅ PASS - Both directions work' : '❌ FAIL'}`);
  console.log('═══════════════════════════════════════════════════════════');
  
  process.exit(success ? 0 : 1);
}

main().catch(console.error);
