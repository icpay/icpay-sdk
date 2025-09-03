import {
  IcpayConfig,
  CreateTransactionRequest,
  TransactionResponse,
  WalletConnectionResult,
  AllLedgerBalances,
  LedgerBalance,
  PriceCalculationRequest,
  PriceCalculationResult,
  SendFundsUsdRequest,
  AccountPublic,
  LedgerPublic,
  SdkLedger,
} from './types';
import { IcpayError, createBalanceError, ICPAY_ERROR_CODES } from './errors';
import { IcpayEventCenter, IcpayEventName } from './events';
import { IcpayWallet } from './wallet';
import { HttpAgent, Actor } from '@dfinity/agent';
import { idlFactory as icpayIdl } from './declarations/icpay_canister_backend/icpay_canister_backend.did.js';
import { idlFactory as ledgerIdl } from './declarations/icrc-ledger/ledger.did.js';
import { Principal } from '@dfinity/principal';
import { debugLog } from './utils';
import { createProtectedApi, ProtectedApi } from './protected';
import { HttpClient } from './http';

export class Icpay {
  private config: IcpayConfig;
  private wallet: IcpayWallet;
  private publicApiClient: HttpClient;
  private privateApiClient: HttpClient | null = null;
  private connectedWallet: any = null;
  private icHost: string;
  private actorProvider?: (canisterId: string, idl: any) => any;
  private icpayCanisterId: string | null = null;
  private accountInfoCache: any = null;
  private verifiedLedgersCache: { data: LedgerPublic[] | null; timestamp: number } = { data: null, timestamp: 0 };
  private events: IcpayEventCenter;
  public protected: ProtectedApi;

  constructor(config: IcpayConfig) {
    this.config = {
      environment: 'production',
      apiUrl: 'https://api.icpay.org',
      debug: false,
      enableEvents: false,
      awaitServerNotification: false,
      ...config
    };

    debugLog(this.config.debug || false, 'constructor', { config: this.config });

    // Validate authentication configuration
    if (!this.config.publishableKey && !this.config.secretKey) {
      throw new Error('Either publishableKey or secretKey must be provided');
    }

    this.icHost = config.icHost || 'https://ic0.app';
    this.connectedWallet = config.connectedWallet || null;
    this.actorProvider = config.actorProvider;
    debugLog(this.config.debug || false, 'constructor', { connectedWallet: this.connectedWallet, actorProvider: this.actorProvider });

    // Initialize wallet with connected wallet if provided
    this.wallet = new IcpayWallet({ connectedWallet: this.connectedWallet });

    // Initialize event center
    this.events = new IcpayEventCenter();

    debugLog(this.config.debug || false, 'constructor', { connectedWallet: this.connectedWallet });

    // Create public API client (always available)
    this.publicApiClient = new HttpClient({
      baseURL: this.config.apiUrl || 'https://api.icpay.org',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.publishableKey || this.config.secretKey || ''}`
      }
    });

    debugLog(this.config.debug || false, 'publicApiClient created', this.publicApiClient);

    // Create private API client (only if secret key is provided)
    if (this.config.secretKey) {
      const privateHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.secretKey || ''}`
      };

      this.privateApiClient = new HttpClient({ baseURL: this.config.apiUrl || 'https://api.icpay.org', headers: privateHeaders });
    }

    debugLog(this.config.debug || false, 'privateApiClient created', this.privateApiClient);

