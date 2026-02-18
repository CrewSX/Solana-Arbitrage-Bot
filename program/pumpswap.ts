#!/usr/bin/env ts-node
/**
 * Pump.Fun AMM Bidirectional Test
 * Tests: 2-hop round trip SOL → PUMP → SOL using same pool in both directions
 * This verifies that is_base_swap works correctly for BUY (false) and SELL (true)
 * 
 * Pump.Fun pool structure: base=PUMP (Token-2022), quote=SOL
 * - is_base_swap=true (SELL): PUMP → SOL
 * - is_base_swap=false (BUY): SOL → PUMP
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
const PUMPFUN_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const connection = new Connection('http://localhost:8899', 'confirmed');

// Token mints
const SOL_MINT = NATIVE_MINT;
const PUMP_MINT = new PublicKey('pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn'); // Token-2022

// PumpFun AMM pool (base=PUMP, quote=SOL) - from mainnet fork test
const PUMPFUN_POOL = {
  pool: new PublicKey('8uENY6hrX9Tpveq4KMeGc7CRkq9QfMr1GHc3wWCEaZDb'),
  globalConfig: new PublicKey('ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw'),
  poolBaseTokenAccount: new PublicKey('4SsP63qw77AkiR1pffKXGi7gvSTCTmKhY5pZj4iN9Rf8'),
  poolQuoteTokenAccount: new PublicKey('9Yr5RLw3gXexPYEf5R3ecH5dJWLyoaGMvoKDUF193fMg'),
  protocolFeeRecipient: new PublicKey('G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP'),
  protocolFeeRecipientTokenAccount: new PublicKey('BWXT6RUhit9FfJQM3pBmqeFLPYmuxgmyhMGC5sGr8RbA'),
  coinCreatorVaultAta: new PublicKey('Ei6iux5MMYG8JxCTr58goADqFTtMroL9TXJityF3fAQc'),
  coinCreatorVaultAuthority: new PublicKey('8N3GDaZ2iwN65oxVatKTLPNooAVUJTbfiVJ1ahyqwjSk'),
  eventAuthority: new PublicKey('GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR'),
  feeConfig: new PublicKey('5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx'),
  feeProgram: new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ'),
  globalVolumeAccumulator: new PublicKey('C2aFPdENg4A2HQsmrd5rTw5TaYBX5Ku887cWjbFKtZpw'),
};

// Derive user volume accumulator PDAs
function getUserVolumeAccumulatorPDA(userPubkey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_volume_accumulator'), userPubkey.toBuffer()],
    PUMPFUN_AMM_PROGRAM_ID
  );
  return pda;
}

async function createALT(payer: Keypair): Promise<PublicKey> {
  const slot = await connection.getSlot('finalized');
  const [lookupTableInst, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });
  
  const userVolumeAcc = getUserVolumeAccumulatorPDA(payer.publicKey);
  
  const addressesToAdd: PublicKey[] = [
    SYSTEM_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
    SOL_MINT, PUMP_MINT,
    PUMPFUN_POOL.pool, PUMPFUN_POOL.globalConfig,
    PUMPFUN_POOL.poolBaseTokenAccount, PUMPFUN_POOL.poolQuoteTokenAccount,
    PUMPFUN_POOL.protocolFeeRecipient, PUMPFUN_POOL.protocolFeeRecipientTokenAccount,
    PUMPFUN_POOL.coinCreatorVaultAta, PUMPFUN_POOL.coinCreatorVaultAuthority,
    PUMPFUN_POOL.eventAuthority,
    PUMPFUN_POOL.feeConfig, PUMPFUN_POOL.feeProgram,
    PUMPFUN_POOL.globalVolumeAccumulator, userVolumeAcc,
    PUMPFUN_AMM_PROGRAM_ID,
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
  console.log(`   Hop 1: SOL → PUMP (is_base_swap=false, BUY)`);
  console.log(`   Hop 2: PUMP → SOL (is_base_swap=true, SELL)`);
  
  const lookupTableAccount = (await connection.getAddressLookupTable(altAddress)).value;
  if (!lookupTableAccount) throw new Error('Failed to fetch lookup table');
  
  const userVolumeAcc = getUserVolumeAccumulatorPDA(payer.publicKey);
  
  // 2-hop: SOL → PUMP → SOL
  const mints: MintInfo[] = [
    { mint: SOL_MINT, is2022: false },
    { mint: PUMP_MINT, is2022: true },
  ];
  
  // PumpAmm needs 13 pool accounts (same for BUY and SELL - processor handles differences)
  // 0: pool, 1: global_config, 2: pool_base_token_account, 3: pool_quote_token_account,
  // 4: protocol_fee_recipient, 5: protocol_fee_recipient_token_account, 6: event_authority,
  // 7: coin_creator_vault_ata, 8: coin_creator_vault_authority,
  // 9: global_volume_accumulator, 10: user_volume_accumulator,
  // 11: fee_config, 12: fee_program
  const poolAccounts = [
    PUMPFUN_POOL.pool,
    PUMPFUN_POOL.globalConfig,
    PUMPFUN_POOL.poolBaseTokenAccount,
    PUMPFUN_POOL.poolQuoteTokenAccount,
    PUMPFUN_POOL.protocolFeeRecipient,
    PUMPFUN_POOL.protocolFeeRecipientTokenAccount,
    PUMPFUN_POOL.eventAuthority,
    PUMPFUN_POOL.coinCreatorVaultAta,
    PUMPFUN_POOL.coinCreatorVaultAuthority,
    PUMPFUN_POOL.globalVolumeAccumulator,
    userVolumeAcc,
    PUMPFUN_POOL.feeConfig,
    PUMPFUN_POOL.feeProgram,
  ];
  
  // Hop 1: SOL → PUMP (BUY, is_base_swap=false)
  const hop1: HopPoolAccounts = {
    dexProgram: DexProgram.PumpAmm,
    dexProgramId: PUMPFUN_AMM_PROGRAM_ID,
    inTokenIs2022: false,  // SOL is not Token-2022
    outTokenIs2022: true,  // PUMP is Token-2022
    isBaseSwap: false,     // BUY = quote→base
    accounts: poolAccounts,
  };
  
  // Hop 2: PUMP → SOL (SELL, is_base_swap=true)
  const hop2: HopPoolAccounts = {
    dexProgram: DexProgram.PumpAmm,
    dexProgramId: PUMPFUN_AMM_PROGRAM_ID,
    inTokenIs2022: true,   // PUMP is Token-2022
    outTokenIs2022: false, // SOL is not Token-2022
    isBaseSwap: true,      // SELL = base→quote
    accounts: poolAccounts,
  };
  
  const { accounts, hops } = buildArbitrageAccounts(payer.publicKey, mints, [hop1, hop2]);
  
  const initialAmount = BigInt(0.05 * LAMPORTS_PER_SOL);
  
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
        log.includes('completed successfully') || 
        log.includes('BUY completed') || 
        log.includes('SELL completed')
      ).length >= 2;
      
      if (swapsCompleted) {
        console.log(result)
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
  console.log('🧪 Pump.Fun AMM Bidirectional Test');
  console.log('   Pool: PUMP/SOL (base=PUMP Token-2022, quote=SOL)');
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
      lamports: 500_000_000,
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
