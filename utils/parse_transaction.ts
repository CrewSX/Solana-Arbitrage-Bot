import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { bondingCurvePda, PumpSdk  ,getBuyTokenAmountFromSolAmount, getBuySolAmountFromTokenAmount} from "@pump-fun/pump-sdk";
import bs58 from "bs58";
import { RPC_ENDPOINT } from "../constants";
const PUMP_FUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const pump_fun_fee_accounts=[
    "AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY",
    "9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz",
    "FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz",
    "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
    "7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ",
    "G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP",
    "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
]

export async function getParsedData(data:any, isLaunch:boolean, sdk:PumpSdk) {
    try{
        if(isLaunch==true){
            let keys=[""]
            data.transaction.transaction.transaction.message.accountKeys.map((account:any, index:number)=>{
                keys.push(bs58.encode(account));
            })
            keys.shift()
            const dev=keys[0];
            const mint=keys[1];
            const [pda] = PublicKey.findProgramAddressSync(
                [Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()],
                PUMP_FUN_PROGRAM
            );
            const bondingcurve_address=pda.toString();
            let fee_recipient=pump_fun_fee_accounts[4];
            for(const key of keys){
                if(pump_fun_fee_accounts.includes(key)){
                    fee_recipient=key;
                    break;
                }
            }
            let post_bondingcurve_vsol_balance=0;
            let post_bondingcurve_vtoken_balance=0;
            let post_trader_sol_balance=0;
            let post_trader_token_balance=0;
            let solAmount=0;
            let tokenAmount=0;
            data.transaction.transaction.transaction.message.accountKeys.map((account:any, index:number)=>{
                if(bs58.encode(account)==bondingcurve_address){
                    post_bondingcurve_vsol_balance=Number(data.transaction.transaction.meta.postBalances[index])+30*LAMPORTS_PER_SOL;
                }
                if(bs58.encode(account)==dev){
                    post_trader_sol_balance=Number(data.transaction.transaction.meta.postBalances[index]);
                    solAmount=Number(data.transaction.transaction.meta.preBalances[index])-Number(data.transaction.transaction.meta.postBalances[index]);
                    
                }
            })
            data.transaction.transaction.meta.postTokenBalances.map((post:any)=>{
                if(post.owner==bondingcurve_address){
                    post_bondingcurve_vtoken_balance=Number(post["uiTokenAmount"]["amount"]);
                }
                if(post.owner==dev){
                    post_trader_token_balance=Number(post["uiTokenAmount"]["amount"]);
                    tokenAmount=post_trader_token_balance;
                }
            })
            const price=post_bondingcurve_vsol_balance/post_bondingcurve_vtoken_balance;
            const sol_price=post_bondingcurve_vtoken_balance/post_bondingcurve_vsol_balance;
            const creatorVault=await sdk.creatorVaultPda(new PublicKey(dev));
            return{
                mint,
                dev,
                bondingcurve_address,
                fee_recipient, 
                post_bondingcurve_vsol_balance,
                post_bondingcurve_vtoken_balance,
                post_trader_sol_balance,
                post_trader_token_balance,
                price,
                sol_price,
                solAmount,
                tokenAmount,
                creatorVault,
                keys
            };
        }else{
            try{

                let keys=[""]
                data.transaction.transaction.transaction.message.accountKeys.map((account:any, index:number)=>{
                    keys.push(bs58.encode(account));
                })
                keys.shift()
        
                const dev=keys[0];
                let mint="";
                const post_datas= data.transaction.transaction.meta.postTokenBalances;
                for(const post_data of post_datas){
                    if(post_data["mint"]!="So11111111111111111111111111111111111111112"){
                        mint=post_data["mint"];
                        break;
                    }
                }
                let bonding_curve;
                let creatorVault
                let count=0;
                // while(true){
                //     try{
                //         bonding_curve=await sdk.fetchBondingCurve(new PublicKey(mint));
                //         const creator=bonding_curve.creator.toString();
                //         creatorVault=await sdk.creatorVaultPda(new PublicKey(creator));
                //         break;
                //     }catch(e){
                //         console.log("waiting account data...")
                //         await new Promise((resolve)=>setTimeout(resolve, 300));
                //     }
                //     count++;
                //     if(count==10) break;
                // }
                bonding_curve=await sdk.fetchBondingCurve(new PublicKey(mint));
                const creator=bonding_curve.creator.toString();
                creatorVault=await sdk.creatorVaultPda(new PublicKey(creator));
                const [pda] = PublicKey.findProgramAddressSync(
                    [Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()],
                    PUMP_FUN_PROGRAM
                );
                const bondingcurve_address=pda.toString();
                let fee_recipient=pump_fun_fee_accounts[4];
                for(const key of keys){
                    if(pump_fun_fee_accounts.includes(key)){
                        fee_recipient=key;
                        break;
                    }
                }
                let post_bondingcurve_vsol_balance = bonding_curve ? bonding_curve.virtualSolReserves.toNumber() : 0;
                let post_bondingcurve_vtoken_balance = bonding_curve ? bonding_curve.virtualTokenReserves.toNumber() : 0;
                let post_trader_sol_balance = 0;
                let post_trader_token_balance = 0;
                let solAmount = 0;
                let tokenAmount = 0;
                data.transaction.transaction.transaction.message.accountKeys.map((account:any, index:number)=>{
                    // if(bs58.encode(account)==bondingcurve_address){
                    //     post_bondingcurve_vsol_balance=Number(data.transaction.transaction.meta.postBalances[index])+30*LAMPORTS_PER_SOL;
                    // }
                    if(bs58.encode(account)==dev){
                        post_trader_sol_balance=Number(data.transaction.transaction.meta.postBalances[index]);
                        solAmount=Number(data.transaction.transaction.meta.preBalances[index])-Number(data.transaction.transaction.meta.postBalances[index]);
                        
                    }
                })
                data.transaction.transaction.meta.postTokenBalances.map((post:any, index:number)=>{
                    // if(post.owner==bondingcurve_address){
                    //     post_bondingcurve_vtoken_balance=Number(post["uiTokenAmount"]["amount"]);
                    // }
                    if(post.owner==dev){
                        post_trader_token_balance=Number(post["uiTokenAmount"]["amount"]);
                        if(data.transaction.transaction.meta.preTokenBalances[index]!=undefined){
                            tokenAmount=post_trader_token_balance-Number(data.transaction.transaction.meta.preTokenBalances[index]["uiTokenAmount"]["amount"]);
                        }else{
                            tokenAmount=post_trader_token_balance
                        }
                        
                    }
                })
                const price=post_bondingcurve_vsol_balance/post_bondingcurve_vtoken_balance;
                const sol_price=post_bondingcurve_vtoken_balance/post_bondingcurve_vsol_balance;
                return{
                    mint,
                    dev,
                    bondingcurve_address,
                    fee_recipient, 
                    post_bondingcurve_vsol_balance,
                    post_bondingcurve_vtoken_balance,
                    post_trader_sol_balance,
                    post_trader_token_balance,
                    price,
                    sol_price,
                    solAmount,
                    tokenAmount,
                    creatorVault,
                    keys
                };
            }catch(e){
                // console.log(e);
            }
        }
    }catch(e){
        
    }
}


