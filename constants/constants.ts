import { Commitment } from "@solana/web3.js";
import { logger, retrieveEnvVariable } from "../utils";

export const COMMITMENT_LEVEL: Commitment = retrieveEnvVariable('COMMITMENT_LEVEL', logger) as Commitment;
export const RPC_ENDPOINT = retrieveEnvVariable('RPC_ENDPOINT', logger);
export const SWQOS_ENDPOINT = retrieveEnvVariable('SWQOS_ENDPOINT', logger);
export const GRPC_ENDPOINT = retrieveEnvVariable('GRPC_ENDPOINT', logger);
export const API_KEY = retrieveEnvVariable('API_KEY', logger);
export const X_API_KEY = retrieveEnvVariable('X_API_KEY', logger);

export const PRIVATE_KEY = retrieveEnvVariable('PRIVATE_KEY', logger);
export const QUOTE_AMOUNT = Number(retrieveEnvVariable('QUOTE_AMOUNT', logger));


export const SLIPPAGE = Number(retrieveEnvVariable('SLIPPAGE', logger));
export const PRICE_DIFFERENCE_PERCENTAGE = Number(retrieveEnvVariable('PRICE_DIFFERENCE_PERCENTAGE', logger));

export const TELEGRAM_BOT_TOKEN = retrieveEnvVariable('TELEGRAM_BOT_TOKEN', logger);
export const TELEGRAM_CHAT_ID = retrieveEnvVariable(`TELEGRAM_CHAT_ID`, logger);


export const BLOCK_ENGINE_URL = retrieveEnvVariable(`BLOCK_ENGINE_URL`, logger);
export const ISJITO = retrieveEnvVariable(`ISJITO`, logger);