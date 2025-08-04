import {
  IcpayConfig,
  CreateTransactionRequest,
  TransactionResponse,
  TransactionStatus,
  AccountInfo,
  StoreConfig,
  BusinessAccount,
  VerifiedLedger,
  PaymentRequest,
  WalletConnectionResult,
  CanisterInfo
} from './types';
import { IcpayError } from './errors';
import { IcpayWallet } from './wallet';
import axios, { AxiosInstance } from 'axios';
import { HttpAgent, Actor } from '@dfinity/agent';
import { idlFactory as icpayIdl } from './declarations/icpay_canister_backend/icpay_canister_backend.did.js';
import { idlFactory as ledgerIdl } from './declarations/icrc-ledger/ledger.did.js';
import { Principal } from '@dfinity/principal';
import { toAccountIdentifier } from './utils'; // We'll add this helper

export class Icpay {
  private config: IcpayConfig;
  private wallet: IcpayWallet;
  private apiClient: AxiosInstance;
  private canisterInfo: CanisterInfo | null = null;
  private externalWallet: any = null;
  private usePlugNPlay: boolean = false;
  private plugNPlayConfig: Record<string, any> = {};
  private icHost: string;
  private actorProvider?: (canisterId: string, idl: any) => any;
  private icpayCanisterId: string | null = null;
  private accountInfoCache: any = null;

