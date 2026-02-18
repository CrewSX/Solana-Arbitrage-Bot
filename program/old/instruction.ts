import { PublicKey } from '@solana/web3.js';

/**
 * DEX Program enum - each represents a separate on-chain program with unique program ID
 */
export enum DexProgram {
  pumpswap = 0,           // pump.fun AMM
  orcawp = 1,     // Orca Whirlpool CLMM
  dyn1 = 2,     // Meteora Dynamic AMM V1
  dyn2 = 3,     // Meteora Dynamic AMM V2 (separate program)
  dlmm = 4,       // Meteora DLMM
  raydium = 5,      // Raydium AMM V4
  clmm = 6,       // Raydium CLMM
  cpmm = 7,       // Raydium CPMM
}

/**
 * Single hop in arbitrage route
 */
export interface HopData {
  dexProgram: DexProgram;   // Which DEX program (0-7)
  isSwapV2: boolean;        // If true, use swap_v2 instruction (for Token-2022 pools)
  poolIndex: number;        // Index into remaining accounts
  inputMint: PublicKey;
  outputMint: PublicKey;
  minimumOutput: bigint;
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
 */
export function buildArbitrageInstructionData(route: ArbitrageRoute): Buffer {
  const hopCount = route.hops.length;
  
  if (hopCount < 2 || hopCount > 4) {
    throw new Error('Invalid hop count: must be 2, 3, or 4');
  }
  
  // Calculate size: 1 (tag) + 8 (initial) + 8 (min_output) + 1 (count) + (75 * hops)
  // Each hop: dex_program(1) + is_swap_v2(1) + pool_index(1) + input_mint(32) + output_mint(32) + min_output(8) = 75 bytes
  const dataSize = 1 + 8 + 8 + 1 + (hopCount * 75);
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
    
    // is_swap_v2 flag (u8: 0 = false, 1 = true)
    data.writeUInt8(hop.isSwapV2 ? 1 : 0, offset);
    offset += 1;
    
    // Pool index (u8)
    data.writeUInt8(hop.poolIndex, offset);
    offset += 1;
    
    // Input mint (32 bytes)
    hop.inputMint.toBuffer().copy(data, offset);
    offset += 32;
    
    // Output mint (32 bytes)
    hop.outputMint.toBuffer().copy(data, offset);
    offset += 32;
    
    // Minimum output (u64, little-endian)
    data.writeBigUInt64LE(hop.minimumOutput, offset);
    offset += 8;
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
    
    const isSwapV2 = data.readUInt8(offset) === 1;
    offset += 1;
    
    const poolIndex = data.readUInt8(offset);
    offset += 1;
    
    const inputMint = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;
    
    const outputMint = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;
    
    const minimumOutput = data.readBigUInt64LE(offset);
    offset += 8;
    
    hops.push({
      dexProgram,
      isSwapV2,
      poolIndex,
      inputMint,
      outputMint,
      minimumOutput,
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
  
  // Validate hop chain
  for (let i = 0; i < route.hops.length - 1; i++) {
    if (!route.hops[i].outputMint.equals(route.hops[i + 1].inputMint)) {
      return false;
    }
  }
  
  // Validate circular arbitrage
  const firstHop = route.hops[0];
  const lastHop = route.hops[route.hops.length - 1];
  
  if (!lastHop.outputMint.equals(firstHop.inputMint)) {
    return false;
  }
  
  return true;
}
