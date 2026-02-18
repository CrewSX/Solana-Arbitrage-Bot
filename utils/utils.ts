import { Logger } from 'pino';
import dotenv from 'dotenv';
import { PublicKey, Transaction, SystemProgram, Keypair , AddressLookupTableProgram, TransactionMessage, VersionedTransaction, sendAndConfirmRawTransaction} from '@solana/web3.js';
import { Connection } from '@solana/web3.js';
import BN from 'bn.js';
import { publicKey } from '@raydium-io/raydium-sdk-v2';
import { ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID as SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, } from '@solana/spl-token';

dotenv.config();
import fs from "fs";
import { logger } from './logger';

export const retrieveEnvVariable = (variableName: string, logger: Logger) => {
  const variable = process.env[variableName] || '';
  if (!variable) {
    logger.error(`${variableName} is not set`);
    process.exit(1);
  }
  return variable;
};

async function estimateTransferFee(senderPubkey: PublicKey, receiverPubkey: PublicKey, solanaConnection:Connection) {
  try {
    const transaction = new Transaction();

    transaction.add(
      SystemProgram.transfer({
        fromPubkey: senderPubkey,
        toPubkey: receiverPubkey,
        lamports: 1000 
      })
    );

    const { blockhash } = await solanaConnection.getLatestBlockhash();

    transaction.recentBlockhash = blockhash;
    transaction.feePayer = senderPubkey;

    const feeResult = await solanaConnection.getFeeForMessage(
      transaction.compileMessage(),
      'confirmed'
    );

    if (!feeResult.value) {
      throw new Error("Could not estimate transaction fee");
    }
    return feeResult.value;
  } catch (error) {
    console.error('Error estimating transfer fee:', error);
    return BigInt(10); 
  }
}


export async function transferSOL(senderWallet: Keypair, receiverWallet: PublicKey, solanaConnection:Connection, amount:number): Promise<void> {
    try {
      const senderBalance = await solanaConnection.getBalance(senderWallet.publicKey);
      if (senderBalance > amount) {
          const transaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: senderWallet.publicKey,
              toPubkey: receiverWallet,
              lamports: amount
            })
          );

          const signature = await solanaConnection.sendTransaction(transaction, [senderWallet], {
            skipPreflight: false, preflightCommitment: 'confirmed', maxRetries:10
          });

      } else {
        console.log('Sender balance->', senderBalance);
        console.log('Sender balance->', amount);
      }
    } catch (error) {
      console.log(error)
    }
}
export async function delay(duration: number) {
    await new Promise((resolve) => setTimeout(resolve, duration));
}



export async function createATA(
  mint: PublicKey,
  payer: Keypair,
  connection: Connection,
) {
  try {
    
    const mintInfo = await connection.getAccountInfo(mint);
    if (!mintInfo) throw new Error('Mint account not found');

    const tokenProgramId = mintInfo.owner;
    const isToken2022 = tokenProgramId.equals(TOKEN_2022_PROGRAM_ID);
    const isStandardToken = tokenProgramId.equals(TOKEN_PROGRAM_ID);

    if (!isStandardToken && !isToken2022) {
      throw new Error(`Unsupported token program: ${tokenProgramId.toBase58()}`);
    }

    const userATA = getAssociatedTokenAddressSync(
      mint,
      payer.publicKey,
      false,
      tokenProgramId,              
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ); 

    const aTAAccountInfo = await connection.getAccountInfo(userATA);
    if (aTAAccountInfo) return isToken2022;

    const setupInstructions = [];

    setupInstructions.push(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,          
        userATA,                  
        payer.publicKey,         
        mint,                    
        tokenProgramId,           
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );

    if (mint.equals(NATIVE_MINT) && isStandardToken) {
      setupInstructions.push(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: userATA,
          lamports: 1000000000,
        }),
        createSyncNativeInstruction(
          userATA,
          TOKEN_PROGRAM_ID,       
        ),
      );
    }

    if (setupInstructions.length > 0) {
      const { blockhash } = await connection.getLatestBlockhash('finalized');
      const message = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions: setupInstructions,
      }).compileToV0Message();

      const setupTx = new VersionedTransaction(message);
      setupTx.sign([payer]);
      // logger.info("aaa");
      await sendAndConfirmRawTransaction(connection, Buffer.from(setupTx.serialize()), {skipPreflight:true});
      // logger.info("bbb")
      await connection.sendTransaction(setupTx, { skipPreflight: true });
      console.log(`✅ Token account created. mint->${mint}, ata->${userATA}\n`);
    }

    return isToken2022;
  } catch (e) {
    console.log('createATA error:', e);
    return false;
  }
}

export async function createALT(payer: Keypair, connection:Connection): Promise<PublicKey> {
  console.log('📋 Creating Address Lookup Table...\n');
  
  const slot = await connection.getSlot('finalized');
  const [lookupTableInst, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });
  
  console.log(`ALT Address: ${lookupTableAddress.toBase58()}`);
  const tokensRaws = fs
  .readFileSync("alts.txt", "utf8")
  .split(/\r?\n/);
  let addressesToAdd: PublicKey[]=[];
  tokensRaws.map((accountKey)=>{
    addressesToAdd.push(new PublicKey(accountKey));
  })
  // Collect all frequently used accounts
  
  console.log(`Adding ${addressesToAdd.length} addresses to ALT...\n`);
  
  // Create the lookup table first
  let { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  let messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [lookupTableInst],
  }).compileToV0Message();
  
  let transaction = new VersionedTransaction(messageV0);
  transaction.sign([payer]);
  
  let signature = await connection.sendTransaction(transaction);
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
  
  console.log(`✅ ALT created: ${signature}`);
  
  // Extend in batches of 20 addresses
  const batchSize = 20;
  for (let i = 0; i < addressesToAdd.length; i += batchSize) {
    const batch = addressesToAdd.slice(i, Math.min(i + batchSize, addressesToAdd.length));
    
    const extendInstruction = AddressLookupTableProgram.extendLookupTable({
      payer: payer.publicKey,
      authority: payer.publicKey,
      lookupTable: lookupTableAddress,
      addresses: batch,
    });
    
    ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash());
    messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [extendInstruction],
    }).compileToV0Message();
    
    transaction = new VersionedTransaction(messageV0);
    transaction.sign([payer]);
    
    signature = await connection.sendTransaction(transaction);
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
    
    console.log(`✅ Added batch ${Math.floor(i / batchSize) + 1}: ${batch.length} addresses`);
  }
  
  console.log(`\n✅ ALT fully populated\n`);
  
  // Wait for ALT to be usable
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return lookupTableAddress;
}