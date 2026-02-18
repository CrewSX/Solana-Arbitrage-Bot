import { PublicKey } from '@solana/web3.js';

// System Programs
export const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/**
 * DEX Program enum - each represents a separate on-chain program with unique program ID
 */
export enum DexProgram {
  PumpAmm = 0,           // pump.fun AMM
  OrcaWhirlpool = 1,     // Orca Whirlpool CLMM
  MeteoraDammV1 = 2,     // Meteora Dynamic AMM V1
  MeteoraDammV2 = 3,     // Meteora Dynamic AMM V2 (separate program)
  MeteoraDlmm = 4,       // Meteora DLMM
  RaydiumAmmV4 = 5,      // Raydium AMM V4
  RaydiumClmm = 6,       // Raydium CLMM
  RaydiumCpmm = 7,       // Raydium CPMM
}

/**
 * Single hop in arbitrage route (optimized format)
 * 
 * Account layout:
 * 0: user_authority (signer)
 * 1..=hop_count: mint accounts (circular: mint1->mint2->...->mint1)
 * hop_count+1..: pool-specific accounts
 * last N accounts: DEX program IDs for CPI
 */
export interface HopData {
  dexProgram: DexProgram;     // Which DEX program (0-7)
  inTokenIs2022: boolean;     // Input token uses Token-2022 program
  outTokenIs2022: boolean;    // Output token uses Token-2022 program
  isBaseSwap: boolean;        // true if in=tokenX/base, out=tokenY/quote (pool's base direction)
  poolIndex: number;          // Index to pool-specific accounts (after header)
  dexProgramIndex: number;    // Index to DEX program account (from start of pool accounts)
}

/**
 * Complete arbitrage route
 */
export interface ArbitrageRoute {
  hops: HopData[];
  initialAmount: bigint;
  minimumFinalOutput: bigint;
}

/**
 * Build instruction data for ExecuteArbitrage
 * Optimized format: 5 bytes per hop
 */
export function buildArbitrageInstructionData(route: ArbitrageRoute): Buffer {
  const hopCount = route.hops.length;
  
  if (hopCount < 2 || hopCount > 4) {
    throw new Error('Invalid hop count: must be 2, 3, or 4');
  }
  
  // Calculate size: 1 (tag) + 8 (initial) + 8 (min_output) + 1 (count) + (6 * hops)
  // Each hop: dex_program(1) + in_token_is_2022(1) + out_token_is_2022(1) + is_base_swap(1) + pool_index(1) + dex_program_index(1) = 6 bytes
  const dataSize = 1 + 8 + 8 + 1 + (hopCount * 6);
  const data = Buffer.alloc(dataSize);
  
  let offset = 0;
  
  // Instruction tag (0 = ExecuteArbitrage)
  data.writeUInt8(0, offset);
  offset += 1;
  
  // Initial amount (u64, little-endian)
  data.writeBigUInt64LE(route.initialAmount, offset);
  offset += 8;
  
  // Minimum final output (u64, little-endian)
  data.writeBigUInt64LE(route.minimumFinalOutput, offset);
  offset += 8;
  
  // Hop count (u8)
  data.writeUInt8(hopCount, offset);
  offset += 1;
  
  // Each hop data
  for (const hop of route.hops) {
    // DEX program (u8)
    data.writeUInt8(hop.dexProgram, offset);
    offset += 1;
    
    // in_token_is_2022 flag (u8)
    data.writeUInt8(hop.inTokenIs2022 ? 1 : 0, offset);
    offset += 1;
    
    // out_token_is_2022 flag (u8)
    data.writeUInt8(hop.outTokenIs2022 ? 1 : 0, offset);
    offset += 1;
    
    // is_base_swap flag (u8)
    data.writeUInt8(hop.isBaseSwap ? 1 : 0, offset);
    offset += 1;
    
    // Pool index (u8)
    data.writeUInt8(hop.poolIndex, offset);
    offset += 1;
    
    // DEX program index (u8)
    data.writeUInt8(hop.dexProgramIndex, offset);
    offset += 1;
  }
  
  return data;
}

