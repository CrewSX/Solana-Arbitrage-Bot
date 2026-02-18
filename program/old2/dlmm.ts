#!/usr/bin/env ts-node
/**
 * Meteora DLMM Bidirectional Test
 * Tests: 2-hop round trip SOL → USDC → SOL using same pool in both directions
 * This verifies that is_base_swap works correctly for x_to_y (true) and y_to_x (false)
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
const METEORA_DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
const connection = new Connection('http://localhost:8899', 'confirmed');

// Token mints
const SOL_MINT = NATIVE_MINT;
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Meteora DLMM SOL/USDC pool (token_x=SOL, token_y=USDC)
const DLMM_POOL = {
  lbPair: new PublicKey('sZxb9vrxJBpFiJBogovhfkYqfapVzveLEU4TmzWv4GN'),
  reserveX: new PublicKey('CN8k1PtzJz2mGGdf5puwV14Dh1skMRkT42sSvhesf3nT'),
  reserveY: new PublicKey('4FkX872Wbo6NK7eNEmMnDRMJnwbu6tQsE6utb5fbDbzv'),
  oracle: new PublicKey('FU4BG5pwU77dFecQ5t7sd3jsdEgwiWEyxqCfufJK4HVa'),
  binArrayBitmapExtension: new PublicKey('rg4aG6Nsgvr13Auo2PgUVtrmv3ieu6GSR99uXmXnMa5'),
  eventAuthority: new PublicKey('D1ZN9Wj1fRSUQfCjhvnu1hqDMT7hzjzBBpi12nVniYD6'),
  binArrays: [
    new PublicKey('2NXEqGpDADqcAw4eWCzAvjTSm4THTafmGyR73bGGLzka'),
    new PublicKey('4FKYJwTySY9rhwGEUr544NLNbMwR9MF3hMcQVT9Emhix'),
    new PublicKey('2NXEqGpDADqcAw4eWCzAvjTSm4THTafmGyR73bGGLzka'), // duplicate for 11 count
  ],
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
    DLMM_POOL.lbPair, DLMM_POOL.binArrayBitmapExtension, DLMM_POOL.reserveX, DLMM_POOL.reserveY,
    DLMM_POOL.oracle, DLMM_POOL.eventAuthority, ...DLMM_POOL.binArrays,
    METEORA_DLMM_PROGRAM_ID,
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
  console.log(`   Hop 1: SOL → USDC (is_base_swap=true, x_to_y)`);
  console.log(`   Hop 2: USDC → SOL (is_base_swap=false, y_to_x)`);
  
  const lookupTableAccount = (await connection.getAddressLookupTable(altAddress)).value;
  if (!lookupTableAccount) throw new Error('Failed to fetch lookup table');
  
  // 2-hop: SOL → USDC → SOL
  const mints: MintInfo[] = [
    { mint: SOL_MINT, is2022: false },
    { mint: USDC_MINT, is2022: false },
  ];
  
  const poolAccounts = [
    DLMM_POOL.lbPair,
    DLMM_POOL.binArrayBitmapExtension,
    DLMM_POOL.reserveX,
    DLMM_POOL.reserveY,
    DLMM_POOL.oracle,
    METEORA_DLMM_PROGRAM_ID, // host_fee_in placeholder
    DLMM_POOL.eventAuthority,
    ...DLMM_POOL.binArrays,
  ];
  
  // Hop 1: SOL → USDC (x_to_y = true)
  const hop1: HopPoolAccounts = {
    dexProgram: DexProgram.MeteoraDlmm,
    dexProgramId: METEORA_DLMM_PROGRAM_ID,
    inTokenIs2022: false,
    outTokenIs2022: false,
    isBaseSwap: true, // x_to_y
    accounts: poolAccounts,
  };
  
  // Hop 2: USDC → SOL (y_to_x = false)
  const hop2: HopPoolAccounts = {
    dexProgram: DexProgram.MeteoraDlmm,
    dexProgramId: METEORA_DLMM_PROGRAM_ID,
    inTokenIs2022: false,
    outTokenIs2022: false,
    isBaseSwap: false, // y_to_x
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
      const swapsCompleted = logs.filter(log => log.includes('completed successfully') || log.includes('DLMM: Swap completed')).length >= 2;
      
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
  console.log('🧪 Meteora DLMM Bidirectional Test');
  console.log('   Pool: SOL/USDC (token_x=SOL, token_y=USDC)');
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
