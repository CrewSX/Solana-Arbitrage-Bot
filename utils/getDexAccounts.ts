import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { PumpAmmSdk , LiquidityAccounts, Pool} from "@pump-fun/pump-swap-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getPdaPoolVaultId, getPdaTickArrayAddress, liquidityStateV4Layout, Raydium, TickUtils, TickArrayLayout } from "@raydium-io/raydium-sdk-v2";
import { buildWhirlpoolClient, PDAUtil,TickUtil,TickArrayUtil, SwapUtils, WhirlpoolContext } from "@orca-so/whirlpools-sdk";
import { Wallet } from "@coral-xyz/anchor";
import DLMM ,{getPriceOfBinByBinId} from "@meteora-ag/dlmm";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import {LiquidityStateV4} from '@raydium-io/raydium-sdk';
import { logger } from "./logger";
let raydium: Raydium;
const PUMPFUN_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
export async function getDexAccounts(dex: string, poolAddress: string, connection: Connection, wallet:Keypair){
    let accounts:PublicKey[]=[];
    if(dex=="pumpswap"){
        try{
            const accountInfo=await connection.getAccountInfo(new PublicKey(poolAddress))
            if(!accountInfo){
                console.log("Account not found", poolAddress, dex);
                return undefined;
            }
            const XMint=bs58.encode(accountInfo.data.slice(43, 43 + 32));
            const poolBaseTokenAccount = bs58.encode(accountInfo.data.slice(139, 139 + 32));
            const poolQuoteTokenAccount = bs58.encode(accountInfo.data.slice(171, 171 + 32));
            const coin_creator = bs58.encode(accountInfo.data.slice(211, 211 + 32));
            const pumpAmmSdk=new PumpAmmSdk(connection);
            const coinCreatorVaultAuthority=pumpAmmSdk.coinCreatorVaultAuthorityPda(new PublicKey(coin_creator));
            const coinCreatorVaultAta=pumpAmmSdk.coinCreatorVaultAta(coinCreatorVaultAuthority, new PublicKey("So11111111111111111111111111111111111111112"), TOKEN_PROGRAM_ID);
            const userVolumeAcc = getUserVolumeAccumulatorPDA(wallet.publicKey);
            accounts.push(new PublicKey(XMint));
            accounts.push(new PublicKey(poolAddress));
            accounts.push(new PublicKey('ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw'));
            accounts.push(new PublicKey(poolBaseTokenAccount));
            accounts.push(new PublicKey(poolQuoteTokenAccount));
            accounts.push(new PublicKey("G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP"));
            accounts.push(new PublicKey("BWXT6RUhit9FfJQM3pBmqeFLPYmuxgmyhMGC5sGr8RbA"));
            accounts.push(new PublicKey("GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR"));
            accounts.push(coinCreatorVaultAta);
            accounts.push(coinCreatorVaultAuthority);
            accounts.push(new PublicKey("C2aFPdENg4A2HQsmrd5rTw5TaYBX5Ku887cWjbFKtZpw"));
            accounts.push(userVolumeAcc);
            accounts.push(new PublicKey("5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx"));
            accounts.push(new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"));
            return {accounts:accounts};
        }catch(e){
            console.log("Pumpswap accounts error...");
            return undefined;
        }
    }
    if(dex=="orcawp"){
        try{
            const ORCA_DUMMY_WALLET = new Wallet(Keypair.generate());
            const ctx = WhirlpoolContext.from(connection, ORCA_DUMMY_WALLET);
            const client = buildWhirlpoolClient(ctx);
            const poolState = await client.getPool(new PublicKey(poolAddress))
            const pool = poolState;
            const poolData = pool.getData();
            accounts.push(poolData.tokenMintA);
            accounts.push(new PublicKey(poolAddress));
            accounts.push(poolData.tokenVaultA)
            accounts.push(poolData.tokenVaultB);
            const tickCurrentIndex = poolData.tickCurrentIndex;
            const tickSpacing = poolData.tickSpacing;
            const programId = ctx.program.programId;
            const tickArrayPublicKeys = SwapUtils.getTickArrayPublicKeys(
                tickCurrentIndex,
                tickSpacing,
                true,
                programId,
                new PublicKey(poolAddress)
            );
            const tickArrayPublicKeys2 = SwapUtils.getTickArrayPublicKeys(
                tickCurrentIndex,
                tickSpacing,
                false,
                programId,
                new PublicKey(poolAddress)
            );
            if(tickArrayPublicKeys.length==1){
                tickArrayPublicKeys[1]=tickArrayPublicKeys[0]
                tickArrayPublicKeys[2]=tickArrayPublicKeys[0]
            }
            if(tickArrayPublicKeys.length==2){
                tickArrayPublicKeys[2]=tickArrayPublicKeys[1]
            }
            if(tickArrayPublicKeys2.length==1){
                tickArrayPublicKeys2[1]=tickArrayPublicKeys2[0]
                tickArrayPublicKeys2[2]=tickArrayPublicKeys2[0]
            }
            if(tickArrayPublicKeys2.length==2){
                tickArrayPublicKeys2[2]=tickArrayPublicKeys2[1]
            }
            if(tickArrayPublicKeys.length<3||tickArrayPublicKeys2.length<3){
                throw new Error("Not enough tick arrays found");
            }
            accounts.push(tickArrayPublicKeys[0]);
            accounts.push(tickArrayPublicKeys[1]);
            accounts.push(tickArrayPublicKeys[2]);
            accounts.push(tickArrayPublicKeys[1]);
            accounts.push(tickArrayPublicKeys[0]);
            accounts.push(tickArrayPublicKeys2[1]);
            const oraclePDA = PDAUtil.getOracle(programId, new PublicKey(poolAddress));
            accounts.push(oraclePDA.publicKey);
            accounts.push(new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"));

            return {accounts:accounts};
        }catch(e){
            // console.log(poolAddress, "Orcawp accounts error...", accounts, e);
            return undefined;
        }
    }
    if(dex=="dyn2"){
        try{
            const cpAmm = new CpAmm(connection);
            const poolState=await cpAmm.fetchPoolState(new PublicKey(poolAddress));
            const tokenAVault=poolState.tokenAVault;
            const tokenBVault=poolState.tokenBVault;
            const tokenAMint=poolState.tokenAMint;
            const tokenBMint=poolState.tokenBMint;
            accounts.push(tokenAMint)
            accounts.push(new PublicKey("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC"));
            accounts.push(new PublicKey(poolAddress));
            accounts.push(tokenAVault);
            accounts.push(tokenBVault);
            accounts.push(new PublicKey("3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet"));
            return {accounts:accounts};
        }catch(e){
            // console.log("Dyn2 accounts error...");
            return undefined;
        }
    }
    if(dex=="dlmm"){
        try{
            const dlmm=await DLMM.create(connection, new PublicKey(poolAddress));
            const binArrayBitmapExtension=PublicKey.findProgramAddressSync(
                [Buffer.from('bitmap'), new PublicKey(poolAddress).toBuffer()],
                new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo')
            )[0];
            const reserveX=dlmm.lbPair.reserveX;
            const reserveY=dlmm.lbPair.reserveY;
            const tokenXMint=dlmm.lbPair.tokenXMint
            const tokenYMint=dlmm.lbPair.tokenYMint;
            const oracle=dlmm.lbPair.oracle;
            const buy_binArrays=await dlmm.getBinArrayForSwap(true,6);
            const sell_binArrays=await dlmm.getBinArrayForSwap(false,6);
            if(buy_binArrays.length==0||sell_binArrays.length==0){
                throw new Error("Not enough bin arrays found");
            }
            if(buy_binArrays.length==1){
                buy_binArrays[1]=buy_binArrays[0];
                buy_binArrays[2]=buy_binArrays[0]
            }
            if(buy_binArrays.length==2){
                buy_binArrays[2]=buy_binArrays[1]
            }
            if(sell_binArrays.length==1){
                sell_binArrays[1]=sell_binArrays[0];
                sell_binArrays[2]=sell_binArrays[0]
            }
            if(sell_binArrays.length==2){
                sell_binArrays[2]=sell_binArrays[1]
            }

            accounts.push(tokenXMint);
            accounts.push(new PublicKey(poolAddress));
            accounts.push(new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"));
            accounts.push(reserveX);
            accounts.push(reserveY);
            accounts.push(oracle);
            accounts.push(new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"));
            accounts.push(new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"));
            accounts.push(new PublicKey("D1ZN9Wj1fRSUQfCjhvnu1hqDMT7hzjzBBpi12nVniYD6"));
            accounts.push(buy_binArrays[0].publicKey);
            accounts.push(buy_binArrays[1].publicKey);
            accounts.push(buy_binArrays[2].publicKey);
            accounts.push(sell_binArrays[0].publicKey);
            accounts.push(sell_binArrays[1].publicKey);
            accounts.push(sell_binArrays[2].publicKey);
            return {accounts:accounts};
        }catch(e){
            // console.log(poolAddress, "Dlmm accounts error...", accounts, e);
            return undefined;
        }
    }
    if(dex=="clmm"){
        try{
            if(raydium==undefined||raydium==null){
                raydium = await Raydium.load({ 
                  connection,
                  disableLoadToken: true, // Disable token list fetching
                  disableFeatureCheck: true, // Disable feature checks
                  apiRequestInterval: -1 // Never request API data again
                });
            }
            const { poolInfo, computePoolInfo, tickData } = await raydium.clmm.getPoolInfoFromRpc(poolAddress)
            const ammConfig=computePoolInfo.ammConfig.id;
            const XMint=computePoolInfo.mintA.address;
            const inputVault=getPdaPoolVaultId(new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"), new PublicKey(poolAddress), new PublicKey(computePoolInfo.mintA.address)).publicKey
            const outputVault=getPdaPoolVaultId(new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"), new PublicKey(poolAddress), new PublicKey(computePoolInfo.mintB.address)).publicKey
            const observationState=computePoolInfo.observationId;
            accounts.push(new PublicKey(XMint));
            accounts.push(ammConfig);
            accounts.push(new PublicKey(poolAddress));
            accounts.push(inputVault);
            accounts.push(outputVault);
            accounts.push(observationState);
            accounts.push(new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"));
            const currentStart = TickUtils.getTickArrayStartIndexByTick(
                computePoolInfo.tickCurrent,
                computePoolInfo.tickSpacing
            );
            const all_startIndexes=TickUtils.getAllInitializedTickArrayStartIndex(
                computePoolInfo.tickArrayBitmap,
                computePoolInfo.exBitmapInfo,
                computePoolInfo.tickSpacing
            );

            const current_start_index=all_startIndexes.indexOf(currentStart);
            let buy_tickArrays:PublicKey[]=[];
            let sell_tickArrays:PublicKey[]=[];
            if(current_start_index==-1){
                for(let i=0;i<all_startIndexes.length;i++){
                    if(all_startIndexes[i]>currentStart){
                        const key=getPdaTickArrayAddress(
                            computePoolInfo.programId,
                            new PublicKey(poolAddress),
                            all_startIndexes[i]
                        ).publicKey;
                        buy_tickArrays.push(key);
                        if(all_startIndexes[i+1]==undefined){
                            buy_tickArrays.push(key);
                            buy_tickArrays.push(key);
                        }else{
                            const key1=getPdaTickArrayAddress(
                                computePoolInfo.programId,
                                new PublicKey(poolAddress),
                                all_startIndexes[i+1]
                            ).publicKey;
                            buy_tickArrays.push(key1);
                            if(all_startIndexes[i+2]==undefined){
                                buy_tickArrays.push(key1);
                            }else{
                                const key2=getPdaTickArrayAddress(
                                    computePoolInfo.programId,
                                    new PublicKey(poolAddress),
                                    all_startIndexes[i+2]
                                ).publicKey;
                                buy_tickArrays.push(key2)
                            }
                        }
                        if(all_startIndexes[i-1]==undefined){
                            sell_tickArrays.push(key);
                            sell_tickArrays.push(key);
                            sell_tickArrays.push(key);
                        }else{
                            const key3=getPdaTickArrayAddress(
                                computePoolInfo.programId,
                                new PublicKey(poolAddress),
                                all_startIndexes[i-1]
                            ).publicKey;
                            sell_tickArrays.push(key3);
                            if(all_startIndexes[i-2]==undefined){
                                sell_tickArrays.push(key3);
                                sell_tickArrays.push(key3);
                            }else{
                                const key4=getPdaTickArrayAddress(
                                    computePoolInfo.programId,
                                    new PublicKey(poolAddress),
                                    all_startIndexes[i-2]
                                ).publicKey;
                                sell_tickArrays.push(key4);
                                if(all_startIndexes[i-3]==undefined){
                                    sell_tickArrays.push(key4);
                                }else{
                                    const key5=getPdaTickArrayAddress(
                                        computePoolInfo.programId,
                                        new PublicKey(poolAddress),
                                        all_startIndexes[i-3]
                                    ).publicKey;
                                    sell_tickArrays.push(key5);
                                }
                            }
                        }
                        break;
                    }

                }
            }else{
                const key=getPdaTickArrayAddress(
                    computePoolInfo.programId,
                    new PublicKey(poolAddress),
                    all_startIndexes[current_start_index]
                ).publicKey;
                buy_tickArrays.push(key);
                if(all_startIndexes[current_start_index+1]==undefined){
                    buy_tickArrays.push(key);
                    buy_tickArrays.push(key);
                }else{
                    const key1=getPdaTickArrayAddress(
                        computePoolInfo.programId,
                        new PublicKey(poolAddress),
                        all_startIndexes[current_start_index+1]
                    ).publicKey;
                    buy_tickArrays.push(key1);
                    if(all_startIndexes[current_start_index+2]==undefined){
                        buy_tickArrays.push(key1);
                    }else{
                        const key2=getPdaTickArrayAddress(
                            computePoolInfo.programId,
                            new PublicKey(poolAddress),
                            all_startIndexes[current_start_index+2]
                        ).publicKey;
                        buy_tickArrays.push(key2);
                    }
                }

                sell_tickArrays.push(key);
                if(all_startIndexes[current_start_index-1]==undefined){
                    sell_tickArrays.push(key);
                    sell_tickArrays.push(key);
                }else{
                    const key3=getPdaTickArrayAddress(
                        computePoolInfo.programId,
                        new PublicKey(poolAddress),
                        all_startIndexes[current_start_index-1]
                    ).publicKey;
                    sell_tickArrays.push(key3);
                    if(all_startIndexes[current_start_index-2]==undefined){
                        sell_tickArrays.push(key3);
                    }else{
                        const key4=getPdaTickArrayAddress(
                            computePoolInfo.programId,
                            new PublicKey(poolAddress),
                            all_startIndexes[current_start_index-2]
                        ).publicKey;
                        sell_tickArrays.push(key4);
                    }
                }
            }
            if(buy_tickArrays.length<3||sell_tickArrays.length<3){
                throw new Error("Not enough bin arrays found");
            }
            accounts.push(...buy_tickArrays, ...sell_tickArrays);
            return {accounts:accounts};
        }catch(e){
            // console.log("Clmm accounts error...", poolAddress);
            return undefined;
        }

    }
    if(dex=="cpmm"){
        try{
            const poolPubkey = new PublicKey(poolAddress);
            const accountInfo=await connection.getAccountInfo(poolPubkey)
            if(!accountInfo){
                console.log("Account not found", poolAddress, dex);
                return undefined;
            }
            const config_address = bs58.encode(accountInfo.data.slice(8, 8 + 32));
            // cpmm_accounts[poolAddress].push(new PublicKey(config_address));
            const  inputVault= bs58.encode(accountInfo.data.slice(72, 72 + 32));
            const  outputVault= bs58.encode(accountInfo.data.slice(104, 104 + 32));
            const observationState=bs58.encode(accountInfo.data.slice(296, 296 + 32));
            const XMint=bs58.encode(accountInfo.data.slice(168, 168 + 32));
            accounts.push(new PublicKey(XMint));
            accounts.push(new PublicKey("GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL"));
            accounts.push(new PublicKey(config_address));
            accounts.push(new PublicKey(poolAddress));
            accounts.push(new PublicKey(inputVault));
            accounts.push(new PublicKey(outputVault));
            accounts.push(new PublicKey(observationState));
            return {accounts:accounts};
        }catch(e){
            // console.log("Cpmm accounts error...");
            return undefined;
        }
    }
    if(dex=="raydium"){
        try{
            let accounts:PublicKey[]=[];
            
            const accountInfo=await connection.getAccountInfo(new PublicKey(poolAddress));
            if(!accountInfo){
                throw new Error("Fetching account error.");
            }
            const status=liquidityStateV4Layout.decode(accountInfo.data);
            accounts.push(status.baseMint);
            accounts.push(new PublicKey(poolAddress));
            accounts.push(new PublicKey("5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"));
            accounts.push(status.baseVault);
            accounts.push(status.quoteVault);
            return {accounts:accounts};
        }catch(e){
            return undefined;
        }
    }
}

function getUserVolumeAccumulatorPDA(userPubkey: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_volume_accumulator'), userPubkey.toBuffer()],
      PUMPFUN_AMM_PROGRAM_ID
    );
    return pda;
}