/**
 * Parse instruction data (for testing)
 */
export function parseArbitrageInstructionData(data: Buffer): ArbitrageRoute {
  let offset = 0;
  
  // Instruction tag
  const tag = data.readUInt8(offset);
  offset += 1;
  
  if (tag !== 0) {
    throw new Error('Invalid instruction tag');
  }
  
  // Initial amount
  const initialAmount = data.readBigUInt64LE(offset);
  offset += 8;
  
  // Minimum final output
  const minimumFinalOutput = data.readBigUInt64LE(offset);
  offset += 8;
  
  // Hop count
  const hopCount = data.readUInt8(offset);
  offset += 1;
  
  if (hopCount < 2 || hopCount > 4) {
    throw new Error('Invalid hop count');
  }
  
  const hops: HopData[] = [];
  
  for (let i = 0; i < hopCount; i++) {
    const dexProgram = data.readUInt8(offset) as DexProgram;
    offset += 1;
    
    const inTokenIs2022 = data.readUInt8(offset) === 1;
    offset += 1;
    
    const outTokenIs2022 = data.readUInt8(offset) === 1;
    offset += 1;
    
    const isBaseSwap = data.readUInt8(offset) === 1;
    offset += 1;
    
    const poolIndex = data.readUInt8(offset);
    offset += 1;
    
    const dexProgramIndex = data.readUInt8(offset);
    offset += 1;
    
    hops.push({
      dexProgram,
      inTokenIs2022,
      outTokenIs2022,
      isBaseSwap,
      poolIndex,
      dexProgramIndex,
    });
  }

  return {
    hops,
    initialAmount,
    minimumFinalOutput,
  };
}

/**
 * Validate route structure
 */
export function validateRoute(route: ArbitrageRoute): boolean {
  if (route.hops.length < 2 || route.hops.length > 4) {
    return false;
  }
  return true;
}

/**
 * Get pool account count for a DEX
 */
export function getPoolAccountCount(dexProgram: DexProgram): number {
  switch (dexProgram) {
    case DexProgram.PumpAmm: return 13; // pool, global_config, vaults, fees, event_authority, creator vault, fee_config, fee_program
    case DexProgram.OrcaWhirlpool: return 7;
    case DexProgram.MeteoraDammV1: return 8;
    case DexProgram.MeteoraDammV2: return 5;
    case DexProgram.MeteoraDlmm: return 10;
    case DexProgram.RaydiumAmmV4: return 4;  // amm, ammAuthority, ammCoinVault, ammPcVault
    case DexProgram.RaydiumClmm: return 9; // Includes memo_program for swap_v2
    case DexProgram.RaydiumCpmm: return 6;
    default: return 0;
  }
}

/**
 * Check if DEX supports swap_v2
 */
export function supportsSwapV2(dexProgram: DexProgram): boolean {
  return [
    DexProgram.OrcaWhirlpool,
    DexProgram.MeteoraDlmm,
    DexProgram.RaydiumClmm,
    DexProgram.MeteoraDammV2,
  ].includes(dexProgram);
}

/**
 * Derive Associated Token Address
 * Same logic as Rust: find_program_address([wallet, token_program, mint], ATA_PROGRAM)
 */
