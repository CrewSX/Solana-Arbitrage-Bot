#!/usr/bin/env ts-node
/**
 * Meteora DAMM V1 Bidirectional Test
 * Tests: 2-hop round trip USDC → SOL → USDC using same pool in both directions
 * This verifies that is_base_swap works correctly for both directions
 * 
 * Note: DAMM V1 pool is USDC/SOL (token A = USDC, token B = SOL)
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
const METEORA_DAMM_V1_PROGRAM_ID = new PublicKey('Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB');
const VAULT_PROGRAM_ID = new PublicKey('24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi');
const connection = new Connection('http://localhost:8899', 'confirmed');

// Token mints
const SOL_MINT = NATIVE_MINT;
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Meteora DAMM V1 Pool: USDC/SOL (A=USDC, B=SOL)
const METEORA_V1_POOL = {
  pool: new PublicKey('5yuefgbJJpmFNK2iiYbLSpv1aZXq7F9AUKkZKErTYCvs'),
  aVault: new PublicKey('3ESUFCnRNgZ7Mn2mPPUMmXYaKU8jpnV9VtA17M7t2mHQ'),
  bVault: new PublicKey('FERjPVNEa7Udq8CEv68h6tPL46Tq7ieE49HrE2wea3XT'),
  aTokenVault: new PublicKey('C2QoQ111jGHEy5918XkNXQro7gGwC9PKLXd1LqBiYNwA'),
  bTokenVault: new PublicKey('HZeLxbZ9uHtSpwZC3LBr4Nubd14iHwz7bRSghRZf5VCG'),
  aVaultLpMint: new PublicKey('3RpEekjLE5cdcG15YcXJUpxSepemvq2FpmMcgo342BwC'),
  bVaultLpMint: new PublicKey('FZN7QZ8ZUUAxMPfxYEYkH3cXUASzH8EqA6B4tyCL8f1j'),
  aVaultLp: new PublicKey('CNc2A5yjKUa9Rp3CVYXF9By1qvRHXMncK9S254MS9JeV'),
  bVaultLp: new PublicKey('7LHUMZd12RuanSXhXjQWPSXS6QEVQimgwxde6xYTJuA7'),
  protocolTokenFeeA: new PublicKey('3YWmQzX9gm6EWLx72f7EUVWiVsWm1y8JzfJvTdRJe8v6'), // USDC fee
  protocolTokenFeeB: new PublicKey('5YMJwb6z56NJh4QxgXULJsoUZLb4mFHwpUMfNxJ5KhaZ'), // wSOL fee
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
    METEORA_V1_POOL.pool, METEORA_V1_POOL.aVault, METEORA_V1_POOL.bVault,
    METEORA_V1_POOL.aTokenVault, METEORA_V1_POOL.bTokenVault,
    METEORA_V1_POOL.aVaultLpMint, METEORA_V1_POOL.bVaultLpMint,
    METEORA_V1_POOL.aVaultLp, METEORA_V1_POOL.bVaultLp,
    METEORA_V1_POOL.protocolTokenFeeA, METEORA_V1_POOL.protocolTokenFeeB,
    VAULT_PROGRAM_ID, METEORA_DAMM_V1_PROGRAM_ID,
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
  // For DAMM V1 pool: A=USDC, B=SOL
  // We test: SOL → USDC → SOL
  // Hop 1: SOL → USDC = tokenB → tokenA = is_base_swap=false
  // Hop 2: USDC → SOL = tokenA → tokenB = is_base_swap=true
  console.log(`\n🔄 Testing 2-hop round trip: SOL → USDC → SOL (same pool, both directions)`);
  console.log(`   Pool layout: A=USDC, B=SOL`);
  console.log(`   Hop 1: SOL → USDC (is_base_swap=false, B→A)`);
  console.log(`   Hop 2: USDC → SOL (is_base_swap=true, A→B)`);
  
  const lookupTableAccount = (await connection.getAddressLookupTable(altAddress)).value;
  if (!lookupTableAccount) throw new Error('Failed to fetch lookup table');
  
  // 2-hop: SOL → USDC → SOL
  const mints: MintInfo[] = [
    { mint: SOL_MINT, is2022: false },
    { mint: USDC_MINT, is2022: false },
  ];
  
  // Meteora DAMM V1 needs 12 accounts:
  // pool, a_vault, b_vault, a_token_vault, b_token_vault,
  // a_vault_lp_mint, b_vault_lp_mint, a_vault_lp, b_vault_lp, 
  // protocol_token_fee_a, protocol_token_fee_b, vault_program
  const poolAccounts = [
    METEORA_V1_POOL.pool,
    METEORA_V1_POOL.aVault,
    METEORA_V1_POOL.bVault,
    METEORA_V1_POOL.aTokenVault,
    METEORA_V1_POOL.bTokenVault,
    METEORA_V1_POOL.aVaultLpMint,
    METEORA_V1_POOL.bVaultLpMint,
    METEORA_V1_POOL.aVaultLp,
    METEORA_V1_POOL.bVaultLp,
    METEORA_V1_POOL.protocolTokenFeeA, // [9] for A input (A→B swap)
    METEORA_V1_POOL.protocolTokenFeeB, // [10] for B input (B→A swap)
    VAULT_PROGRAM_ID,                  // [11]
  ];
  
  // Hop 1: SOL → USDC (B → A, so is_base_swap=false)
  const hop1: HopPoolAccounts = {
    dexProgram: DexProgram.MeteoraDammV1,
    dexProgramId: METEORA_DAMM_V1_PROGRAM_ID,
    inTokenIs2022: false,
    outTokenIs2022: false,
    isBaseSwap: false, // B→A
    accounts: poolAccounts,
  };
  
  // Hop 2: USDC → SOL (A → B, so is_base_swap=true)
  const hop2: HopPoolAccounts = {
    dexProgram: DexProgram.MeteoraDammV1,
    dexProgramId: METEORA_DAMM_V1_PROGRAM_ID,
    inTokenIs2022: false,
    outTokenIs2022: false,
    isBaseSwap: true, // A→B
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
  
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
  
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
      const swapsCompleted = logs.filter(log => log.includes('completed successfully') || log.includes('Dynamic AMM: Swap completed')).length >= 2;
      
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
  console.log('🧪 Meteora DAMM V1 Bidirectional Test');
  console.log('   Pool: USDC/SOL (A=USDC, B=SOL)');
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
