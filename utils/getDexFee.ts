import BN from "bn.js";
import { PoolReserves } from "./swap_calculations";
import { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import bs58 from "bs58";
import { getTotalFee , decodeAccount, createProgram} from "@meteora-ag/dlmm";
import {TradeDirection,  getMaxFeeNumerator, getBaseFeeHandler, getTotalTradingFeeFromExcludedFeeAmount, PoolFeesStruct} from "@meteora-ag/cp-amm-sdk";
import {} from '@orca-so/whirlpools-sdk';

import {  } from "@orca-so/whirlpools-sdk";
export async function getDexFee(
    connection:Connection,
    params:{
        dex:string,
        poolAddress:string,
        poolData:Buffer,
        poolReserves:PoolReserves,
        sig:string,
        // inputAmount:BN,
        // aTob:number, 
        // slot:BN,
        // blockTime:BN
    }
){
    if(params.dex=="pumpswap"){
        const spot_price=Number(params.poolReserves.reserveB)/Number(params.poolReserves.reserveA)*Math.pow(10,params.poolReserves.decimalA-params.poolReserves.decimalB);
        const mc=spot_price*1000000000;
        let feeRate=0;
        if(mc>=0&&mc<420){
            feeRate=1.25;
        }else if(mc>=420&&mc<1470){
            feeRate=1.2;
        }else if(mc>=1470&&mc<2460){
            feeRate=1.15;
        }else if(mc>=2460&&mc<3440){
            feeRate=1.1;
        }else if(mc>=3440&&mc<4420){
            feeRate=1.05;
        }else if(mc>=4420&&mc<9820){
            feeRate=1;
        }else if(mc>=9820&&mc<14740){
            feeRate=0.95;
        }else if(mc>=14740&&mc<19650){
            feeRate=0.9;
        }else if(mc>=19650&&mc<24560){
            feeRate=0.85;
        }else if(mc>=24560&&mc<29470){
            feeRate=0.8;
        }else if(mc>=29470&&mc<34380){
            feeRate=0.75;
        }else if(mc>=34380&&mc<39300){
            feeRate=0.7;
        }else if(mc>=39300&&mc<44210){
            feeRate=0.65;
        }else if(mc>=44210&&mc<49120){
            feeRate=0.6;
        }else if(mc>=49120&&mc<54030){
            feeRate=0.55;
        }else if(mc>=54030&&mc<58940){
            feeRate=0.525;
        }else if(mc>=58940&&mc<63860){
            feeRate=0.5;
        }else if(mc>=63860&&mc<68770){
            feeRate=0.475;
        }else if(mc>=68770&&mc<73681){
            feeRate=0.45;
        }else if(mc>=73681&&mc<78590){
            feeRate=0.425;
        }else if(mc>=78590&&mc<83500){
            feeRate=0.4;
        }else if(mc>=83500&&mc<88400){
            feeRate=0.375;
        }else if(mc>=88400&&mc<93330){
            feeRate=0.35;
        }else if(mc>=93330&&mc<98240){
            feeRate=0.325;
        }else if(mc>=98240){
            feeRate=0.3;
        }
        return feeRate;
    }
    if(params.dex=="raydium"){
        return 0.25;
    }
    let cpmm_fees: Record<string, number> = {};
    if(params.dex=="cpmm"){
        try{
            if(!cpmm_fees[params.poolAddress]){
                const accountInfo=await connection.getAccountInfo(new PublicKey(params.poolAddress));
                if(!accountInfo){
                  throw new Error('Pool account not found');
                }
                const config_address = bs58.encode(Uint8Array.from(accountInfo.data.slice(8, 8 + 32)));
                const config_accountInfo=await connection.getAccountInfo(new PublicKey(config_address))
                if(!config_accountInfo){
                  throw new Error('Config account not found');
                }
                const feeRate = config_accountInfo.data.slice(12, 12+8).reverse().toString('hex');
                cpmm_fees[params.poolAddress] = parseInt(feeRate, 16)/10000;
            }
            return cpmm_fees[params.poolAddress];
        }catch(e){
            console.log("Error during calculating cpmm pool fee");
            return 4;
        }
    }
    let clmm_fees: Record<string, number> = {};
    if(params.dex=="clmm"){
        try{
            if(!clmm_fees[params.poolAddress]){
                const config_address = bs58.encode(Uint8Array.from(params.poolData.slice(9, 9 + 32)));
                const config_accountInfo=await connection.getAccountInfo(new PublicKey(config_address))
                if(!config_accountInfo){
                  throw new Error('Config account not found');
                }
                const feeRate = config_accountInfo.data.slice(47, 47+4).reverse().toString('hex');
                clmm_fees[params.poolAddress] = parseInt(feeRate, 16)/10000;
            }
            return clmm_fees[params.poolAddress];
        }catch(e){
            console.log("Error during calculating clmm pool fee");
            return 4;
        }
    }
    if(params.dex=="dlmm"){
        try{
            const bin_step =new BN(params.poolData.slice(80, 80+2).reverse()).toNumber();
            const dlmmProgram = createProgram(connection);
            const pair_info = decodeAccount(dlmmProgram, "lbPair", params.poolData);
            if (pair_info && 'parameters' in pair_info && 'vParameters' in pair_info) {
                const fee = getTotalFee(bin_step, pair_info.parameters, pair_info.vParameters);
                return Number(fee)/1000000000*100;
            } else {
                throw new Error("DLMM pair_info does not have expected parameters/vParameters");
            }
        } catch (e) {
            console.log("Error during calculating dlmm pool fee");
            return 10;
        }
    }
    // if(params.dex=="dyn2"){
    //     try{
    //         let poolFees: PoolFeesStruct = {
    //             baseFee: {
    //                 baseFeeInfo: {
    //                     data: [],
    //                 },
    //                 padding1: new BN(0),
    //             },
    //             protocolFeePercent: 0,
    //             partnerFeePercent: 0,
    //             referralFeePercent: 0,
    //             padding0: [],
    //             dynamicFee: {
    //                 initialized: 0,
    //                 padding: [],
    //                 maxVolatilityAccumulator: 0,
    //                 variableFeeControl: 0,
    //                 binStep: 0,
    //                 filterPeriod: 0,
    //                 decayPeriod: 0,
    //                 reductionFactor: 0,
    //                 lastUpdateTimestamp:new BN(0),
    //                 binStepU128:new BN(0),
    //                 sqrtPriceReference: new BN(0),
    //                 volatilityAccumulator: new BN(0),
    //                 volatilityReference: new BN(0),
    //             },
    //             initSqrtPrice: new BN(0)
    //         }
    //         poolFees.baseFee.baseFeeInfo.data = [...params.poolData.slice(8, 8 + 32)];
    //         poolFees.baseFee.padding1=new BN(params.poolData.slice(40,40+8).reverse());
    //         poolFees.protocolFeePercent=Number(params.poolData.slice(48,48+1));
    //         poolFees.partnerFeePercent=Number(params.poolData.slice(49,49+1));
    //         poolFees.referralFeePercent=Number(params.poolData.slice(50,50+1));
    //         poolFees.padding0=[...params.poolData.slice(51,51+5)];
    //         poolFees.dynamicFee.initialized=Number(params.poolData.slice(56,56+1));
    //         poolFees.dynamicFee.padding=[...params.poolData.slice(57,57+7)];
    //         poolFees.dynamicFee.maxVolatilityAccumulator=Number(params.poolData.slice(64,64+4).reverse());
    //         poolFees.dynamicFee.variableFeeControl=Number(params.poolData.slice(68,68+4).reverse());
    //         poolFees.dynamicFee.binStep=Number(params.poolData.slice(72,72+2).reverse());
    //         poolFees.dynamicFee.filterPeriod=Number(params.poolData.slice(74,74+2).reverse());
    //         poolFees.dynamicFee.decayPeriod=Number(params.poolData.slice(76,76+2).reverse());
    //         poolFees.dynamicFee.reductionFactor=Number(params.poolData.slice(78,78+2).reverse());
    //         poolFees.dynamicFee.lastUpdateTimestamp=new BN(params.poolData.slice(80,80+8).reverse());
    //         poolFees.dynamicFee.binStepU128=new BN(params.poolData.slice(88,88+16).reverse());
    //         poolFees.dynamicFee.sqrtPriceReference=new BN(params.poolData.slice(104,104+16).reverse());
    //         poolFees.dynamicFee.volatilityAccumulator=new BN(params.poolData.slice(120,120+16).reverse());
    //         poolFees.dynamicFee.volatilityReference=new BN(params.poolData.slice(136,136+16).reverse());
    //         poolFees.initSqrtPrice=new BN(params.poolData.slice(152,152+16).reverse());
    //         const activationPoint=new BN(params.poolData.slice(472, 472+8).reverse());
    //         const activationType=Number(params.poolData.slice(480,480+1));
    //         const poolVersion=Number(params.poolData.slice(486,486+1));
    //         const maxFeeNumerator=getMaxFeeNumerator(poolVersion);
    //         const currentSqrtPrice=new BN(params.poolData.slice(456, 456+16).reverse())
    //         let currentPoint=new BN(0);
    //         if(activationType==0){
    //             currentPoint=params.slot;
    //         }else{
    //             currentPoint=params.blockTime;
    //         }
    //         const fee=getTotalTradingFeeFromExcludedFeeAmount(poolFees , currentPoint, activationPoint, params.inputAmount, params.aTob, maxFeeNumerator, poolFees.initSqrtPrice, currentSqrtPrice );
    //         return fee;
    //     }catch(e){
    //         console.log("Error during calculating dyn2 pool fee");
    //         return 6;
    //     }
    // }
    if(params.dex=="orcawp"){
        try{
            const fee=new BN(params.poolData.slice(45,45+2).reverse()).toNumber()/10000;
            return fee;
        }catch(e){
            console.log("Error during calculating orcawp pool fee");
            return 2
        }
    }
}