  constructor(config: IcpayConfig) {
    this.config = {
      environment: 'production',
      apiUrl: 'https://api.icpay.com',
      ...config
    };

    this.icHost = config.icHost || 'https://ic0.app';
    this.externalWallet = config.externalWallet || null;
    this.usePlugNPlay = !!config.usePlugNPlay;
    this.plugNPlayConfig = config.plugNPlayConfig || {};
    this.actorProvider = config.actorProvider;

    if (this.externalWallet) {
      this.wallet = new IcpayWallet({ externalWallet: this.externalWallet.account });
    } else if (this.usePlugNPlay) {
      this.wallet = new IcpayWallet({ usePlugNPlay: true, plugNPlayConfig: this.plugNPlayConfig });
    } else {
      this.wallet = new IcpayWallet();
    }

    this.apiClient = axios.create({
      baseURL: this.config.apiUrl,
      headers: {
        'Authorization': `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/json',
        'X-Account-ID': this.config.accountId
      }
    });
  }

  /**
   * Get account information
   */
  async getAccountInfo(): Promise<AccountInfo> {
    try {
      const response = await this.apiClient.get('/sdk/account');
      const account = response.data;

      return {
        id: account.id,
        name: account.name,
        email: account.email,
        isActive: account.isActive,
        isLive: account.isLive,
        accountCanisterId: account.accountCanisterId,
        walletAddress: account.walletAddress,
        walletBalance: account.walletBalance,
        walletCurrency: account.walletCurrency,
        createdAt: new Date(account.createdAt),
        updatedAt: new Date(account.updatedAt)
      };
    } catch (error) {
      throw new IcpayError({
        code: 'ACCOUNT_INFO_FETCH_FAILED',
        message: 'Failed to fetch account information',
        details: error
      });
    }
  }

  /**
   * Get verified ledgers
   */
  async getVerifiedLedgers(): Promise<VerifiedLedger[]> {
    try {
      const response = await this.apiClient.get('/sdk/ledgers/verified');
      return response.data.map((ledger: any) => ({
        id: ledger.id,
        name: ledger.name,
        symbol: ledger.symbol,
        canisterId: ledger.canisterId,
        standard: ledger.standard,
        decimals: ledger.decimals,
        logoUrl: ledger.logoUrl,
        supportsNotify: ledger.supportsNotify,
        notifyMethod: ledger.notifyMethod,
        verified: ledger.verified,
        fee: ledger.fee,
        network: ledger.network,
        description: ledger.description,
        createdAt: new Date(ledger.createdAt),
        updatedAt: new Date(ledger.updatedAt)
      }));
    } catch (error) {
      throw new IcpayError({
        code: 'VERIFIED_LEDGERS_FETCH_FAILED',
        message: 'Failed to fetch verified ledgers',
        details: error
      });
    }
  }

  /**
   * Get transaction status by canister transaction ID
   */
  async getTransactionStatus(canisterTransactionId: string): Promise<TransactionStatus> {
    try {
      const response = await this.apiClient.get(`/sdk/transactions/${canisterTransactionId}/status`);
      return {
        transactionId: canisterTransactionId,
        status: response.data.status,
        blockHeight: response.data.blockHeight,
        timestamp: new Date(),
        error: response.data.error
      };
    } catch (error) {
      throw new IcpayError({
        code: 'TRANSACTION_STATUS_FETCH_FAILED',
        message: 'Failed to fetch transaction status',
        details: error
      });
    }
  }

  /**
   * Fetch and cache /sdk/account info, including icpay_canister_backend
   */
  private async fetchAccountInfo(): Promise<any> {
    if (this.accountInfoCache) {
      return this.accountInfoCache;
    }
    const response = await this.apiClient.get('/sdk/account');
    this.accountInfoCache = response.data;
    if (response.data && response.data.icpay_canister_backend) {
      this.icpayCanisterId = response.data.icpay_canister_backend.toString();
    }
    return this.accountInfoCache;
  }

  /**
   * Get canister information from the API (not mock data)
   */
  async getCanisterInfo(): Promise<CanisterInfo> {
    if (this.canisterInfo) {
      return this.canisterInfo;
    }
    try {
      await this.fetchAccountInfo();
      if (!this.icpayCanisterId) {
        throw new Error('Could not fetch icpay_canister_backend from API');
      }
      this.canisterInfo = {
        canisterId: this.icpayCanisterId,
        name: this.accountInfoCache.name || 'ICPay Canister',
        description: this.accountInfoCache.description || 'ICPay payment processing canister',
      };
      return this.canisterInfo;
    } catch (error) {
      throw new IcpayError({
        code: 'CANISTER_INFO_FETCH_FAILED',
        message: 'Failed to fetch canister information',
        details: error
      });
    }
  }

  /**
   * Show wallet connection modal
   */
  async showWalletModal(): Promise<WalletConnectionResult> {
    return await this.wallet.showConnectionModal();
  }

  /**
   * Connect to a specific wallet provider
   */
  async connectWallet(providerId: string): Promise<WalletConnectionResult> {
    return await this.wallet.connectToProvider(providerId);
  }

  /**
   * Get available wallet providers
   */
  getWalletProviders() {
    return this.wallet.getProviders();
  }

  /**
   * Check if a wallet provider is available
   */
  isWalletProviderAvailable(providerId: string): boolean {
    return this.wallet.isProviderAvailable(providerId);
  }

  /**
   * Get the connected wallet's account address
   */
  getAccountAddress(): string {
    return this.wallet.getAccountAddress();
  }

  /**
   * Get the balance of the connected wallet
   */
  async getBalance() {
    return await this.wallet.getBalance();
  }




  /**
   * Create a simple memo with account canister ID as bytes
   * Example: 1 => Uint8Array([1]), 2 => Uint8Array([2])
   */
  private createMemoWithAccountCanisterId(accountCanisterId: number): Uint8Array {
    // Convert number to bytes (simple approach)
    const bytes = [];
    let num = accountCanisterId;

    // Handle 0 case
    if (num === 0) {
      return new Uint8Array([0]);
    }

    // Convert to bytes (little-endian)
    while (num > 0) {
      bytes.push(num & 0xff);
      num = Math.floor(num / 256);
    }

    return new Uint8Array(bytes);
  }

  /**
   * Send funds to a specific canister/ledger
   * This is now a real transaction, not mock data.
   */
  async sendFunds(request: CreateTransactionRequest): Promise<TransactionResponse> {
    try {
      // Always use icpayCanisterId as toPrincipal
      if (!this.icpayCanisterId) {
        await this.fetchAccountInfo();
      }
      const ledgerCanisterId = request.ledgerCanisterId;
      let toPrincipal = this.icpayCanisterId!;
      const amount = typeof request.amount === 'string' ? BigInt(request.amount) : BigInt(request.amount);
      const host = this.icHost;
      let memo: Uint8Array | undefined = this.createMemoWithAccountCanisterId(parseInt(request.accountCanisterId));

      // Check balance before sending
      const balance = await this.getBalance();
      const requiredAmount = amount;

      // Check if user has sufficient balance
      if (ledgerCanisterId === 'ryjl3-tyaaa-aaaaa-aaaba-cai') {
        // ICP ledger
        if (balance.icp < requiredAmount) {
          throw new IcpayError({
            code: 'INSUFFICIENT_BALANCE',
            message: `Insufficient ICP balance. Required: ${requiredAmount}, Available: ${balance.icp}`,
            details: { required: requiredAmount, available: balance.icp }
          });
        }
      } else {
        // Other ledgers - check icpayTest balance for now
        if (balance.icpayTest < requiredAmount) {
          throw new IcpayError({
            code: 'INSUFFICIENT_BALANCE',
            message: `Insufficient token balance. Required: ${requiredAmount}, Available: ${balance.icpayTest}`,
            details: { required: requiredAmount, available: balance.icpayTest }
          });
        }
      }

      let transferResult;
      if (ledgerCanisterId === 'ryjl3-tyaaa-aaaaa-aaaba-cai') {
        // ICP Ledger: use ICRC-1 transfer (ICP ledger supports ICRC-1)
        console.log('[ICPay SDK] Using ICRC-1 transfer for ICP ledger');
        transferResult = await this.sendFundsToLedger(
          ledgerCanisterId,
          toPrincipal,
          amount,
          memo,
          host
        );
      } else {
        // ICRC-1 ledgers: use principal directly
        transferResult = await this.sendFundsToLedger(
          ledgerCanisterId,
          toPrincipal,
          amount,
          memo,
          host
        );
      }

      // Assume transferResult returns a block index or transaction id
      const blockIndex = transferResult?.Ok?.toString() || transferResult?.blockIndex?.toString() || `temp-${Date.now()}`;

      // First, notify the canister about the ledger transaction
      let canisterTransactionId: string;
      try {
        canisterTransactionId = await this.notifyLedgerTransaction(
          this.icpayCanisterId!,
          ledgerCanisterId,
          BigInt(blockIndex)
        );
      } catch (notifyError) {
        canisterTransactionId = blockIndex;
      }

      // Poll for transaction status until completed
      // Use the transaction ID returned by the notification, not the block index
      let status: any = null;
      try {
        status = await this.pollTransactionStatus(this.icpayCanisterId!, canisterTransactionId, 2000, 30);
      } catch (e) {
        // If polling fails, still return the transactionId and pending status
        status = { status: 'pending' };
      }

      // Extract the status string from the transaction object
      let statusString: 'pending' | 'completed' | 'failed' = 'pending';
      if (status) {
        if (typeof status === 'object' && status.status) {
          // Handle variant status like {Completed: null}
          if (typeof status.status === 'object') {
            const statusKeys = Object.keys(status.status);
            if (statusKeys.length > 0) {
              const rawStatus = statusKeys[0].toLowerCase();
              if (rawStatus === 'completed' || rawStatus === 'failed') {
                statusString = rawStatus as 'completed' | 'failed';
              }
            }
          } else {
            const rawStatus = status.status;
            if (rawStatus === 'completed' || rawStatus === 'failed') {
              statusString = rawStatus as 'completed' | 'failed';
            }
          }
        }
      }

      return {
        transactionId: canisterTransactionId,
        status: statusString,
        amount: amount.toString(),
        recipientCanister: ledgerCanisterId,
        timestamp: new Date(),
        description: 'Fund transfer',
        metadata: request.metadata
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[ICPay SDK] sendFunds error details:', error);
      if (error instanceof IcpayError) {
        throw error;
      }
      throw new IcpayError({
        code: 'TRANSACTION_FAILED',
        message: 'Failed to send funds',
        details: error
      });
    }
  }

  /**
   * Update store configuration
   */
  async updateStoreConfig(config: StoreConfig): Promise<AccountInfo> {
    try {
      const response = await this.apiClient.put('/sdk/account/config', config);
      return response.data;
    } catch (error) {
      throw new IcpayError({
        code: 'STORE_CONFIG_UPDATE_FAILED',
        message: 'Failed to update store configuration',
        details: error
      });
    }
  }

  /**
   * Disconnect from wallet
   */
  async disconnectWallet(): Promise<void> {
    return await this.wallet.disconnect();
  }

  /**
   * Check if wallet is connected
   */
  isWalletConnected(): boolean {
    return this.wallet.isConnected();
  }

  /**
   * Get the connected wallet provider
   */
  getConnectedWalletProvider(): string | null {
    return this.wallet.getConnectedProvider();
  }

  /**
   * Poll for transaction status using anonymous actor (no signature required)
   */
  async pollTransactionStatus(canisterId: string, transactionId: string, intervalMs = 2000, maxAttempts = 30): Promise<any> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        let status = await this.getTransactionStatusFromCanister(canisterId, transactionId);

        // If we get an array (unexpected), try the alternative method
        if (Array.isArray(status) && status.length > 0) {
          const transaction = status[0];

          if (transaction && typeof transaction === 'object') {
            // Check if we have a valid status
            if ((transaction as any).status) {
              return transaction; // Return immediately when we find a valid status
            }
          }
        }

        // If we get null or no valid result, try the alternative method
        if (!status || (Array.isArray(status) && status.length === 0)) {
          status = await this.getTransactionByFilter(transactionId);

          if (status && status.status) {
            return status; // Return immediately when we find a valid status
          }
        }

        if (status && status.status) {
          return status; // Return immediately when we find a valid status
        }

        // Check if status is an object with Ok/Err pattern
        if (status && typeof status === 'object' && ((status as any).Ok || (status as any).Err)) {
          return status; // Return immediately when we find a valid status
        }

      } catch (error) {
        // Wait before next attempt
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
      }
    }

    throw new Error('Transaction status polling timed out');
  }

  /**
   * Fetch transaction status from the canister using agent-js
   */
  async getTransactionStatusFromCanister(canisterId: string, transactionId: string): Promise<any> {
    // Create anonymous actor for canister queries (no signature required)
    const agent = new HttpAgent({ host: this.icHost });
    const actor = Actor.createActor(icpayIdl, { agent, canisterId });

    try {
      const result = await actor.get_transaction(transactionId);
      return result;
    } catch (error) {
      console.error('getTransactionStatusFromCanister error:', error);
      throw error;
    }
  }

  /**
   * Notify canister about ledger transaction using anonymous actor (no signature required)
   */
  async notifyLedgerTransaction(canisterId: string, ledgerCanisterId: string, blockIndex: bigint): Promise<string> {
    // Create anonymous actor for canister notifications (no signature required)
    const agent = new HttpAgent({ host: this.icHost });
    const actor = Actor.createActor(icpayIdl, { agent, canisterId });

    const result = await actor.notify_ledger_transaction({
      ledger_canister_id: ledgerCanisterId,
      block_index: blockIndex
    }) as any;

    if (result && result.Ok) {
      return result.Ok;
    } else if (result && result.Err) {
      throw new Error(result.Err);
    } else {
      throw new Error('Unexpected canister notify result');
    }
  }

  /**
   * Send funds to a ledger canister using agent-js
   * Now uses host from config
   */
  async sendFundsToLedger(
    ledgerCanisterId: string,
    toPrincipal: string,
    amount: bigint,
    memo?: Uint8Array,
    host?: string
  ): Promise<any> {
    let actor;
    if (this.actorProvider) {
      console.log('[ICPay SDK] Using actorProvider for ICRC transfer');
      actor = this.actorProvider(ledgerCanisterId, ledgerIdl);
    } else {
      throw new Error('actorProvider is required for sending funds');
    }

    // ICRC-1 transfer
    return await actor.icrc1_transfer({
      to: { owner: Principal.fromText(toPrincipal), subaccount: [] },
      amount,
      fee: [], // Always include fee, even if empty
      memo: memo ? [memo] : [],
      from_subaccount: [],
      created_at_time: [],
    });
  }

  /**
   * Get transaction by ID using get_transactions filter (alternative to get_transaction)
   */
  async getTransactionByFilter(transactionId: string): Promise<any> {
    try {
      if (!this.icpayCanisterId) {
        await this.fetchAccountInfo();
      }

      // Create anonymous actor for canister queries
      const agent = new HttpAgent({ host: this.icHost });
      const actor = Actor.createActor(icpayIdl, { agent, canisterId: this.icpayCanisterId! });

      // Get all transactions and filter by ID
      const result = await (actor as any).get_transactions({
        account_canister_id: [], // Use empty array instead of null
        ledger_canister_id: [], // Use empty array instead of null
        from_timestamp: [], // Use empty array instead of null
        to_timestamp: [], // Use empty array instead of null
        status: [], // Use empty array instead of null
        limit: [], // Use empty array instead of 100 for optional nat32
        offset: [] // Use empty array instead of 0 for optional nat32
      });

      if (result && result.transactions) {
        const transaction = result.transactions.find((tx: any) => tx.id === transactionId);
        return transaction;
      }

      return null;
    } catch (error) {
      console.error('getTransactionByFilter error:', error);
      throw error;
    }
  }
}

// Export types and classes
export * from './types';
export { IcpayError } from './errors';
export { IcpayWallet } from './wallet';

// Default export
export default Icpay;