export function getAssociatedTokenAddress(
  wallet: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey
): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [wallet.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

/**
 * Mint information with Token-2022 flag
 */
export interface MintInfo {
  mint: PublicKey;
  is2022: boolean;
}

/**
 * Pool accounts for a single hop
 */
export interface HopPoolAccounts {
  dexProgram: DexProgram;
  dexProgramId: PublicKey;
  accounts: PublicKey[];  // Pool-specific accounts (vaults, oracles, etc.)
  inTokenIs2022: boolean;
  outTokenIs2022: boolean;
  isBaseSwap?: boolean;    // true if in=tokenX/base, out=tokenY/quote (pool's base direction). Defaults to true.
}

/**
 * Build the complete account list for an arbitrage transaction
 * 
 * Account layout:
 * 0: user_authority (signer, payer)
 * 1: system_program
 * 2: associated_token_program
 * 3: token_program (SPL Token)
 * 4: token_program_2022
 * 5..=hop_count+4: mint accounts
 * hop_count+5..=2*hop_count+4: user ATA accounts
 * remaining: pool-specific accounts, then DEX program IDs
 */
export function buildArbitrageAccounts(
  userAuthority: PublicKey,
  mints: MintInfo[],
  hopPoolAccounts: HopPoolAccounts[]
): { accounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]; hops: HopData[] } {
  const hopCount = mints.length;
  
  if (hopCount < 2 || hopCount > 4) {
    throw new Error('Must have 2-4 mints for circular arbitrage');
  }
  
  if (hopPoolAccounts.length !== hopCount) {
    throw new Error('Must have one pool per hop');
  }
  
  const accounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
  
  // 0: user_authority (signer, payer)
  accounts.push({ pubkey: userAuthority, isSigner: true, isWritable: true });
  
  // 1: system_program
  accounts.push({ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false });
  
  // 2: associated_token_program
  accounts.push({ pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false });
  
  // 3: token_program (SPL Token)
  accounts.push({ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false });
  
  // 4: token_program_2022
  accounts.push({ pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false });
  
  // 5..=hop_count+4: mint accounts
  for (const mintInfo of mints) {
    accounts.push({ pubkey: mintInfo.mint, isSigner: false, isWritable: false });
  }
  
  // hop_count+5..=2*hop_count+4: user ATA accounts
  for (let i = 0; i < mints.length; i++) {
    const mintInfo = mints[i];
    const tokenProgram = mintInfo.is2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const ata = getAssociatedTokenAddress(userAuthority, mintInfo.mint, tokenProgram);
    accounts.push({ pubkey: ata, isSigner: false, isWritable: true });
  }
  
  // Collect pool accounts and DEX program IDs
  const poolAccountsStartIndex = accounts.length - (5 + hopCount + hopCount);  // Relative to after header
  let currentPoolIndex = 0;
  const dexProgramIds: PublicKey[] = [];
  const hops: HopData[] = [];
  
  // Add pool-specific accounts for each hop
  for (let i = 0; i < hopPoolAccounts.length; i++) {
    const hop = hopPoolAccounts[i];
    
    // Check if DEX program already added
    let dexProgramIndex = dexProgramIds.findIndex(p => p.equals(hop.dexProgramId));
    if (dexProgramIndex === -1) {
      dexProgramIndex = dexProgramIds.length;
      dexProgramIds.push(hop.dexProgramId);
    }
    
    // Build hop data
    hops.push({
      dexProgram: hop.dexProgram,
      inTokenIs2022: hop.inTokenIs2022,
      outTokenIs2022: hop.outTokenIs2022,
      isBaseSwap: hop.isBaseSwap ?? true, // Default to base swap direction
      poolIndex: currentPoolIndex,
      dexProgramIndex: dexProgramIndex,
    });
    
    // Add pool accounts
    for (const acc of hop.accounts) {
      accounts.push({ pubkey: acc, isSigner: false, isWritable: true });
    }
    
    currentPoolIndex += hop.accounts.length;
  }
  
  // Add DEX program IDs at the end
  for (const dexProgram of dexProgramIds) {
    accounts.push({ pubkey: dexProgram, isSigner: false, isWritable: false });
  }
  
  // Fix dexProgramIndex to be relative to pool accounts start (after ATAs)
  const totalPoolAccounts = currentPoolIndex;
  for (const hop of hops) {
    hop.dexProgramIndex = totalPoolAccounts + hop.dexProgramIndex;
  }
  
  return { accounts, hops };
}