    // Initialize protected API
    this.protected = createProtectedApi({
      privateApiClient: this.privateApiClient,
      emitStart: (name, args) => this.emitMethodStart(name, args),
      emitSuccess: (name, result) => this.emitMethodSuccess(name, result),
      emitError: (name, error) => this.emitMethodError(name, error),
    });
  }

  // ===== Event API (no Lit required) =====
  on(type: IcpayEventName | string, listener: (detail: any) => void): () => void {
    return this.events.on(type, listener);
  }

  off(type: IcpayEventName | string, listener: (detail: any) => void): void {
    this.events.off(type, listener);
  }

  emit(type: IcpayEventName | string, detail?: any): void {
    if (this.config.enableEvents) {
      this.events.emit(type, detail);
    }
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.events.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.events.removeEventListener(type, listener);
  }

  dispatchEvent(event: Event): boolean {
    return this.events.dispatchEvent(event);
  }

  private emitError(error: any): void {
    const err = error instanceof IcpayError
      ? error
      : new IcpayError({
          code: ICPAY_ERROR_CODES.UNKNOWN_ERROR,
          message: (error && (error.message || error.toString())) || 'Unknown error',
          details: error
        });
    if (this.config.enableEvents) {
      this.events.emit('icpay-sdk-error', err);
    }
  }

  private emitMethodStart(name: string, args?: any): void {
    if (this.config.enableEvents) {
      this.events.emit('icpay-sdk-method-start', { name, args });
    }
  }

  private emitMethodSuccess(name: string, result?: any): void {
    if (this.config.enableEvents) {
      this.events.emit('icpay-sdk-method-success', { name, result });
    }
  }

  private emitMethodError(name: string, error: any): void {
    if (this.config.enableEvents) {
      this.events.emit('icpay-sdk-method-error', { name, error });
    }
    this.emitError(error);
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
   * Get account information (public method - limited data)
   */
  async getAccountInfo(): Promise<AccountPublic> {
    this.emitMethodStart('getAccountInfo');
    try {
      const account = await this.publicApiClient.get('/sdk/public/account');

      const result: AccountPublic = {
        id: account.id,
        name: account.name,
        isActive: account.isActive,
        isLive: account.isLive,
        accountCanisterId: account.accountCanisterId,
        icpayCanisterId: account.icpayCanisterId,
        branding: account.branding || null,
      };
      this.emitMethodSuccess('getAccountInfo', result);
      return result;
    } catch (error) {
      const err = new IcpayError({
        code: 'ACCOUNT_INFO_FETCH_FAILED',
        message: 'Failed to fetch account information',
        details: error
      });
      this.emitMethodError('getAccountInfo', err);
      throw err;
    }
  }

  /**
   * Get verified ledgers (public method)
   */
  async getVerifiedLedgers(): Promise<LedgerPublic[]> {
    this.emitMethodStart('getVerifiedLedgers');
    const now = Date.now();
    const cacheAge = 60 * 60 * 1000; // 60 minutes cache

    // Return cached data if it's still fresh
    if (this.verifiedLedgersCache.data && (now - this.verifiedLedgersCache.timestamp) < cacheAge) {
      return this.verifiedLedgersCache.data;
    }

    try {
      const resp = await this.publicApiClient.get('/sdk/public/ledgers/verified');
      const ledgers: LedgerPublic[] = (resp as any).map((ledger: any) => ({
        id: ledger.id,
        name: ledger.name,
        symbol: ledger.symbol,
        canisterId: ledger.canisterId,
        decimals: ledger.decimals,
        logoUrl: ledger.logoUrl,
        verified: ledger.verified,
        fee: ledger.fee,
        currentPrice: ledger.currentPrice ?? null,
        lastPriceUpdate: ledger.lastPriceUpdate ?? null,
      }));

      // Update cache
      this.verifiedLedgersCache = {
        data: ledgers,
        timestamp: now
      };

      this.emitMethodSuccess('getVerifiedLedgers', { count: ledgers.length });
      return ledgers;
    } catch (error) {
      const err = new IcpayError({
        code: 'VERIFIED_LEDGERS_FETCH_FAILED',
        message: 'Failed to fetch verified ledgers',
        details: error
      });
      this.emitMethodError('getVerifiedLedgers', err);
      throw err;
    }
  }

  /**
   * Get a verified ledger's canister ID by its symbol (public helper)
   */
  async getLedgerCanisterIdBySymbol(symbol: string): Promise<string> {
    this.emitMethodStart('getLedgerCanisterIdBySymbol', { symbol });
    if (!symbol || typeof symbol !== 'string') {
      throw new IcpayError({
        code: 'INVALID_LEDGER_SYMBOL',
        message: 'Symbol must be a non-empty string'
      });
    }

    const ledgers = await this.getVerifiedLedgers();
    const match = ledgers.find(l => l.symbol.toLowerCase() === symbol.toLowerCase());

    if (!match) {
      throw new IcpayError({
        code: 'LEDGER_SYMBOL_NOT_FOUND',
        message: `Verified ledger with symbol ${symbol} not found`
      });
    }

    const result = match.canisterId;
    this.emitMethodSuccess('getLedgerCanisterIdBySymbol', { symbol, canisterId: result });
    return result;
  }

  /**
   * Trigger transaction sync from canister (public method)
   *
   * This method attempts to sync a transaction directly from the canister to the API database
   * and returns the result immediately. This is useful when you know a transaction exists
   * in the canister but it's not showing up in the API database yet.
   */
  async triggerTransactionSync(canisterTransactionId: number): Promise<any> {
    this.emitMethodStart('triggerTransactionSync', { canisterTransactionId });
    try {
      const data = await this.publicApiClient.get(`/sdk/public/transactions/${canisterTransactionId}/sync`);
      this.emitMethodSuccess('triggerTransactionSync', data);
      return data;
    } catch (error) {
      const err = new IcpayError({
        code: 'TRANSACTION_SYNC_TRIGGER_FAILED',
        message: 'Failed to trigger transaction sync from canister',
        details: error
      });
      this.emitMethodError('triggerTransactionSync', err);
      throw err;
    }
  }

  /**
   * Fetch and cache account info, including icpayCanisterId (public method)
   */
  private async fetchAccountInfo(): Promise<any> {
    if (this.accountInfoCache) {
      this.icpayCanisterId = this.accountInfoCache.icpayCanisterId.toString();
      return this.accountInfoCache;
    }

    try {
      // Use public endpoint to get account info
      const response = await this.publicApiClient.get('/sdk/public/account');
      this.accountInfoCache = response.data;
      if (response.data && response.data.icpayCanisterId) {
        this.icpayCanisterId = response.data.icpayCanisterId.toString();
      }
      return this.accountInfoCache;
    } catch (error) {
      throw new IcpayError({
        code: 'ACCOUNT_INFO_FETCH_FAILED',
        message: 'Failed to fetch account information',
        details: error
      });
    }
  }



  /**
   * Show wallet connection modal
   */
  async showWalletModal(): Promise<WalletConnectionResult> {
    this.emitMethodStart('showWalletModal');
    try {
      const res = await this.wallet.showConnectionModal();
      this.emitMethodSuccess('showWalletModal', res);
      return res;
    } catch (error) {
      this.emitMethodError('showWalletModal', error);
      throw error;
    }
  }

  /**
   * Connect to a specific wallet provider
   */
  async connectWallet(providerId: string): Promise<WalletConnectionResult> {
    this.emitMethodStart('connectWallet', { providerId });
    try {
      const res = await this.wallet.connectToProvider(providerId);
      this.emitMethodSuccess('connectWallet', res);
      return res;
    } catch (error) {
      this.emitMethodError('connectWallet', error);
      throw error;
    }
  }

  /**
   * Get available wallet providers
   */
  getWalletProviders() {
    this.emitMethodStart('getWalletProviders');
    const res = this.wallet.getProviders();
    this.emitMethodSuccess('getWalletProviders', { count: Array.isArray(res) ? res.length : undefined });
    return res;
  }

  /**
   * Check if a wallet provider is available
   */
  isWalletProviderAvailable(providerId: string): boolean {
    this.emitMethodStart('isWalletProviderAvailable', { providerId });
    const res = this.wallet.isProviderAvailable(providerId);
    this.emitMethodSuccess('isWalletProviderAvailable', { providerId, available: res });
    return res;
  }

  /**
   * Get the connected wallet's account address
   */
  getAccountAddress(): string {
    this.emitMethodStart('getAccountAddress');
    const res = this.wallet.getAccountAddress();
    this.emitMethodSuccess('getAccountAddress', { accountAddress: res });
    return res;
  }

  /**
   * Get balance for a specific ledger canister
   */
  async getLedgerBalance(ledgerCanisterId: string): Promise<bigint> {
    this.emitMethodStart('getLedgerBalance', { ledgerCanisterId });
    try {
      // Extract principal from connected wallet
      let principal: string | null = null;

      if (this.connectedWallet) {
        if (this.connectedWallet.owner) {
          principal = this.connectedWallet.owner;
        } else if (this.connectedWallet.principal) {
          principal = this.connectedWallet.principal;
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

      const out = BigInt(result);
      this.emitMethodSuccess('getLedgerBalance', { ledgerCanisterId, balance: out.toString() });
      return out;
    } catch (error) {
      this.emitMethodError('getLedgerBalance', error);
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

  private createPackedMemo(accountCanisterId: number, intentCode: number): Uint8Array {
    let memo = (BigInt(accountCanisterId >>> 0) << BigInt(32)) | BigInt(intentCode >>> 0);
    if (memo === BigInt(0)) return new Uint8Array([0]);
    const out: number[] = [];
    while (memo > BigInt(0)) {
      out.push(Number(memo & BigInt(0xff)));
      memo >>= BigInt(8);
    }
    return new Uint8Array(out);
  }

  /**
   * Send funds to a specific canister/ledger (public method)
   * This is now a real transaction
   */
  async sendFunds(request: CreateTransactionRequest): Promise<TransactionResponse> {
    this.emitMethodStart('sendFunds', { request: { ...request, amount: typeof request.amount === 'string' ? request.amount : String(request.amount) } });
    try {
      debugLog(this.config.debug || false, 'sendFunds start', { request });
      // Fetch account info to get accountCanisterId if not provided
      let accountCanisterId = request.accountCanisterId;
      if (!accountCanisterId) {
        debugLog(this.config.debug || false, 'fetching account info for accountCanisterId');
        const accountInfo = await this.getAccountInfo();
        accountCanisterId = accountInfo.accountCanisterId.toString();
        debugLog(this.config.debug || false, 'accountCanisterId resolved', { accountCanisterId });
      }

      // Always use icpayCanisterId as toPrincipal
      if (!this.icpayCanisterId) {
        await this.fetchAccountInfo();
      }

      const ledgerCanisterId = request.ledgerCanisterId;
      let toPrincipal = this.icpayCanisterId!;
      const amount = typeof request.amount === 'string' ? BigInt(request.amount) : BigInt(request.amount);
      const host = this.icHost;
      let memo: Uint8Array | undefined = undefined;



      // Check balance before sending
      const requiredAmount = amount;
      debugLog(this.config.debug || false, 'checking balance', { ledgerCanisterId, requiredAmount: requiredAmount.toString() });

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
            throw createBalanceError(requiredFormatted, availableFormatted, {
              required: requiredAmount,
              available: actualBalance,
              ledgerCanisterId
            });
          }
          debugLog(this.config.debug || false, 'balance ok', { actualBalance: actualBalance.toString() });
        } catch (balanceError) {
          // If we can't fetch the specific ledger balance, fall back to the old logic
          throw new IcpayError({
            code: 'INSUFFICIENT_BALANCE',
            message: 'Insufficient balance',
            details: { required: requiredAmount, available: 0 }
          });
        }

      // 1) Create payment intent via API
      let paymentIntentId: string | null = null;
      let paymentIntentCode: number | null = null;
      try {
        debugLog(this.config.debug || false, 'creating payment intent');

        // Get the expected sender principal from connected wallet
        const expectedSenderPrincipal = this.connectedWallet?.owner || this.connectedWallet?.principal?.toString();
        if (!expectedSenderPrincipal) {
          throw new IcpayError({
            code: ICPAY_ERROR_CODES.WALLET_NOT_CONNECTED,
            message: 'Wallet must be connected to create payment intent',
            details: { connectedWallet: this.connectedWallet },
            retryable: false,
            userAction: 'Connect your wallet first'
          });
        }

        const intentResp: any = await this.publicApiClient.post('/sdk/public/payments/intents', {
          amount: request.amount,
          ledgerCanisterId,
          expectedSenderPrincipal,
          metadata: request.metadata || {},
        });
        paymentIntentId = intentResp?.paymentIntent?.id || null;
        paymentIntentCode = intentResp?.paymentIntent?.intentCode ?? null;
        debugLog(this.config.debug || false, 'payment intent created', { paymentIntentId, paymentIntentCode, expectedSenderPrincipal });
        // Emit transaction created event
        if (paymentIntentId) {
          this.emit('icpay-sdk-transaction-created', {
            paymentIntentId,
            amount: request.amount,
            ledgerCanisterId,
            expectedSenderPrincipal
          });
        }
      } catch (e) {
        // Do not proceed without a payment intent
        // Throw a standardized error so integrators can handle it consistently
        const err = new IcpayError({
          code: ICPAY_ERROR_CODES.API_ERROR,
          message: 'Failed to create payment intent. Please try again.',
          details: e,
          retryable: true,
          userAction: 'Try again'
        });
        this.emitError(err);
        throw err;
      }

      // Build packed memo if possible
      try {
        const acctIdNum = parseInt(accountCanisterId);
        if (!isNaN(acctIdNum) && paymentIntentCode != null) {
          memo = this.createPackedMemo(acctIdNum, Number(paymentIntentCode));
          debugLog(this.config.debug || false, 'built packed memo', { accountCanisterId: acctIdNum, paymentIntentCode });
        } else if (!isNaN(acctIdNum)) {
          memo = this.createMemoWithAccountCanisterId(acctIdNum);
          debugLog(this.config.debug || false, 'built legacy memo', { accountCanisterId: acctIdNum });
        }

        debugLog(this.config.debug || false, 'memo', { memo });
      } catch {}

      let transferResult;
      if (ledgerCanisterId === 'ryjl3-tyaaa-aaaaa-aaaba-cai') {
        // ICP Ledger: use ICRC-1 transfer (ICP ledger supports ICRC-1)
        debugLog(this.config.debug || false, 'sending ICRC-1 transfer (ICP)');
        transferResult = await this.sendFundsToLedger(
          ledgerCanisterId,
          toPrincipal,
          amount,
          memo,
          host
        );
      } else {
        // ICRC-1 ledgers: use principal directly
        debugLog(this.config.debug || false, 'sending ICRC-1 transfer');
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
      debugLog(this.config.debug || false, 'transfer result', { blockIndex });

      // First, notify the canister about the ledger transaction
      let canisterTransactionId: number;
      let notifyStatus: any = null;
      try {
        debugLog(this.config.debug || false, 'notifying canister about ledger tx');
        const notifyRes: any = await this.notifyLedgerTransaction(
          this.icpayCanisterId!,
          ledgerCanisterId,
          BigInt(blockIndex)
        );
        // notify returns { id, status, amount }
        if (typeof notifyRes === 'string') {
          canisterTransactionId = parseInt(notifyRes, 10);
        } else {
          canisterTransactionId = parseInt(notifyRes.id, 10);
          notifyStatus = notifyRes;
        }
        debugLog(this.config.debug || false, 'canister notified', { canisterTransactionId });
      } catch (notifyError) {
        canisterTransactionId = parseInt(blockIndex, 10);
        debugLog(this.config.debug || false, 'notify failed, using blockIndex as tx id', { canisterTransactionId });
      }

      // Poll for transaction status until completed
      // Use the transaction ID returned by the notification, not the block index
      let status: any = null;
      if (notifyStatus && notifyStatus.status) {
        status = { status: notifyStatus.status };
      } else {
        try {
          debugLog(this.config.debug || false, 'polling transaction status (public)', { canisterTransactionId });
          status = await this.pollTransactionStatus(this.icpayCanisterId!, canisterTransactionId, accountCanisterId as string, Number(blockIndex), 2000, 30);
          debugLog(this.config.debug || false, 'poll done', { status });
        } catch (e) {
          status = { status: 'pending' };
          debugLog(this.config.debug || false, 'poll failed, falling back to pending');
        }
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

      // 5) Notify API about completion with intent and transaction id
      // Optionally await based on config.awaitServerNotification
      let publicNotify: any = undefined;
      const notifyApi = async () => {
        const notifyClient = this.publicApiClient;
        const notifyPath = '/sdk/public/payments/notify';
        const maxNotifyAttempts = 5;
        const notifyDelayMs = 1000;
        for (let attempt = 1; attempt <= maxNotifyAttempts; attempt++) {
          try {
            debugLog(this.config.debug || false, 'notifying API about completion', { attempt, notifyPath, paymentIntentId, canisterTransactionId });
            const resp: any = await notifyClient.post(notifyPath, {
              paymentIntentId,
              canisterTxId: canisterTransactionId,
            });
            return resp;
          } catch (e: any) {
            const status = e?.response?.status;
            const data = e?.response?.data;
            debugLog(this.config.debug || false, 'API notify attempt failed', { attempt, status, data });
            // Proactively trigger a transaction sync if we get not found
            try {
              await this.triggerTransactionSync(canisterTransactionId);
            } catch {}
            if (attempt < maxNotifyAttempts) {
              await new Promise(r => setTimeout(r, notifyDelayMs));
            }
          }
        }
        debugLog(this.config.debug || false, 'API notify failed after retries (non-fatal)');
        return undefined;
      };

      if (this.config.awaitServerNotification) {
        publicNotify = await notifyApi();
      } else {
        // fire-and-forget
        notifyApi()
          .then((data) => {
            // Optionally emit a success for the async notify step
            this.emitMethodSuccess('sendFunds.notifyApi', { paymentIntentId, canisterTransactionId, data });
          })
          .catch((err) => {
            this.emitMethodError('sendFunds.notifyApi', err);
          });
      }

      const response = {
        transactionId: canisterTransactionId,
        status: statusString,
        amount: amount.toString(),
        recipientCanister: ledgerCanisterId,
        timestamp: new Date(),
        description: 'Fund transfer',
        metadata: request.metadata,
        payment: publicNotify
      };

      debugLog(this.config.debug || false, 'sendFunds done', response);
      if (statusString === 'completed') {
        this.emit('icpay-sdk-transaction-completed', response);
      } else if (statusString === 'failed') {
        this.emit('icpay-sdk-transaction-failed', response);
      } else {
        this.emit('icpay-sdk-transaction-updated', response);
      }
      this.emitMethodSuccess('sendFunds', response);
      return response;
    } catch (error) {
      if (error instanceof IcpayError) {
        this.emitMethodError('sendFunds', error);
        throw error;
      }
      const err = new IcpayError({
        code: 'TRANSACTION_FAILED',
        message: 'Failed to send funds',
        details: error
      });
      this.emitMethodError('sendFunds', err);
      throw err;
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
  async pollTransactionStatus(canisterId: string, transactionId: number, accountCanisterId: string, indexReceived: number, intervalMs = 2000, maxAttempts = 30): Promise<any> {
    this.emitMethodStart('pollTransactionStatus', { canisterId, transactionId, accountCanisterId, indexReceived, intervalMs, maxAttempts });
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Use public-only method
        let status = await this.getTransactionStatusPublic(canisterId, transactionId, indexReceived, accountCanisterId);

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
        // No secondary fallback to controller-only methods

        if (status && status.status) {
          if (this.isTransactionCompleted(status.status)) {
            this.emitMethodSuccess('pollTransactionStatus', { attempt, status });
            return status; // Return immediately when completed
          }
          // If not completed, continue polling
        }

        // Check if status is an object with Ok/Err pattern
        if (status && typeof status === 'object' && ((status as any).Ok || (status as any).Err)) {
          this.emitMethodSuccess('pollTransactionStatus', { attempt, status });
          return status; // Return immediately when we find a valid status
        }

        // Wait before next attempt (unless this is the last attempt)
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, intervalMs));
        }

      } catch (error) {
        if (attempt === maxAttempts - 1) {
          this.emitMethodError('pollTransactionStatus', error);
        }
        // Wait before next attempt
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
      }
    }

    const err = new Error('Transaction status polling timed out');
    this.emitMethodError('pollTransactionStatus', err);
    throw err;
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
   * Notify canister about ledger transaction using anonymous actor (no signature required)
   */
  async notifyLedgerTransaction(canisterId: string, ledgerCanisterId: string, blockIndex: bigint): Promise<string> {
    this.emitMethodStart('notifyLedgerTransaction', { canisterId, ledgerCanisterId, blockIndex: blockIndex.toString() });
    // Create anonymous actor for canister notifications (no signature required)
    const agent = new HttpAgent({ host: this.icHost });
    const actor = Actor.createActor(icpayIdl, { agent, canisterId });

    const result = await actor.notify_ledger_transaction({
      ledger_canister_id: ledgerCanisterId,
      block_index: blockIndex
    }) as any;

    if (result && result.Ok) {
      this.emitMethodSuccess('notifyLedgerTransaction', { result: result.Ok });
      return result.Ok;
    } else if (result && result.Err) {
      const err = new Error(result.Err);
      this.emitMethodError('notifyLedgerTransaction', err);
      throw err;
    } else {
      const err = new Error('Unexpected canister notify result');
      this.emitMethodError('notifyLedgerTransaction', err);
      throw err;
    }
  }

  async getTransactionStatusPublic(canisterId: string, canisterTransactionId: number, indexReceived: number, accountCanisterId: string): Promise<any> {
    this.emitMethodStart('getTransactionStatusPublic', { canisterId, canisterTransactionId, indexReceived, accountCanisterId });
    const agent = new HttpAgent({ host: this.icHost });
    const actor = Actor.createActor(icpayIdl, { agent, canisterId });
    const acctIdNum = parseInt(accountCanisterId);
    const res = await (actor as any).get_transaction_status_public(
      acctIdNum,
      BigInt(canisterTransactionId),
      [indexReceived]
    );
    const result = res || { status: 'pending' };
    this.emitMethodSuccess('getTransactionStatusPublic', result);
    return result;
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
    this.emitMethodStart('sendFundsToLedger', { ledgerCanisterId, toPrincipal, amount: amount.toString(), hasMemo: !!memo });
    let actor;
    if (this.actorProvider) {
      actor = this.actorProvider(ledgerCanisterId, ledgerIdl);
    } else {
      const err = new Error('actorProvider is required for sending funds');
      this.emitMethodError('sendFundsToLedger', err);
      throw err;
    }

    // ICRC-1 transfer
    const res = await actor.icrc1_transfer({
      to: { owner: Principal.fromText(toPrincipal), subaccount: [] },
      amount,
      fee: [], // Always include fee, even if empty
      memo: memo ? [memo] : [],
      from_subaccount: [],
      created_at_time: [],
    });
    this.emitMethodSuccess('sendFundsToLedger', res);
    return res;
  }

  /**
   * Get transaction by ID using get_transactions filter (alternative to get_transaction)
   */
  async getTransactionByFilter(transactionId: number): Promise<any> {
    this.emitMethodStart('getTransactionByFilter', { transactionId });
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
        this.emitMethodSuccess('getTransactionByFilter', { found: !!transaction });
        return transaction;
      }

      this.emitMethodSuccess('getTransactionByFilter', { found: false });
      return null;
    } catch (error) {
      this.emitMethodError('getTransactionByFilter', error);
      throw error;
    }
  }

  // ===== NEW ENHANCED SDK FUNCTIONS =====

  /**
   * Get balance for all verified ledgers for the connected wallet (public method)
   */
  async getAllLedgerBalances(): Promise<AllLedgerBalances> {
    this.emitMethodStart('getAllLedgerBalances');
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
          this.emit('icpay-sdk-method-error', {
            name: 'getAllLedgerBalances.getLedgerBalance',
            error,
            ledgerSymbol: ledger.symbol,
            ledgerCanisterId: ledger.canisterId
          });
          // Continue with other ledgers even if one fails
        }
      }

      const result = {
        balances,
        totalBalancesUSD: totalBalancesUSD > 0 ? totalBalancesUSD : undefined,
        lastUpdated: new Date()
      };
      this.emitMethodSuccess('getAllLedgerBalances', { count: balances.length, totalUSD: result.totalBalancesUSD });
      return result;
    } catch (error) {
      const err = new IcpayError({
        code: 'BALANCES_FETCH_FAILED',
        message: 'Failed to fetch all ledger balances',
        details: error
      });
      this.emitMethodError('getAllLedgerBalances', err);
      throw err;
    }
  }

  /**
   * Get balance for a specific ledger by canister ID (public method)
   */
  async getSingleLedgerBalance(ledgerCanisterId: string): Promise<LedgerBalance> {
    this.emitMethodStart('getSingleLedgerBalance', { ledgerCanisterId });
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

      const result = {
        ledgerId: ledger.id,
        ledgerName: ledger.name,
        ledgerSymbol: ledger.symbol,
        canisterId: ledger.canisterId,
        balance: rawBalance.toString(),
        formattedBalance,
        decimals: ledger.decimals,
        currentPrice: ledger.currentPrice || undefined,
        lastPriceUpdate: ledger.lastPriceUpdate ? new Date(ledger.lastPriceUpdate) : undefined,
        lastUpdated: new Date()
      };
      this.emitMethodSuccess('getSingleLedgerBalance', { ledgerCanisterId, balance: result.balance });
      return result;
    } catch (error) {
      const err = new IcpayError({
        code: 'SINGLE_BALANCE_FETCH_FAILED',
        message: `Failed to fetch balance for ledger ${ledgerCanisterId}`,
        details: error
      });
      this.emitMethodError('getSingleLedgerBalance', err);
      throw err;
    }
  }

  /**
   * Calculate token amount from USD price for a specific ledger (public method)
   */
  async calculateTokenAmountFromUSD(request: PriceCalculationRequest): Promise<PriceCalculationResult> {
    this.emitMethodStart('calculateTokenAmountFromUSD', { usdAmount: request.usdAmount, ledgerCanisterId: request.ledgerCanisterId, ledgerSymbol: request.ledgerSymbol });
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

      const result = {
        usdAmount,
        ledgerCanisterId: ledger.canisterId,
        ledgerSymbol: ledger.symbol,
        ledgerName: ledger.name,
        currentPrice: ledger.currentPrice,
        priceTimestamp: ledger.lastPriceUpdate ? new Date(ledger.lastPriceUpdate) : new Date(),
        tokenAmountHuman: tokenAmountHuman.toFixed(ledger.decimals),
        tokenAmountDecimals,
        decimals: ledger.decimals
      };
      this.emitMethodSuccess('calculateTokenAmountFromUSD', { ledgerCanisterId: result.ledgerCanisterId, tokenAmountDecimals });
      return result;
    } catch (error) {
      const err = new IcpayError({
        code: 'PRICE_CALCULATION_FAILED',
        message: 'Failed to calculate token amount from USD',
        details: error
      });
      this.emitMethodError('calculateTokenAmountFromUSD', err);
      throw err;
    }
  }

  /**
   * Get detailed ledger information including price data (public method)
   */
  async getLedgerInfo(ledgerCanisterId: string): Promise<SdkLedger> {
    this.emitMethodStart('getLedgerInfo', { ledgerCanisterId });
    try {
      const ledger = await this.publicApiClient.get(`/sdk/public/ledgers/${ledgerCanisterId}`);

      const result: SdkLedger = {
        id: ledger.id,
        name: ledger.name,
        symbol: ledger.symbol,
        canisterId: ledger.canisterId,
        standard: ledger.standard,
        decimals: ledger.decimals,
        logoUrl: ledger.logoUrl ?? null,
        verified: ledger.verified,
        fee: ledger.fee ?? null,
        network: ledger.network,
        description: ledger.description ?? null,
        lastBlockIndex: ledger.lastBlockIndex ?? null,
        coingeckoId: ledger.coingeckoId ?? null,
        currentPrice: ledger.currentPrice ?? null,
        priceFetchMethod: ledger.priceFetchMethod ?? null,
        lastPriceUpdate: ledger.lastPriceUpdate ?? null,
        createdAt: ledger.createdAt,
        updatedAt: ledger.updatedAt,
      };
      this.emitMethodSuccess('getLedgerInfo', { ledgerCanisterId });
      return result;
    } catch (error) {
      const err = new IcpayError({
        code: 'LEDGER_INFO_FETCH_FAILED',
        message: `Failed to fetch ledger info for ${ledgerCanisterId}`,
        details: error
      });
      this.emitMethodError('getLedgerInfo', err);
      throw err;
    }
  }

  /**
   * Send funds from USD to a specific ledger (public method)
   */
  async sendFundsUsd(request: SendFundsUsdRequest): Promise<TransactionResponse> {
    this.emitMethodStart('sendFundsUsd', { request });
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

      const res = await this.sendFunds(createTransactionRequest);
      this.emitMethodSuccess('sendFundsUsd', res);
      return res;
    } catch (error) {
      if (error instanceof IcpayError) {
        this.emitMethodError('sendFundsUsd', error);
        throw error;
      }
      const err = new IcpayError({
        code: 'SEND_FUNDS_USD_FAILED',
        message: 'Failed to send funds from USD',
        details: error
      });
      this.emitMethodError('sendFundsUsd', err);
      throw err;
    }
  }

    /**
   * Get all ledgers with price information (public method)
   */
  async getAllLedgersWithPrices(): Promise<SdkLedger[]> {
    this.emitMethodStart('getAllLedgersWithPrices');
    try {
      const response = await this.publicApiClient.get('/sdk/public/ledgers/all-with-prices');
      const result: SdkLedger[] = (response as any).map((ledger: any) => ({
        id: ledger.id,
        name: ledger.name,
        symbol: ledger.symbol,
        canisterId: ledger.canisterId,
        standard: ledger.standard,
        decimals: ledger.decimals,
        logoUrl: ledger.logoUrl ?? null,
        verified: ledger.verified,
        fee: ledger.fee ?? null,
        network: ledger.network,
        description: ledger.description ?? null,
        lastBlockIndex: ledger.lastBlockIndex ?? null,
        coingeckoId: ledger.coingeckoId ?? null,
        currentPrice: ledger.currentPrice ?? null,
        priceFetchMethod: ledger.priceFetchMethod ?? null,
        lastPriceUpdate: ledger.lastPriceUpdate ?? null,
        createdAt: ledger.createdAt,
        updatedAt: ledger.updatedAt,
      }));
      this.emitMethodSuccess('getAllLedgersWithPrices', { count: result.length });
      return result;
    } catch (error) {
      const err = new IcpayError({
        code: 'LEDGERS_WITH_PRICES_FETCH_FAILED',
        message: 'Failed to fetch ledgers with price information',
        details: error
      });
      this.emitMethodError('getAllLedgersWithPrices', err);
      throw err;
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
export * from './events';

// Default export
export default Icpay;