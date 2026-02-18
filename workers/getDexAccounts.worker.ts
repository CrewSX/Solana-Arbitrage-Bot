/**
 * Worker thread: runs getDexAccounts for many pairs so the main thread (gRPC) is not blocked.
 * Receives: { rpcEndpoint, walletSecretKeyBase58, tasks: [{ accountKey, dex, poolAddress }] }
 * Sends back: { results: [{ accountKey, accounts: string[] | undefined }] } (pubkeys as base58)
 */

import { parentPort } from "worker_threads";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getDexAccounts } from "../utils/getDexAccounts";

export type DexAccountsTask = { accountKey: string; dex: string; poolAddress: string };

export type WorkerPayload = {
  rpcEndpoint: string;
  walletSecretKeyBase58: string;
  tasks: DexAccountsTask[];
};

export type WorkerResult = {
  results: { accountKey: string; accounts: string[] | undefined }[];
};

if (!parentPort) throw new Error("Must run as worker");

parentPort.on("message", async (msg: WorkerPayload) => {
  const { rpcEndpoint, walletSecretKeyBase58, tasks } = msg;
  const connection = new Connection(rpcEndpoint, "confirmed");
  const wallet = Keypair.fromSecretKey(bs58.decode(walletSecretKeyBase58));

  const results: { accountKey: string; accounts: string[] | undefined }[] = [];

  for (const task of tasks) {
    try {
      const out = await getDexAccounts(
        task.dex,
        task.poolAddress,
        connection,
        wallet
      );
      results.push({
        accountKey: task.accountKey,
        accounts: out?.accounts?.map((p: PublicKey) => p.toBase58()),
      });
    } catch (e) {
      results.push({ accountKey: task.accountKey, accounts: undefined });
    }
  }

  parentPort!.postMessage({ results } as WorkerResult);
});
