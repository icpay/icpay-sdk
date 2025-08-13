import {
  IcpayConfig,
  CreateTransactionRequest,
  TransactionResponse,
  TransactionStatus,
  AccountInfo,
  PublicAccountInfo,
  VerifiedLedger,
  WalletConnectionResult,
  CanisterInfo,
  AllLedgerBalances,
  LedgerBalance,
  PriceCalculationRequest,
  PriceCalculationResult,
  TransactionHistoryRequest,
  TransactionHistoryResponse,
  LedgerInfo,
  SendFundsUsdRequest
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
  private publicApiClient: AxiosInstance;
  private privateApiClient: AxiosInstance | null = null;
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

    // Validate authentication configuration
    if (!this.config.publishableKey && !this.config.secretKey) {
      throw new Error('Either publishableKey or secretKey must be provided');
    }

    this.icHost = config.icHost || 'https://ic0.app';
    this.externalWallet = config.externalWallet || null;
    this.usePlugNPlay = !!config.usePlugNPlay;
    this.plugNPlayConfig = config.plugNPlayConfig || {};
    this.actorProvider = config.actorProvider;

    if (this.externalWallet) {
      this.wallet = new IcpayWallet({ externalWallet: this.externalWallet });
    } else if (this.usePlugNPlay) {
      this.wallet = new IcpayWallet({ usePlugNPlay: true, plugNPlayConfig: this.plugNPlayConfig });
    } else {
      this.wallet = new IcpayWallet();
    }

    // Create public API client (always available)
    this.publicApiClient = axios.create({
      baseURL: this.config.apiUrl,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.publishableKey || this.config.secretKey}`
      }
    });

    // Create private API client (only if secret key is provided)
    if (this.config.secretKey) {
      const privateHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.secretKey}`
      };

      if (this.config.accountId) {
        privateHeaders['X-Account-ID'] = this.config.accountId;
      }

      this.privateApiClient = axios.create({
        baseURL: this.config.apiUrl,
        headers: privateHeaders
      });
    }
  }

  /**
   * Check if SDK has secret key for private operations
   */
  private hasSecretKey(): boolean {
    return !!this.config.secretKey && !!this.privateApiClient;
  }

  /**
   * Require secret key for private operations
   */
  private requireSecretKey(methodName: string): void {
    if (!this.hasSecretKey()) {
      throw new IcpayError({
        code: 'SECRET_KEY_REQUIRED',
        message: `${methodName} requires secret key authentication. Please provide secretKey and accountId in configuration.`
      });
    }
  }

  /**
   * Require account ID for private operations
   */
  private requireAccountId(methodName: string): void {
    if (!this.config.accountId) {
      throw new IcpayError({
        code: 'ACCOUNT_ID_REQUIRED',
        message: `${methodName} requires accountId to be provided in configuration.`
      });
    }
  }

  /**
   * Get account information (public method - limited data)
   */
  async getAccountInfo(): Promise<PublicAccountInfo> {
    try {
      const response = await this.publicApiClient.get('/sdk/public/account');
      const account = response.data;

      return {
        id: account.id,
        name: account.name,
        isActive: account.isActive,
        isLive: account.isLive,
        accountCanisterId: account.accountCanisterId,
        walletAddress: account.walletAddress,
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
   * Get detailed account information (private method - full data)
   */
  async getDetailedAccountInfo(): Promise<AccountInfo> {
    this.requireSecretKey('getDetailedAccountInfo');
    this.requireAccountId('getDetailedAccountInfo');

    try {
      const response = await this.privateApiClient!.get('/sdk/account');
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
        message: 'Failed to fetch detailed account information',
        details: error
      });
    }
  }

  /**
   * Get verified ledgers (public method)
   */
  async getVerifiedLedgers(): Promise<VerifiedLedger[]> {
    try {
      const response = await this.publicApiClient.get('/sdk/public/ledgers/verified');
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
        // Price-related fields
        currentPrice: ledger.currentPrice || null,
        priceFetchMethod: ledger.priceFetchMethod || null,
        lastPriceUpdate: ledger.lastPriceUpdate || null,
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
   * Get transaction status by canister transaction ID (private method)
   *
   * This method returns transaction status from the ICPay API database.
   * Note: Canister transactions may take up to 1 minute to sync to the API database.
   * If a transaction is not found, a sync notification will be automatically triggered.
   */
  async getTransactionStatus(canisterTransactionId: number): Promise<TransactionStatus> {
    this.requireSecretKey('getTransactionStatus');
    this.requireAccountId('getTransactionStatus');

    try {
      const response = await this.privateApiClient!.get(`/sdk/transactions/${canisterTransactionId}/status`);
      return response.data;
    } catch (error) {
      throw new IcpayError({
        code: 'TRANSACTION_STATUS_FETCH_FAILED',
        message: 'Failed to fetch transaction status',
        details: error
      });
    }
  }

  /**
   * Trigger transaction sync from canister (public method)
   *
   * This method attempts to sync a transaction directly from the canister to the API database
   * and returns the result immediately. This is useful when you know a transaction exists
   * in the canister but it's not showing up in the API database yet.
   */
  async triggerTransactionSync(canisterTransactionId: number): Promise<any> {
    try {
      const response = await this.publicApiClient.get(`/sdk/public/transactions/${canisterTransactionId}/sync`);
      return response.data;
    } catch (error) {
      throw new IcpayError({
        code: 'TRANSACTION_SYNC_TRIGGER_FAILED',
        message: 'Failed to trigger transaction sync from canister',
        details: error
      });
    }
  }

  /**
   * Fetch and cache /sdk/account info, including icpay_canister_backend
   */
  private async fetchAccountInfo(): Promise<any> {
    this.requireSecretKey('fetchAccountInfo');

    if (this.accountInfoCache) {
      return this.accountInfoCache;
    }
    const response = await this.privateApiClient!.get('/sdk/account');
    this.accountInfoCache = response.data;
    if (response.data && response.data.icpay_canister_backend) {
      this.icpayCanisterId = response.data.icpay_canister_backend.toString();
    }
    return this.accountInfoCache;
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
   * Get balance for a specific ledger canister
   */
  async getLedgerBalance(ledgerCanisterId: string): Promise<bigint> {
    try {
      // Extract principal from external wallet
      let principal: string | null = null;

      if (this.externalWallet) {
        if (this.externalWallet.owner) {
          principal = this.externalWallet.owner;
        } else if (this.externalWallet.principal) {
          principal = this.externalWallet.principal;
        }
      }

      if (!principal) {
        throw new Error('No principal available for balance check');
      }

      // Convert string principal to Principal object
      const principalObj = Principal.fromText(principal);

      // Create anonymous actor for balance queries (no signing required)
      const agent = new HttpAgent({ host: this.icHost });
      const actor = Actor.createActor(ledgerIdl, { agent, canisterId: ledgerCanisterId });

      // Get the balance of the user's account
      const result = await (actor as any).icrc1_balance_of({
        owner: principalObj,
        subaccount: []
      });

      return BigInt(result);
    } catch (error) {
      console.error(`[ICPay SDK] getLedgerBalance error for ${ledgerCanisterId}:`, error);
      throw error;
    }
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
   * Send funds to a specific canister/ledger (public method)
   * This is now a real transaction, not mock data.
   */
  async sendFunds(request: CreateTransactionRequest): Promise<TransactionResponse> {
    try {
      // Fetch account info to get accountCanisterId if not provided
      let accountCanisterId = request.accountCanisterId;
      if (!accountCanisterId) {
        const accountInfo = await this.getAccountInfo();
        accountCanisterId = accountInfo.accountCanisterId.toString();
      }

      // Always use icpayCanisterId as toPrincipal
      if (!this.icpayCanisterId) {
        await this.fetchAccountInfo();
      }

      const ledgerCanisterId = request.ledgerCanisterId;
      let toPrincipal = this.icpayCanisterId!;
      const amount = typeof request.amount === 'string' ? BigInt(request.amount) : BigInt(request.amount);
      const host = this.icHost;
      let memo: Uint8Array | undefined = this.createMemoWithAccountCanisterId(parseInt(accountCanisterId));



      // Check balance before sending
      const balance = await this.getBalance();
      const requiredAmount = amount;

      // Helper function to make amounts human-readable
      const formatAmount = (amount: bigint, decimals: number = 8, symbol: string = '') => {
        const divisor = BigInt(10 ** decimals);
        const whole = amount / divisor;
        const fraction = amount % divisor;
        const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
        return `${whole}${fractionStr ? '.' + fractionStr : ''} ${symbol}`.trim();
      };

              // Check if user has sufficient balance based on ledger type
        try {
          // Get the actual balance from the specific ledger (works for all ICRC ledgers including ICP)
          const actualBalance = await this.getLedgerBalance(ledgerCanisterId);

          if (actualBalance < requiredAmount) {
            const requiredFormatted = formatAmount(requiredAmount, 8, 'tokens');
            const availableFormatted = formatAmount(actualBalance, 8, 'tokens');
            throw new IcpayError({
              code: 'INSUFFICIENT_BALANCE',
              message: `Insufficient token balance. Required: ${requiredFormatted}, Available: ${availableFormatted}`,
              details: { required: requiredAmount, available: actualBalance }
            });
          }
        } catch (balanceError) {
          // If we can't fetch the specific ledger balance, fall back to the old logic
          if (ledgerCanisterId === 'ryjl3-tyaaa-aaaaa-aaaba-cai') {
            // ICP ledger fallback
            if (balance.icp < requiredAmount) {
              const requiredFormatted = formatAmount(requiredAmount, 8, 'ICP');
              const availableFormatted = formatAmount(BigInt(balance.icp), 8, 'ICP');
              throw new IcpayError({
                code: 'INSUFFICIENT_BALANCE',
                message: `Insufficient ICP balance. Required: ${requiredFormatted}, Available: ${availableFormatted}`,
                details: { required: requiredAmount, available: balance.icp }
              });
            }
          } else {
            // Other ledgers fallback
            if (balance.icpayTest < requiredAmount) {
              const requiredFormatted = formatAmount(requiredAmount, 8, 'tokens');
              const availableFormatted = formatAmount(BigInt(balance.icpayTest), 8, 'tokens');
              throw new IcpayError({
                code: 'INSUFFICIENT_BALANCE',
                message: `Insufficient token balance. Required: ${requiredFormatted}, Available: ${availableFormatted}`,
                details: { required: requiredAmount, available: balance.icpayTest }
              });
            }
          }
        }

      let transferResult;
      if (ledgerCanisterId === 'ryjl3-tyaaa-aaaaa-aaaba-cai') {
        // ICP Ledger: use ICRC-1 transfer (ICP ledger supports ICRC-1)
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
      let canisterTransactionId: number;
      try {
        const transactionIdString = await this.notifyLedgerTransaction(
          this.icpayCanisterId!,
          ledgerCanisterId,
          BigInt(blockIndex)
        );
        canisterTransactionId = parseInt(transactionIdString, 10);
      } catch (notifyError) {
        canisterTransactionId = parseInt(blockIndex, 10);
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

      const response = {
        transactionId: canisterTransactionId,
        status: statusString,
        amount: amount.toString(),
        recipientCanister: ledgerCanisterId,
        timestamp: new Date(),
        description: 'Fund transfer',
        metadata: request.metadata
      };

      return response;
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
  async pollTransactionStatus(canisterId: string, transactionId: number, intervalMs = 2000, maxAttempts = 30): Promise<any> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        let status = await this.getTransactionStatusFromCanister(canisterId, transactionId);

        // If we get an array (unexpected), try the alternative method
        if (Array.isArray(status) && status.length > 0) {
          const transaction = status[0];

          if (transaction && typeof transaction === 'object') {
            // Check if we have a valid status
            if ((transaction as any).status) {
              // Check if transaction is completed
              const transactionStatus = (transaction as any).status;
              if (this.isTransactionCompleted(transactionStatus)) {
                return transaction; // Return immediately when completed
              }
              // If not completed, continue polling
            }
          }
        }

        // If we get null or no valid result, try the alternative method
        if (!status || (Array.isArray(status) && status.length === 0)) {
          status = await this.getTransactionByFilter(transactionId);

          if (status && status.status) {
            if (this.isTransactionCompleted(status.status)) {
              return status; // Return immediately when completed
            }
            // If not completed, continue polling
          }
        }

        if (status && status.status) {
          if (this.isTransactionCompleted(status.status)) {
            return status; // Return immediately when completed
          }
          // If not completed, continue polling
        }

        // Check if status is an object with Ok/Err pattern
        if (status && typeof status === 'object' && ((status as any).Ok || (status as any).Err)) {
          return status; // Return immediately when we find a valid status
        }

        // Wait before next attempt (unless this is the last attempt)
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, intervalMs));
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
   * Check if transaction status indicates completion
   */
  private isTransactionCompleted(status: any): boolean {
    if (!status) return false;

    // Handle variant status like {Completed: null}
    if (typeof status === 'object') {
      const statusKeys = Object.keys(status);
      if (statusKeys.length > 0) {
        const rawStatus = statusKeys[0].toLowerCase();
        return rawStatus === 'completed';
      }
    }

    // Handle string status
    if (typeof status === 'string') {
      return status.toLowerCase() === 'completed';
    }

    return false;
  }

  /**
   * Fetch transaction status from the canister using agent-js
   */
  async getTransactionStatusFromCanister(canisterId: string, transactionId: number): Promise<any> {
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
  async getTransactionByFilter(transactionId: number): Promise<any> {
    try {
      if (!this.icpayCanisterId) {
        await this.fetchAccountInfo();
      }

      // Create anonymous actor for canister queries
      const agent = new HttpAgent({ host: this.icHost });
      const actor = Actor.createActor(icpayIdl, { agent, canisterId: this.icpayCanisterId! });

      // Convert string transaction ID to Nat
      const transactionIdNat = BigInt(transactionId);

      // Get all transactions and filter by ID
      const result = await (actor as any).get_transactions({
        account_canister_id: [], // Use empty array instead of null
        ledger_canister_id: [], // Use empty array instead of null
        from_timestamp: [], // Use empty array instead of null
        to_timestamp: [], // Use empty array instead of null
        from_id: [], // Use empty array instead of null
        status: [], // Use empty array instead of null
        limit: [], // Use empty array instead of 100 for optional nat32
        offset: [] // Use empty array instead of 0 for optional nat32
      });

      if (result && result.transactions) {
        const transaction = result.transactions.find((tx: any) => tx.id.toString() === transactionId.toString());
        return transaction;
      }

      return null;
    } catch (error) {
      console.error('getTransactionByFilter error:', error);
      throw error;
    }
  }

  // ===== NEW ENHANCED SDK FUNCTIONS =====

  /**
   * Get balance for all verified ledgers for the connected wallet (public method)
   */
  async getAllLedgerBalances(): Promise<AllLedgerBalances> {
    try {
      if (!this.isWalletConnected()) {
        throw new IcpayError({
          code: 'WALLET_NOT_CONNECTED',
          message: 'Wallet must be connected to fetch balances'
        });
      }

      const verifiedLedgers = await this.getVerifiedLedgers();
      const balances: LedgerBalance[] = [];
      let totalBalancesUSD = 0;

      for (const ledger of verifiedLedgers) {
        try {
          const rawBalance = await this.getLedgerBalance(ledger.canisterId);
          const formattedBalance = this.formatBalance(rawBalance.toString(), ledger.decimals);

          const balance: LedgerBalance = {
            ledgerId: ledger.id,
            ledgerName: ledger.name,
            ledgerSymbol: ledger.symbol,
            canisterId: ledger.canisterId,
            balance: rawBalance.toString(),
            formattedBalance,
            decimals: ledger.decimals,
            currentPrice: ledger.currentPrice || undefined,
            priceFetchMethod: ledger.priceFetchMethod || undefined,
            lastPriceUpdate: ledger.lastPriceUpdate ? new Date(ledger.lastPriceUpdate) : undefined,
            lastUpdated: new Date()
          };

          balances.push(balance);

          // Calculate USD value if price is available
          if (ledger.currentPrice && rawBalance > 0) {
            const humanReadableBalance = parseFloat(formattedBalance);
            totalBalancesUSD += humanReadableBalance * ledger.currentPrice;
          }
        } catch (error) {
          console.warn(`Failed to fetch balance for ledger ${ledger.symbol}:`, error);
          // Continue with other ledgers even if one fails
        }
      }

      return {
        balances,
        totalBalancesUSD: totalBalancesUSD > 0 ? totalBalancesUSD : undefined,
        lastUpdated: new Date()
      };
    } catch (error) {
      throw new IcpayError({
        code: 'BALANCES_FETCH_FAILED',
        message: 'Failed to fetch all ledger balances',
        details: error
      });
    }
  }

  /**
   * Get balance for a specific ledger by canister ID (public method)
   */
  async getSingleLedgerBalance(ledgerCanisterId: string): Promise<LedgerBalance> {
    try {
      if (!this.isWalletConnected()) {
        throw new IcpayError({
          code: 'WALLET_NOT_CONNECTED',
          message: 'Wallet must be connected to fetch balance'
        });
      }

      // Get ledger info to include price data
      const verifiedLedgers = await this.getVerifiedLedgers();
      const ledger = verifiedLedgers.find(l => l.canisterId === ledgerCanisterId);

      if (!ledger) {
        throw new IcpayError({
          code: 'LEDGER_NOT_FOUND',
          message: `Ledger with canister ID ${ledgerCanisterId} not found or not verified`
        });
      }

      const rawBalance = await this.getLedgerBalance(ledgerCanisterId);
      const formattedBalance = this.formatBalance(rawBalance.toString(), ledger.decimals);

      return {
        ledgerId: ledger.id,
        ledgerName: ledger.name,
        ledgerSymbol: ledger.symbol,
        canisterId: ledger.canisterId,
        balance: rawBalance.toString(),
        formattedBalance,
        decimals: ledger.decimals,
        currentPrice: ledger.currentPrice || undefined,
        priceFetchMethod: ledger.priceFetchMethod || undefined,
        lastPriceUpdate: ledger.lastPriceUpdate ? new Date(ledger.lastPriceUpdate) : undefined,
        lastUpdated: new Date()
      };
    } catch (error) {
      throw new IcpayError({
        code: 'SINGLE_BALANCE_FETCH_FAILED',
        message: `Failed to fetch balance for ledger ${ledgerCanisterId}`,
        details: error
      });
    }
  }

  /**
   * Calculate token amount from USD price for a specific ledger (public method)
   */
  async calculateTokenAmountFromUSD(request: PriceCalculationRequest): Promise<PriceCalculationResult> {
    try {
      const { usdAmount, ledgerCanisterId, ledgerSymbol } = request;

      if (usdAmount <= 0) {
        throw new IcpayError({
          code: 'INVALID_USD_AMOUNT',
          message: 'USD amount must be greater than 0'
        });
      }

      // Get ledger info
      const verifiedLedgers = await this.getVerifiedLedgers();
      const ledger = verifiedLedgers.find(l =>
        l.canisterId === ledgerCanisterId ||
        (ledgerSymbol && l.symbol === ledgerSymbol)
      );

      if (!ledger) {
        throw new IcpayError({
          code: 'LEDGER_NOT_FOUND',
          message: `Ledger not found for canister ID ${ledgerCanisterId} or symbol ${ledgerSymbol}`
        });
      }

      if (!ledger.currentPrice || ledger.currentPrice <= 0) {
        throw new IcpayError({
          code: 'PRICE_NOT_AVAILABLE',
          message: `Current price not available for ledger ${ledger.symbol}`
        });
      }

      // Calculate token amount
      const tokenAmountHuman = usdAmount / ledger.currentPrice;
      // Convert to smallest unit and truncate decimals to get whole number for blockchain
      const tokenAmountDecimals = Math.floor(tokenAmountHuman * Math.pow(10, ledger.decimals)).toString();

      return {
        usdAmount,
        ledgerCanisterId: ledger.canisterId,
        ledgerSymbol: ledger.symbol,
        ledgerName: ledger.name,
        currentPrice: ledger.currentPrice,
        priceTimestamp: ledger.lastPriceUpdate ? new Date(ledger.lastPriceUpdate) : new Date(),
        priceFetchMethod: ledger.priceFetchMethod || 'unknown',
        tokenAmountHuman: tokenAmountHuman.toFixed(ledger.decimals),
        tokenAmountDecimals,
        decimals: ledger.decimals
      };
    } catch (error) {
      throw new IcpayError({
        code: 'PRICE_CALCULATION_FAILED',
        message: 'Failed to calculate token amount from USD',
        details: error
      });
    }
  }

  /**
   * Get transaction history for the account (private method)
   */
  async getTransactionHistory(request: TransactionHistoryRequest = {}): Promise<TransactionHistoryResponse> {
    this.requireSecretKey('getTransactionHistory');
    this.requireAccountId('getTransactionHistory');
    try {
      const params = new URLSearchParams();

      if (request.accountId) params.append('accountId', request.accountId);
      if (request.ledgerCanisterId) params.append('ledgerCanisterId', request.ledgerCanisterId);
      if (request.fromTimestamp) params.append('fromTimestamp', request.fromTimestamp.toISOString());
      if (request.toTimestamp) params.append('toTimestamp', request.toTimestamp.toISOString());
      if (request.status) params.append('status', request.status);
      if (request.limit) params.append('limit', request.limit.toString());
      if (request.offset) params.append('offset', request.offset.toString());

      const response = await this.privateApiClient!.get(`/sdk/transactions/history?${params.toString()}`);

      return {
        transactions: response.data.transactions.map((tx: any) => ({
          id: tx.id,
          transactionId: tx.transactionId,
          status: tx.status,
          amount: tx.amount,
          currency: tx.currency,
          ledgerCanisterId: tx.ledgerCanisterId,
          ledgerSymbol: tx.ledgerSymbol,
          fromAddress: tx.fromAddress,
          toAddress: tx.toAddress,
          blockHeight: tx.blockHeight,
          fee: tx.fee,
          metadata: tx.metadata,
          createdAt: new Date(tx.createdAt),
          updatedAt: new Date(tx.updatedAt)
        })),
        total: response.data.total,
        limit: response.data.limit,
        offset: response.data.offset,
        hasMore: response.data.hasMore
      };
    } catch (error) {
      throw new IcpayError({
        code: 'TRANSACTION_HISTORY_FETCH_FAILED',
        message: 'Failed to fetch transaction history',
        details: error
      });
    }
  }

  /**
   * Get detailed ledger information including price data (public method)
   */
  async getLedgerInfo(ledgerCanisterId: string): Promise<LedgerInfo> {
    try {
      const response = await this.publicApiClient.get(`/sdk/public/ledgers/${ledgerCanisterId}`);
      const ledger = response.data;

      return {
        id: ledger.id,
        name: ledger.name,
        symbol: ledger.symbol,
        canisterId: ledger.canisterId,
        standard: ledger.standard,
        decimals: ledger.decimals,
        logoUrl: ledger.logoUrl || undefined,
        supportsNotify: ledger.supportsNotify,
        notifyMethod: ledger.notifyMethod || undefined,
        verified: ledger.verified,
        fee: ledger.fee || undefined,
        network: ledger.network,
        description: ledger.description || undefined,
        currentPrice: ledger.currentPrice || undefined,
        priceFetchMethod: ledger.priceFetchMethod || undefined,
        lastPriceUpdate: ledger.lastPriceUpdate ? new Date(ledger.lastPriceUpdate) : undefined,
        createdAt: new Date(ledger.createdAt),
        updatedAt: new Date(ledger.updatedAt)
      };
    } catch (error) {
      throw new IcpayError({
        code: 'LEDGER_INFO_FETCH_FAILED',
        message: `Failed to fetch ledger info for ${ledgerCanisterId}`,
        details: error
      });
    }
  }

  /**
   * Send funds from USD to a specific ledger (public method)
   */
  async sendFundsUsd(request: SendFundsUsdRequest): Promise<TransactionResponse> {
    try {
      // Convert usdAmount to number if it's a string
      const usdAmount = typeof request.usdAmount === 'string' ? parseFloat(request.usdAmount) : request.usdAmount;

      const priceCalculationResult = await this.calculateTokenAmountFromUSD({
        usdAmount: usdAmount,
        ledgerCanisterId: request.ledgerCanisterId
      });

      const createTransactionRequest: CreateTransactionRequest = {
        ledgerCanisterId: request.ledgerCanisterId,
        amount: priceCalculationResult.tokenAmountDecimals,
        accountCanisterId: request.accountCanisterId,
        metadata: request.metadata
      };

      return await this.sendFunds(createTransactionRequest);
    } catch (error) {
      if (error instanceof IcpayError) {
        throw error;
      }
      throw new IcpayError({
        code: 'SEND_FUNDS_USD_FAILED',
        message: 'Failed to send funds from USD',
        details: error
      });
    }
  }

    /**
   * Get all ledgers with price information (public method)
   */
  async getAllLedgersWithPrices(): Promise<LedgerInfo[]> {
    try {
      const response = await this.publicApiClient.get('/sdk/public/ledgers/all-with-prices');

      return response.data.map((ledger: any) => ({
        id: ledger.id,
        name: ledger.name,
        symbol: ledger.symbol,
        canisterId: ledger.canisterId,
        standard: ledger.standard,
        decimals: ledger.decimals,
        logoUrl: ledger.logoUrl || undefined,
        supportsNotify: ledger.supportsNotify,
        notifyMethod: ledger.notifyMethod || undefined,
        verified: ledger.verified,
        fee: ledger.fee || undefined,
        network: ledger.network,
        description: ledger.description || undefined,
        currentPrice: ledger.currentPrice || undefined,
        priceFetchMethod: ledger.priceFetchMethod || undefined,
        lastPriceUpdate: ledger.lastPriceUpdate ? new Date(ledger.lastPriceUpdate) : undefined,
        createdAt: new Date(ledger.createdAt),
        updatedAt: new Date(ledger.updatedAt)
      }));
    } catch (error) {
      throw new IcpayError({
        code: 'LEDGERS_WITH_PRICES_FETCH_FAILED',
        message: 'Failed to fetch ledgers with price information',
        details: error
      });
    }
  }

  /**
   * Get account wallet balances (from API, not connected wallet) (private method)
   */
  async getAccountWalletBalances(): Promise<AllLedgerBalances> {
    this.requireSecretKey('getAccountWalletBalances');
    this.requireAccountId('getAccountWalletBalances');
    try {
      const response = await this.privateApiClient!.get('/sdk/account/wallet-balances');

      return {
        balances: response.data.balances.map((balance: any) => ({
          ledgerId: balance.ledgerId,
          ledgerName: balance.ledgerName,
          ledgerSymbol: balance.ledgerSymbol,
          canisterId: balance.canisterId,
          balance: balance.balance,
          formattedBalance: balance.formattedBalance,
          decimals: balance.decimals,
          currentPrice: balance.currentPrice,
          priceFetchMethod: balance.priceFetchMethod,
          lastPriceUpdate: balance.lastPriceUpdate ? new Date(balance.lastPriceUpdate) : undefined,
          lastUpdated: new Date(balance.lastUpdated)
        })),
        totalBalancesUSD: response.data.totalBalancesUSD,
        lastUpdated: new Date(response.data.lastUpdated)
      };
    } catch (error) {
      throw new IcpayError({
        code: 'ACCOUNT_WALLET_BALANCES_FETCH_FAILED',
        message: 'Failed to fetch account wallet balances',
        details: error
      });
    }
  }

  /**
   * Utility function to format balance from smallest unit to human readable
   */
  private formatBalance(balance: string, decimals: number): string {
    const balanceNum = parseFloat(balance);
    const divisor = Math.pow(10, decimals);
    const whole = Math.floor(balanceNum / divisor);
    const fraction = balanceNum % divisor;
    const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${whole}${fractionStr ? '.' + fractionStr : ''}`;
  }

  // ===== END NEW ENHANCED SDK FUNCTIONS =====
}

// Export types and classes
export * from './types';
export { IcpayError } from './errors';
export { IcpayWallet } from './wallet';

// Default export
export default Icpay;