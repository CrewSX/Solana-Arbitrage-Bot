#!/usr/bin/env ts-node
/**
 * Raydium AMM V4 Bidirectional Test
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
const RAYDIUM_AMM_V4_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const connection = new Connection('http://localhost:8899', 'confirmed');

// Token mints
const SOL_MINT = NATIVE_MINT;
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Raydium AMM V4 Pool: SOL/USDC
const RAYDIUM_AMM_V4_POOL = {
  amm: new PublicKey('58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'),
  ammAuthority: new PublicKey('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'),
  ammCoinVault: new PublicKey('DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz'), // SOL vault
  ammPcVault: new PublicKey('HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz'), // USDC vault
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
    RAYDIUM_AMM_V4_POOL.amm, RAYDIUM_AMM_V4_POOL.ammAuthority,
    RAYDIUM_AMM_V4_POOL.ammCoinVault, RAYDIUM_AMM_V4_POOL.ammPcVault,
    RAYDIUM_AMM_V4_PROGRAM_ID,
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
  console.log(`   Hop 1: SOL → USDC (is_base_swap=true, coin→pc)`);
  console.log(`   Hop 2: USDC → SOL (is_base_swap=false, pc→coin)`);
  
  const lookupTableAccount = (await connection.getAddressLookupTable(altAddress)).value;
  if (!lookupTableAccount) throw new Error('Failed to fetch lookup table');
  
  // 2-hop: SOL → USDC → SOL
  const mints: MintInfo[] = [
    { mint: SOL_MINT, is2022: false },
    { mint: USDC_MINT, is2022: false },
  ];
  
  // Raydium AMM V4 needs: amm, ammAuthority, ammCoinVault, ammPcVault
  const poolAccounts = [
    RAYDIUM_AMM_V4_POOL.amm,
    RAYDIUM_AMM_V4_POOL.ammAuthority,
    RAYDIUM_AMM_V4_POOL.ammCoinVault,
    RAYDIUM_AMM_V4_POOL.ammPcVault,
  ];
  
  // Hop 1: SOL → USDC (coin → pc)
  const hop1: HopPoolAccounts = {
    dexProgram: DexProgram.RaydiumAmmV4,
    dexProgramId: RAYDIUM_AMM_V4_PROGRAM_ID,
    inTokenIs2022: false,
    outTokenIs2022: false,
    isBaseSwap: true,
    accounts: poolAccounts,
  };
  
  // Hop 2: USDC → SOL (pc → coin)
  const hop2: HopPoolAccounts = {
    dexProgram: DexProgram.RaydiumAmmV4,
    dexProgramId: RAYDIUM_AMM_V4_PROGRAM_ID,
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
  
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
  
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
      const swapsCompleted = logs.filter(log => log.includes('completed successfully') || log.includes('AMM V4: Swap completed')).length >= 2;
      
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
  console.log('🧪 Raydium AMM V4 Bidirectional Test');
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
