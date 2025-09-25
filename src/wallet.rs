use crate::error::{BotError, Result};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    pubkey::Pubkey,
    signature::{Keypair, Signature},
    signer::Signer,
    transaction::Transaction,
};
use spl_token::instruction as token_instruction;
use std::str::FromStr;

#[derive(Clone)]
pub struct WalletManager {
    keypair: Keypair,
    rpc_client: RpcClient,
    wallet_address: Pubkey,
}

impl WalletManager {
    pub fn new(keypair: Keypair, rpc_url: String) -> Self {
        let rpc_client = RpcClient::new_with_commitment(rpc_url, CommitmentConfig::confirmed());
        let wallet_address = keypair.pubkey();
        
        Self {
            keypair,
            rpc_client,
            wallet_address,
        }
    }
    
    pub fn from_file(path: &str) -> Result<Self> {
        let keypair = Keypair::read_from_file(path)
            .map_err(|e| BotError::Wallet(format!("Failed to read wallet file: {}", e)))?;
        
        // Default to mainnet RPC
        let rpc_url = "https://api.mainnet-beta.solana.com".to_string();
        Ok(Self::new(keypair, rpc_url))
    }
    
    pub fn generate_new() -> Result<Self> {
        let keypair = Keypair::new();
        let rpc_url = "https://api.mainnet-beta.solana.com".to_string();
        Ok(Self::new(keypair, rpc_url))
    }
    
    pub fn get_address(&self) -> Pubkey {
        self.wallet_address
    }
    
    pub async fn get_balance(&self) -> Result<u64> {
        self.rpc_client
            .get_balance(&self.wallet_address)
            .await
            .map_err(|e| BotError::SolanaClient(e))
    }
    
    pub async fn get_token_balance(&self, token_mint: &Pubkey) -> Result<u64> {
        let token_accounts = self.rpc_client
            .get_token_accounts_by_owner(
                &self.wallet_address,
                solana_client::rpc_request::TokenAccountsFilter::Mint(*token_mint),
            )
            .await
            .map_err(|e| BotError::SolanaClient(e))?;
            
        if token_accounts.is_empty() {
            return Ok(0);
        }
        
        let account_info = self.rpc_client
            .get_token_account_balance(&token_accounts[0].pubkey)
            .await
            .map_err(|e| BotError::SolanaClient(e))?;
            
        Ok(account_info.amount.parse::<u64>()
            .map_err(|e| BotError::Wallet(format!("Failed to parse token balance: {}", e)))?)
    }
    
    pub async fn create_token_account(&self, token_mint: &Pubkey) -> Result<Pubkey> {
        let token_account = Keypair::new();
        let rent = self.rpc_client
            .get_minimum_balance_for_rent_exemption(spl_token::state::Account::LEN)
            .await
            .map_err(|e| BotError::SolanaClient(e))?;
            
        let create_account_ix = solana_sdk::system_instruction::create_account(
            &self.wallet_address,
            &token_account.pubkey(),
            rent,
            spl_token::state::Account::LEN as u64,
            &spl_token::id(),
        );
        
        let initialize_account_ix = token_instruction::initialize_account(
            &spl_token::id(),
            &token_account.pubkey(),
            token_mint,
            &self.wallet_address,
        )?;
        
        let recent_blockhash = self.rpc_client
            .get_latest_blockhash()
            .await
            .map_err(|e| BotError::SolanaClient(e))?;
            
        let transaction = Transaction::new_signed_with_payer(
            &[create_account_ix, initialize_account_ix],
            Some(&self.wallet_address),
            &[&self.keypair, &token_account],
            recent_blockhash,
        );
        
        self.rpc_client
            .send_and_confirm_transaction(&transaction)
            .await
            .map_err(|e| BotError::TransactionFailed(format!("Failed to create token account: {}", e)))?;
            
        Ok(token_account.pubkey())
    }
    
    pub async fn sign_and_send_transaction(&self, transaction: Transaction) -> Result<Signature> {
        let signature = self.rpc_client
            .send_and_confirm_transaction(&transaction)
            .await
            .map_err(|e| BotError::TransactionFailed(format!("Transaction failed: {}", e)))?;
            
        Ok(signature)
    }
    
    pub fn get_keypair(&self) -> &Keypair {
        &self.keypair
    }
    
    pub fn get_rpc_client(&self) -> &RpcClient {
        &self.rpc_client
    }
    
    pub async fn get_recent_blockhash(&self) -> Result<solana_sdk::hash::Hash> {
        self.rpc_client
            .get_latest_blockhash()
            .await
            .map_err(|e| BotError::SolanaClient(e))
    }
    
    pub async fn estimate_transaction_fee(&self, transaction: &Transaction) -> Result<u64> {
        self.rpc_client
            .get_fee_for_message(&transaction.message)
            .await
            .map_err(|e| BotError::SolanaClient(e))
    }
}
