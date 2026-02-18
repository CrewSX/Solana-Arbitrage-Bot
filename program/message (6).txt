#!/usr/bin/env ts-node
/**
 * Meteora DAMM V2 Bidirectional Test
 * Tests: 2-hop round trip SOL → USDC → SOL using same pool in both directions
 * This verifies that is_base_swap works correctly for both directions
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
  createSyncNativeInstruction,
  NATIVE_MINT,
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
const METEORA_DAMM_V2_PROGRAM_ID = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
const connection = new Connection('http://localhost:8899', 'confirmed');

// Token mints
const SOL_MINT = NATIVE_MINT;
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Meteora DAMM V2 Pool: SOL/USDC
// Pool accounts needed: poolAuthority, pool, tokenAVault, tokenBVault, eventAuthority
// Note: referral_token_account is handled by processor.rs (uses program ID to skip)
const METEORA_V2_POOL = {
  poolAuthority: new PublicKey('HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'),
  pool: new PublicKey('8Pm2kZpnxD3hoMmt4bjStX2Pw2Z9abpbHzZxMPqxPmie'),
  tokenAVault: new PublicKey('sx8hCMCauCdbZ7sVBGSJmH7b7JmtuN8d8YwYmBpuPLH'), // SOL vault
  tokenBVault: new PublicKey('8S8HjmPZr8tNNEmMj5pcqS5RN73uF6DmcUDEDaoUQ1Ei'), // USDC vault
  eventAuthority: new PublicKey('3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet'),
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
    SOL_MINT, USDC_MINT,
    METEORA_V2_POOL.poolAuthority, METEORA_V2_POOL.pool,
    METEORA_V2_POOL.tokenAVault, METEORA_V2_POOL.tokenBVault,
    METEORA_V2_POOL.eventAuthority,
    METEORA_DAMM_V2_PROGRAM_ID,
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
  console.log(`\n🔄 Testing 2-hop round trip: SOL → USDC → SOL (same pool, both directions)`);
  console.log(`   Hop 1: SOL → USDC (is_base_swap=true, tokenA→tokenB)`);
  console.log(`   Hop 2: USDC → SOL (is_base_swap=false, tokenB→tokenA)`);
  
  const lookupTableAccount = (await connection.getAddressLookupTable(altAddress)).value;
  if (!lookupTableAccount) throw new Error('Failed to fetch lookup table');
  
  // 2-hop: SOL → USDC → SOL
  const mints: MintInfo[] = [
    { mint: SOL_MINT, is2022: false },
    { mint: USDC_MINT, is2022: false },
  ];
  
  // Meteora DAMM V2 needs: poolAuthority, pool, tokenAVault, tokenBVault, eventAuthority
  // (referral_token_account uses program ID to skip, so not needed here)
  const poolAccounts = [
    METEORA_V2_POOL.poolAuthority,
    METEORA_V2_POOL.pool,
    METEORA_V2_POOL.tokenAVault,
    METEORA_V2_POOL.tokenBVault,
    METEORA_V2_POOL.eventAuthority,
  ];
  
  // Hop 1: SOL → USDC (tokenA → tokenB)
  const hop1: HopPoolAccounts = {
    dexProgram: DexProgram.MeteoraDammV2,
    dexProgramId: METEORA_DAMM_V2_PROGRAM_ID,
    inTokenIs2022: false,
    outTokenIs2022: false,
    isBaseSwap: true,
    accounts: poolAccounts,
  };
  
  // Hop 2: USDC → SOL (tokenB → tokenA)
  const hop2: HopPoolAccounts = {
    dexProgram: DexProgram.MeteoraDammV2,
    dexProgramId: METEORA_DAMM_V2_PROGRAM_ID,
    inTokenIs2022: false,
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
    // Use helper to simulate and print full results with logs
    const { simulateAndPrintResult } = await import('./test-common');
    const { success, logs, error } = await simulateAndPrintResult(transaction, 'Meteora V2 Bidirectional');
    
    // Check if both swaps completed successfully in the logs
    const logsStr = logs?.join('\n') || '';
    const swapsCompleted = (logsStr.match(/Meteora DAMM V2: Swap completed successfully/g) || []).length >= 2;
    
    if (swapsCompleted) {
      console.log(`\n✅ Both Meteora V2 swaps executed successfully!`);
      if (!success && logsStr.includes('Net loss')) {
        console.log(`   (Transaction reverted due to net loss check - expected for non-profitable routes)`);
      }
      return true;
    } else if (!success) {
      console.log(`\n❌ Swap failed - check logs above`);
      return false;
    } else {
      console.log(`\n✅ Transaction succeeded (both directions work)`);
      return true;
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🧪 Meteora DAMM V2 Bidirectional Test');
  console.log('   Pool: SOL/USDC');
  console.log('   Test: 2-hop round trip using same pool in both directions');
  console.log('═══════════════════════════════════════════════════════════');
  
  const payer = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(require('fs').readFileSync('/home/ubuntu/.config/solana/id.json', 'utf-8')))
  );
  console.log(`Payer: ${payer.publicKey.toBase58()}`);
  
  const wsolAccount = getAssociatedTokenAddressSync(SOL_MINT, payer.publicKey);
  
  console.log('\n📋 Creating ALT...');
  const altAddress = await createALT(payer);
  console.log(`   ALT: ${altAddress.toBase58()}`);
  
  // Fund WSOL
  const setupInstructions = [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: wsolAccount,
      lamports: 50_000_000,
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
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const success = await testRoundTrip(payer, altAddress);
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`📊 Result: ${success ? '✅ PASS - Both directions work' : '❌ FAIL'}`);
  console.log('═══════════════════════════════════════════════════════════');
  
  process.exit(success ? 0 : 1);
}

main().catch(console.error);
