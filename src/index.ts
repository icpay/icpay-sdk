import { buildAndSignX402PaymentHeader } from './x402/builders';
import {
  IcpayConfig,
  CreateTransactionRequest,
  TransactionResponse,
  WalletConnectionResult,
  AllLedgerBalances,
  LedgerBalance,
  PriceCalculationRequest,
  PriceCalculationResult,
  CreatePaymentUsdRequest,
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
  private chainsCache: { data: import('./types').ChainPublic[] | null; timestamp: number } = { data: null, timestamp: 0 };
  private events: IcpayEventCenter;
  public protected: ProtectedApi;
  public readonly icpLedgerCanisterId = 'ryjl3-tyaaa-aaaaa-aaaba-cai';


  constructor(config: IcpayConfig) {
    this.config = {
      environment: 'production',
      apiUrl: 'https://api.icpay.org',
      debug: false,
      enableEvents: true,
      ...config,
      onrampDisabled: true,
    };

    debugLog(this.config.debug || false, 'constructor', { config: this.config });

    // Validate authentication configuration
    if (!this.config.publishableKey && !this.config.secretKey) {
      throw new Error('Either publishableKey or secretKey must be provided');
    }

    this.icHost = config.icHost || 'https://icp-api.io';
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

  /**
   * Notify ICPay to check status of a payment intent (public).
   */
  async notifyPayment(params: {
    paymentIntentId: string;
    canisterTxId?: number;
    transactionId?: string;
    orderId?: string;
  }): Promise<{
    paymentId: string | null;
    paymentIntentId: string | null;
    status: string;
    canisterTxId: number | null;
    transactionId: string | null;
    transactionSplitId: string | null;
    ledgerTxId: string | null;
    accountCanisterId: number | null;
    basePaymentAccountId: string | null;
    paymentIntent: any;
    payment: any;
  }> {
    this.emitMethodStart('notifyPayment', { paymentIntentId: params.paymentIntentId });
    try {
      const resp = await this.publicApiClient.post('/sdk/public/payments/notify', {
        paymentIntentId: params.paymentIntentId,
        canisterTxId: params.canisterTxId,
        transactionId: params.transactionId,
        orderId: params.orderId,
      });
      this.emitMethodSuccess('notifyPayment', { status: resp?.status, paymentIntentId: resp?.paymentIntentId });
      return resp;
    } catch (error) {
      this.emitMethodError('notifyPayment', error);
      throw error;
    }
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
   * Quote an ATXP request (public).
   */
  async quoteAtxpRequest(params: {
    toolType: string;
    params: any;
    metadata?: Record<string, unknown>;
    chatHash?: string;
  }): Promise<{
    ok: boolean;
    requestId: string;
    totalAmount: string | null;
    feeBreakdown: { platformPercentage: number; accountAtxpFeeBps: number };
  }> {
    this.emitMethodStart('quoteAtxpRequest', { hasParams: !!params });
    try {
      const resp = await this.publicApiClient.post('/sdk/public/atxp/quote', {
        toolType: params.toolType,
        params: params.params,
        metadata: params.metadata,
        chatHash: params.chatHash,
      });
      this.emitMethodSuccess('quoteAtxpRequest', { requestId: resp?.requestId, totalAmount: resp?.totalAmount });
      return resp;
    } catch (error) {
      this.emitMethodError('quoteAtxpRequest', error);
      throw error;
    }
  }

  /**
   * Create payment intent for ATXP request (public).
   */
  async payAtxpRequest(params: {
    requestId: string;
    tokenShortcode?: string;
    amount: string;
    description?: string;
  }): Promise<{
    ok: boolean;
    paymentIntentId: string;
    paymentIntent: any;
  }> {
    this.emitMethodStart('payAtxpRequest', { requestId: params.requestId });
    try {
      const endpoint = `/sdk/public/atxp/requests/${encodeURIComponent(params.requestId)}/payment-intents`;
      const resp = await this.publicApiClient.post(endpoint, {
        tokenShortcode: params.tokenShortcode,
        amount: params.amount,
        description: params.description,
      });
      this.emitMethodSuccess('payAtxpRequest', { paymentIntentId: resp?.paymentIntentId });
      return resp;
    } catch (error) {
      this.emitMethodError('payAtxpRequest', error);
      throw error;
    }
  }

  /**
   * Execute an ATXP request after payment (public).
   */
  async executeAtxpRequest(params: { requestId: string }): Promise<{ ok: boolean; result?: any }> {
    this.emitMethodStart('executeAtxpRequest', { requestId: params.requestId });
    try {
      const endpoint = `/sdk/public/atxp/requests/${encodeURIComponent(params.requestId)}/execute`;
      const resp = await this.publicApiClient.post(endpoint, {});
      this.emitMethodSuccess('executeAtxpRequest', { ok: resp?.ok });
      return resp;
    } catch (error) {
      this.emitMethodError('executeAtxpRequest', error);
      throw error;
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
        shortcode: ledger.shortcode ?? null,
        canisterId: ledger.canisterId,
        chainId: ledger.chainId,
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
   * Get enabled chains (public method)
   */
  async getChains(): Promise<import('./types').ChainPublic[]> {
    this.emitMethodStart('getChains');
    const now = Date.now();
    const cacheAge = 60 * 60 * 1000; // 60 minutes cache

    if (this.chainsCache.data && (now - this.chainsCache.timestamp) < cacheAge) {
      return this.chainsCache.data;
    }

    try {
      const resp = await this.publicApiClient.get('/sdk/public/chains');
      const chains: import('./types').ChainPublic[] = (resp as any).map((c: any) => ({
        id: c.id,
        chainType: c.chainType,
        chainName: c.chainName,
        chainId: c.chainId,
        shortcode: c.shortcode ?? null,
        contractAddress: c.contractAddress ?? null,
        enabled: !!c.enabled,
        rpcUrlPublic: c.rpcUrlPublic ?? null,
        explorerUrl: c.explorerUrl ?? null,
        nativeSymbol: c.nativeSymbol ?? null,
        confirmationsRequired: typeof c.confirmationsRequired === 'number' ? c.confirmationsRequired : parseInt(String(c.confirmationsRequired || 0), 10) || 0,
      }));

      this.chainsCache = { data: chains, timestamp: now };
      this.emitMethodSuccess('getChains', { count: chains.length });
      return chains;
    } catch (error) {
      const err = new IcpayError({
        code: ICPAY_ERROR_CODES.API_ERROR,
        message: 'Failed to fetch chains',
        details: error,
      });
      this.emitMethodError('getChains', err);
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
      // HttpClient returns parsed body directly (no {data} wrapper)
      this.accountInfoCache = response as any;
      if (response && (response as any).icpayCanisterId) {
        this.icpayCanisterId = (response as any).icpayCanisterId.toString();
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



  public async processPaymentByChain(params: {
    chainType?: string;
    chainId?: string | number; // UUID for IC/intent
    ledgerCanisterId?: string;
    toPrincipal?: string;
    amount: bigint;
    memo?: Uint8Array;
    host?: string;
    paymentIntentId: string;
    request: CreateTransactionRequest;
    resolvedAmountStr?: string;
    metadata?: any;
    onrampData?: any;
    contractAddress?: string;
    accountCanisterId?: string;
    rpcUrlPublic?: string | null;
    chainName?: string | null;
    rpcChainId?: string | number | null; // EVM numeric chain id
    paymentIntentCode?: number | null;
  }): Promise<TransactionResponse> {
    const normalized = (params.chainType || '').toLowerCase();
    switch (normalized) {
      case 'ic':
      case 'icp':
      case 'internet-computer':
        return await this.processICPayment(params);
      case 'evm':
      case 'ethereum':
        return await this.processEvmPayment(params);
      case 'solana':
        return await this.processSolanaPayment(params);
      case 'sui':
        throw new IcpayError({
          code: ICPAY_ERROR_CODES.INVALID_CONFIG,
          message: 'Sui payments are not implemented yet',
          details: { chainType: params.chainType, chainId: params.chainId }
        });
      case 'onramp':
        return {
          transactionId: 0,
          status: 'pending',
          amount: params.resolvedAmountStr || params.amount.toString(),
          recipientCanister: params.ledgerCanisterId!,
          timestamp: new Date(),
          metadata: { icpay_payment_intent_id: params.paymentIntentId, icpay_onramp: params.onrampData || true },
        } as any;
      default:
        throw new IcpayError({
          code: ICPAY_ERROR_CODES.INVALID_CONFIG,
          message: 'Unknown or missing chain type for payment processing',
          details: { chainType: params.chainType, chainId: params.chainId }
        });
    }
  }

  // Public helper: build EVM bytes32 id from accountId and intentCode
  // Layout matches PaymentProcessor.packId(accountId, appId):
  // high 8 bytes = uint64(accountId) big-endian; low 24 bytes = bytes24 with intentCode in the lowest 4 bytes (big-endian)
  public packEvmId(accountCanisterId: number | string, intentCode: number | string): string {
    const accountIdNum = BigInt(accountCanisterId as any);
    const intentCodeNum = BigInt(intentCode as any);
    const out = new Uint8Array(32);
    // high 8 bytes (big-endian) accountId
    for (let i = 0; i < 8; i++) {
      out[i] = Number((accountIdNum >> BigInt(8 * (7 - i))) & 0xffn);
    }
    // next 20 bytes are zero
    // last 4 bytes = intentCode big-endian
    out[28] = Number((intentCodeNum >> 24n) & 0xffn);
    out[29] = Number((intentCodeNum >> 16n) & 0xffn);
    out[30] = Number((intentCodeNum >> 8n) & 0xffn);
    out[31] = Number(intentCodeNum & 0xffn);
    const bytesToHex = (u: Uint8Array): string => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('');
    return bytesToHex(out);
  }

  private async processICPayment(params: {
    ledgerCanisterId?: string;
    amount: bigint;
    memo?: Uint8Array;
    paymentIntentId: string;
    request: CreateTransactionRequest;
    metadata?: any;
    contractAddress?: string | null;
  }): Promise<TransactionResponse> {
    const { ledgerCanisterId, amount, memo, paymentIntentId, request, metadata } = params;

    // Prefer contractAddress from intent (for IC, this is the canister id)
    let toPrincipal = (params.contractAddress && typeof params.contractAddress === 'string') ? params.contractAddress : undefined;
    const host = this.icHost;
    if (!toPrincipal) {
      if (!this.icpayCanisterId) {
        await this.fetchAccountInfo();
      }
      if (!this.icpayCanisterId) {
        try {
          const acct = await this.getAccountInfo();
          if ((acct as any)?.icpayCanisterId) {
            this.icpayCanisterId = (acct as any).icpayCanisterId.toString();
          }
        } catch {}
      }
      if (!this.icpayCanisterId || typeof this.icpayCanisterId !== 'string') {
        const err = new IcpayError({
          code: ICPAY_ERROR_CODES.INVALID_CONFIG,
          message: 'Could not resolve ICPay canister ID from account info',
          details: { accountInfoCache: this.accountInfoCache }
        });
        this.emitMethodError('createPayment', err);
        throw err;
      }
      toPrincipal = this.icpayCanisterId;
    }

    this.icpayCanisterId = toPrincipal;

    // Ensure Plug has whitelisted the target application canister before initiating transfer
    try {
      const isBrowser = typeof window !== 'undefined';
      const appCanisterId = (typeof toPrincipal === 'string' && toPrincipal.trim().length > 0) ? toPrincipal : null;
      // Only attempt Plug whitelist when NOT using a provided actorProvider.
      // If actorProvider is present (e.g., Oisy SignerAgent), we must not trigger Plug.
      const shouldWhitelistPlug = (!this.actorProvider) && isBrowser && appCanisterId && (window as any)?.ic?.plug?.requestConnect;
      if (shouldWhitelistPlug) {
        await (window as any).ic.plug.requestConnect({ host, whitelist: [appCanisterId] });
      }
    } catch {
      // Non-fatal; continue even if whitelist step fails (wallet may already trust canister)
    }

    let transferResult;
    try {
      // ICP Ledger: use ICRC-1 transfer (ICP ledger supports ICRC-1)
      debugLog(this.config.debug || false, 'sending ICRC-1 transfer (ICP)');
      transferResult = await this.sendFundsToLedger(
        ledgerCanisterId!,
        toPrincipal!,
        amount,
        memo,
        host
      );
    } catch (transferError: any) {
      // Some wallets/networks return a timeout or transient 5xx even when the transfer was accepted.
      // Treat these as processing and continue with intent notification so users don't double-send.
      const msg = String(transferError?.message || '');
      const lower = msg.toLowerCase();
      const isTimeout = lower.includes('request timed out');
      const isProcessing = isTimeout && lower.includes('processing');
      // DFINITY HTTP agent transient error when subnet has no healthy nodes (e.g., during upgrade)
      const isNoHealthyNodes = lower.includes('no_healthy_nodes') || lower.includes('service unavailable') || lower.includes('503');
      // Plug inpage transport sometimes throws readState errors after a signed call even though the tx went through
      const isPlugReadState = lower.includes('read state request') || lower.includes('readstate') || lower.includes('response could not be found');
      if (isTimeout || isProcessing || isNoHealthyNodes || isPlugReadState) {
        debugLog(this.config.debug || false, 'transfer timed out, proceeding with intent notification', { message: msg });
        // Long-poll the public notify endpoint using only the intent id (no canister tx id available)
        const publicNotify = await this.performNotifyPaymentIntent({
          paymentIntentId: paymentIntentId!,
          maxAttempts: 120,
          delayMs: 1000,
        });
        // Derive status from API response
        let statusString: 'pending' | 'completed' | 'failed' = 'pending';
        const apiStatus = (publicNotify as any)?.paymentIntent?.status || (publicNotify as any)?.payment?.status || (publicNotify as any)?.status;
        if (typeof apiStatus === 'string') {
          const norm = apiStatus.toLowerCase();
          if (norm === 'completed' || norm === 'succeeded') statusString = 'completed';
          else if (norm === 'failed' || norm === 'canceled' || norm === 'cancelled') statusString = 'failed';
        }
        const response = {
          transactionId: 0,
          status: statusString,
          amount: amount.toString(),
          recipientCanister: ledgerCanisterId,
          timestamp: new Date(),
          description: 'Fund transfer',
          metadata: request.metadata,
          payment: publicNotify,
        } as any;
        if (statusString === 'completed') {
          const requested = (publicNotify as any)?.payment?.requestedAmount || null;
          const paid = (publicNotify as any)?.payment?.paidAmount || null;
          const isMismatched = (publicNotify as any)?.payment?.status === 'mismatched';
          if (isMismatched) {
            this.emit('icpay-sdk-transaction-mismatched', { ...response, requestedAmount: requested, paidAmount: paid });
            this.emit('icpay-sdk-transaction-updated', { ...response, status: 'mismatched', requestedAmount: requested, paidAmount: paid });
          } else {
            this.emit('icpay-sdk-transaction-completed', response);
          }
        } else if (statusString === 'failed') {
          this.emit('icpay-sdk-transaction-failed', response);
        } else {
          this.emit('icpay-sdk-transaction-updated', response);
        }
        return response;
      }
      throw transferError;
    }

    // Assume transferResult returns a block index or transaction id
    const blockIndex = transferResult?.Ok?.toString() || transferResult?.blockIndex?.toString() || `temp-${Date.now()}`;
    debugLog(this.config.debug || false, 'transfer result', { blockIndex });

    // First, notify the canister about the ledger transaction (best-effort)
    let canisterTransactionId: number | undefined;
    try {
      debugLog(this.config.debug || false, 'notifying canister about ledger tx', { icpayCanisterId: this.icpayCanisterId, ledgerCanisterId, blockIndex });
      const notifyRes: any = await this.notifyLedgerTransaction(
        this.icpayCanisterId!,
        ledgerCanisterId!,
        BigInt(blockIndex)
      );
      if (typeof notifyRes === 'string') {
        const parsed = parseInt(notifyRes, 10);
        canisterTransactionId = Number.isFinite(parsed) ? parsed : undefined;
      } else if (notifyRes && typeof notifyRes.id !== 'undefined') {
        const parsed = parseInt(String((notifyRes as any).id), 10);
        canisterTransactionId = Number.isFinite(parsed) ? parsed : undefined;
      } else {
        canisterTransactionId = undefined;
      }
      debugLog(this.config.debug || false, 'canister notified', { canisterTransactionId });
    } catch (notifyError) {
      // Do not fall back to ledger block index as canister tx id; let API resolve by intent id
      canisterTransactionId = undefined;
      debugLog(this.config.debug || false, 'notify failed; proceeding without canister tx id', { error: (notifyError as any)?.message });
    }

    // Durable wait until API returns terminal status (completed/mismatched/failed/canceled)
    const finalResponse = await this.awaitIntentTerminal({
      paymentIntentId: paymentIntentId!,
      canisterTransactionId: (typeof canisterTransactionId === 'number' && Number.isFinite(canisterTransactionId)) ? String(canisterTransactionId) : undefined,
      ledgerCanisterId: ledgerCanisterId!,
      amount: amount.toString(),
      metadata: metadata ?? request.metadata,
    });
    return finalResponse;
  }

  private async processSolanaPayment(params: {
    chainId?: string | number;
    ledgerCanisterId?: string; // For Solana: SPL mint address (or empty/native)
    contractAddress?: string | null; // Solana program ID (icpay program)
    accountCanisterId?: string;
    amount: bigint; // smallest unit
    memo?: Uint8Array;
    paymentIntentId: string;
    request: CreateTransactionRequest;
    metadata?: any;
    rpcUrlPublic?: string | null;
    chainName?: string | null;
    rpcChainId?: string | number | null; // unused
    paymentIntentCode?: number | null;
  }): Promise<TransactionResponse> {
    if (!params.contractAddress) {
      throw new IcpayError({
        code: ICPAY_ERROR_CODES.INVALID_CONFIG,
        message: 'Missing Solana program address in payment intent',
      });
    }
    const w: any = (globalThis as any)?.window || (globalThis as any);
    const sol = (this.config as any)?.solanaProvider || w?.solana;
    if (!sol) {
      throw new IcpayError({
        code: ICPAY_ERROR_CODES.WALLET_PROVIDER_NOT_AVAILABLE,
        message: 'Solana provider not available (window.solana)',
      });
    }
    // Ensure connected & resolve payer pubkey
    let payerKey: string | null = null;
    try {
      if (!sol.publicKey) {
        await (sol.connect ? sol.connect() : sol.request?.({ method: 'connect' }));
      }
      const pk = sol.publicKey || sol?.wallet?.publicKey;
      payerKey = pk ? String(pk) : null;
    } catch {}
    if (!payerKey) {
      throw new IcpayError({ code: ICPAY_ERROR_CODES.WALLET_NOT_CONNECTED, message: 'Solana wallet not connected' });
    }
    // If API already provided a prebuilt unsigned transaction, prefer it to avoid extra roundtrip
    const prebuiltBase64: string | undefined = (params.request as any)?.__transactionBase64 || undefined;
    // Strategy: build fresh tx first to ensure recent blockhash; fall back to prebuilt if build fails
    if (false && prebuiltBase64 && typeof prebuiltBase64 === 'string' && prebuiltBase64.length > 0) {
      let signature: string;
      try {
        // Prefer request-based API with base64 (broad wallet compatibility, including Phantom)
        if (sol?.request) {
          try {
            signature = await sol.request({ method: 'signAndSendTransaction', params: { transaction: prebuiltBase64 } });
          } catch {
            // Try base64 under "message", then base58 as last resort
            try {
              signature = await sol.request({ method: 'signAndSendTransaction', params: { message: prebuiltBase64 } });
            } catch {
              const toU8 = (b64: string): Uint8Array => {
                try {
                  if (typeof atob === 'function') {
                    const bin = atob(b64);
                    const out = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
                    return out;
                  }
                } catch {}
                const buf: any = (globalThis as any).Buffer?.from(b64, 'base64');
                return buf ? new Uint8Array(buf) : new Uint8Array();
              };
              const base58Encode = (bytes: Uint8Array): string => {
                const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
                let x = BigInt(0);
                for (let i = 0; i < bytes.length; i++) {
                  x = (x << 8n) + BigInt(bytes[i]);
                }
                let out = '';
                while (x > 0) {
                  const mod = Number(x % 58n);
                  out = alphabet[mod] + out;
                  x = x / 58n;
                }
                // preserve leading zeros
                for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out = '1' + out;
                return out || '1';
              };
              const b58 = base58Encode(toU8(prebuiltBase64));
              signature = await sol.request({ method: 'signAndSendTransaction', params: { message: b58 } });
            }
          }
        } else if (typeof sol.signAndSendTransaction === 'function') {
          // As a last resort, try passing bytes
          const toU8 = (b64: string): Uint8Array => {
            try {
              if (typeof atob === 'function') {
                const bin = atob(b64);
                const out = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
                return out;
              }
            } catch {}
            const buf: any = (globalThis as any).Buffer?.from(b64, 'base64');
            return buf ? new Uint8Array(buf) : new Uint8Array();
          };
          const res = await sol.signAndSendTransaction(toU8(prebuiltBase64));
          signature = (res && (res.signature || res.txid)) || (typeof res === 'string' ? res : '');
        } else {
          throw new Error('Unsupported Solana wallet interface');
        }
        if (!signature) {
          throw new Error('Missing Solana transaction signature');
        }
      } catch (e: any) {
        try { debugLog(this.config.debug || false, 'solana tx error (prebuilt)', { message: e?.message }); } catch {}
        throw new IcpayError({ code: ICPAY_ERROR_CODES.TRANSACTION_FAILED, message: 'Solana transaction failed', details: e });
      }
      try { this.emitMethodSuccess('notifyLedgerTransaction', { paymentIntentId: params.paymentIntentId }); } catch {}
      try {
        await this.performNotifyPaymentIntent({ paymentIntentId: params.paymentIntentId, transactionId: signature, maxAttempts: 1 });
      } catch {}
      const finalResponse = await this.awaitIntentTerminal({
        paymentIntentId: params.paymentIntentId,
        transactionId: signature,
        ledgerCanisterId: params.ledgerCanisterId!,
        amount: params.amount.toString(),
        metadata: { ...(params.metadata || {}), icpay_solana_tx_sig: signature },
      });
      return finalResponse;
    }
    // Otherwise, ask API/services to build an unsigned serialized transaction (base64) for this intent
    const externalCostStr = (params.request as any)?.__externalCostAmount;
    const body: any = {
      paymentIntentId: params.paymentIntentId,
      payer: payerKey,
      programId: params.contractAddress,
      mint: params.ledgerCanisterId || null,
      amount: params.amount.toString(),
      accountCanisterId: params.accountCanisterId,
      paymentIntentCode: params.paymentIntentCode,
      externalCostAmount: externalCostStr != null && externalCostStr !== '' ? String(externalCostStr) : undefined,
      rpcUrlPublic: params.rpcUrlPublic || undefined,
    };
    let txBase64: string = '';
    try {
      // Endpoint implemented in icpay-api -> icpay-services
      const resp = await this.publicApiClient.post('/sdk/public/payments/solana/build', body);
      txBase64 = (resp?.transactionBase64 || resp?.transaction || resp?.message || '').toString();
      if (!txBase64) {
        throw new Error('API did not return a Solana transaction');
      }
    } catch (e: any) {
      throw new IcpayError({ code: ICPAY_ERROR_CODES.API_ERROR, message: 'Failed to build Solana transaction', details: e });
    }

    // Ask wallet to sign and send using base64 message (no web3.js needed)
    let signature: string;
    try {
      // Prefer request-based API with base64
      if (sol?.request) {
        try {
          signature = await sol.request({
            method: 'signAndSendTransaction',
            params: { transaction: txBase64 },
          });
        } catch {
          // Try base64 under "message", then base58
          try {
            signature = await sol.request({
              method: 'signAndSendTransaction',
              params: { message: txBase64 },
            });
          } catch {
            const toU8 = (b64: string): Uint8Array => {
              try {
                if (typeof atob === 'function') {
                  const bin = atob(b64);
                  const out = new Uint8Array(bin.length);
                  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
                  return out;
                }
              } catch {}
              const buf: any = (globalThis as any).Buffer?.from(b64, 'base64');
              return buf ? new Uint8Array(buf) : new Uint8Array();
            };
            const base58Encode = (bytes: Uint8Array): string => {
              const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
              let x = BigInt(0);
              for (let i = 0; i < bytes.length; i++) {
                x = (x << 8n) + BigInt(bytes[i]);
              }
              let out = '';
              while (x > 0) {
                const mod = Number(x % 58n);
                out = alphabet[mod] + out;
                x = x / 58n;
              }
              for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out = '1' + out;
              return out || '1';
            };
            const b58 = base58Encode(toU8(txBase64));
            signature = await sol.request({
              method: 'signAndSendTransaction',
              params: { message: b58 },
            });
          }
        }
      } else if (typeof sol.signAndSendTransaction === 'function') {
        const toU8 = (b64: string): Uint8Array => {
          try {
            if (typeof atob === 'function') {
              const bin = atob(b64);
              const out = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
              return out;
            }
          } catch {}
          const buf: any = (globalThis as any).Buffer?.from(b64, 'base64');
          return buf ? new Uint8Array(buf) : new Uint8Array();
        };
        const res = await sol.signAndSendTransaction(toU8(txBase64));
        signature = (res && (res.signature || res.txid)) || (typeof res === 'string' ? res : '');
      } else {
        throw new Error('Unsupported Solana wallet interface');
      }
      if (!signature) {
        throw new Error('Missing Solana transaction signature');
      }
    } catch (e: any) {
      try { debugLog(this.config.debug || false, 'solana tx error', { message: e?.message }); } catch {}
      throw new IcpayError({ code: ICPAY_ERROR_CODES.TRANSACTION_FAILED, message: 'Solana transaction failed', details: e });
    }

    // Notify API with signature and wait for terminal status
    try { this.emitMethodSuccess('notifyLedgerTransaction', { paymentIntentId: params.paymentIntentId }); } catch {}
    try {
      await this.performNotifyPaymentIntent({ paymentIntentId: params.paymentIntentId, transactionId: signature, maxAttempts: 1 });
    } catch {}
    const finalResponse = await this.awaitIntentTerminal({
      paymentIntentId: params.paymentIntentId,
      transactionId: signature,
      ledgerCanisterId: params.ledgerCanisterId!,
      amount: params.amount.toString(),
      metadata: { ...(params.metadata || {}), icpay_solana_tx_sig: signature },
    });
    return finalResponse;
  }

  private async processEvmPayment(params: {
    chainId?: string | number; // intent UUID
    ledgerCanisterId?: string;
    contractAddress?: string | null;
    accountCanisterId?: string;
    amount: bigint;
    memo?: Uint8Array;
    paymentIntentId: string;
    request: CreateTransactionRequest;
    metadata?: any;
    rpcUrlPublic?: string | null;
    chainName?: string | null;
    rpcChainId?: string | number | null;
    paymentIntentCode?: number | null;
  }): Promise<TransactionResponse> {
    const contractAddress = params.contractAddress;
    if (!contractAddress) {
      throw new IcpayError({
        code: ICPAY_ERROR_CODES.INVALID_CONFIG,
        message: 'Missing EVM contract address in payment intent',
      });
    }
    const eth = (this.config as any)?.evmProvider || (globalThis as any)?.ethereum || (typeof window !== 'undefined' ? (window as any).ethereum : null);
    if (!eth || !eth.request) {
      throw new IcpayError({
        code: ICPAY_ERROR_CODES.WALLET_PROVIDER_NOT_AVAILABLE,
        message: 'EVM provider not available (window.ethereum)',
      });
    }

    // Ensure correct chain if provided
    try {
      const desiredChain = params.rpcChainId ?? null;
      if (desiredChain != null) {
        const currentHex: string = await eth.request({ method: 'eth_chainId' });
        const currentDec = parseInt(currentHex, 16);
        const desiredDec = typeof desiredChain === 'string' && String(desiredChain).startsWith('0x') ? parseInt(String(desiredChain), 16) : parseInt(String(desiredChain), 10);
        if (Number.isFinite(desiredDec) && currentDec !== desiredDec) {
          const hex = '0x' + desiredDec.toString(16);
          try {
            await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
          } catch (e: any) {
            // best-effort add & switch if we have chainName/rpcUrlPublic
            const rpcUrls: string[] = (params.rpcUrlPublic ? [String(params.rpcUrlPublic)] : []).filter(Boolean) as string[];
            const chainName = String(params.chainName || `Network ${desiredDec}`);
            if (rpcUrls.length > 0) {
              try {
                await eth.request({
                  method: 'wallet_addEthereumChain',
                  params: [{ chainId: hex, chainName, rpcUrls }],
                });
              } catch (e2: any) {
                throw new IcpayError({ code: ICPAY_ERROR_CODES.INVALID_CONFIG, message: 'Wrong EVM network. Switch wallet to the correct chain.' });
              }
            } else {
              throw new IcpayError({ code: ICPAY_ERROR_CODES.INVALID_CONFIG, message: 'Wrong EVM network. Switch wallet to the correct chain.' });
            }
          }
        }
      }
    } catch {}

    const tokenAddress: string | null = params.ledgerCanisterId || null;
    const isNative = !tokenAddress || /^0x0{40}$/i.test(String(tokenAddress));
    const amountHex = '0x' + params.amount.toString(16);

    // ABI encoding helpers
    const toUint64 = (n: bigint): string => n.toString(16).padStart(64, '0');
    const toAddressPadded = (addr: string): string => addr.replace(/^0x/i, '').padStart(64, '0');
    const toUint256 = (n: bigint): string => n.toString(16).padStart(64, '0');
    // Prefer selectors from API; otherwise fallback to constants provided by backend
    const apiSelectors = (params.request as any).__functionSelectors || {};
    const selector = {
      // API provides the overloaded signatures under these names
      payNative: apiSelectors.payNative || '0x4e47ff88',   // payNative(bytes32,uint64,uint256)
      payERC20: apiSelectors.payERC20 || '0x87b9fed2',     // payERC20(bytes32,uint64,address,uint256,uint256)
    } as const;
    // Build EVM id bytes32 using shared helper
    const accountIdNum = BigInt(params.accountCanisterId || 0);
    const idHex = this.packEvmId(String(accountIdNum), Number(params.paymentIntentCode ?? 0));

    // Debug: summarize EVM call parameters
    try {
      debugLog(this.config.debug || false, 'evm params', {
        chainId: params.chainId,
        contractAddress,
        tokenAddress,
        isNative,
        amount: params.amount?.toString?.(),
        amountHex,
        accountCanisterId: params.accountCanisterId,
        memoLen: params.memo?.length,
        idHexLen: idHex?.length,
        selectorPayNative: selector.payNative,
        selectorPayERC20: selector.payERC20,
      });
    } catch {}

    // Helper to poll receipt until mined or timeout
    const waitForReceipt = async (hash: string, attempts = 60, delayMs = 1000): Promise<any> => {
      for (let i = 0; i < attempts; i++) {
        try {
          const receipt = await eth.request({ method: 'eth_getTransactionReceipt', params: [hash] });
          if (receipt && receipt.blockNumber) return receipt;
        } catch {}
        await new Promise(r => setTimeout(r, delayMs));
      }
      return null;
    };

    let txHash: string;
    try {
      // Resolve owner (from address) once for all EVM calls
      const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' });
      const lowerAccounts = Array.isArray(accounts) ? accounts.map((a: string) => String(a).toLowerCase()) : [];
      const provided = ((params.request as any)?.expectedSenderPrincipal || '').toString().toLowerCase();
      let owner = '';
      if (provided && lowerAccounts.includes(provided)) {
        owner = accounts[lowerAccounts.indexOf(provided)] || '';
      } else {
        owner = (accounts && accounts[0]) || '';
      }
      if (!owner) throw new IcpayError({ code: ICPAY_ERROR_CODES.WALLET_NOT_CONNECTED, message: 'EVM wallet not connected' });
      debugLog(this.config.debug || false, 'evm from account', { owner });

      if (isNative) {
        const externalCostStr = (params.request as any)?.__externalCostAmount;
        const externalCost = externalCostStr != null && externalCostStr !== '' ? BigInt(String(externalCostStr)) : 0n;
        const extSel = selector.payNative;
        if (!extSel) {
          throw new IcpayError({ code: ICPAY_ERROR_CODES.INVALID_CONFIG, message: 'Missing payNative overload selector from API; update API/chain metadata.' });
        }
        const data = extSel + idHex + toUint64(accountIdNum) + toUint256(externalCost);
        debugLog(this.config.debug || false, 'evm native tx', { to: contractAddress, from: owner, dataLen: data.length, value: amountHex });
        txHash = await eth.request({ method: 'eth_sendTransaction', params: [{ from: owner, to: contractAddress, data, value: amountHex }] });
      } else {
        // Ensure allowance(owner -> spender=contractAddress)
        const allowanceSelector = '0xdd62ed3e'; // allowance(address,address)
        const approveSelector = '0x095ea7b3';   // approve(address,uint256)
        const allowanceData = allowanceSelector + toAddressPadded(owner) + toAddressPadded(contractAddress);
        debugLog(this.config.debug || false, 'evm erc20 allowance', { owner, spender: contractAddress, token: tokenAddress, data: allowanceData });
        let allowanceHex: string = await eth.request({ method: 'eth_call', params: [{ to: String(tokenAddress), data: allowanceData }, 'latest'] });
        if (typeof allowanceHex === 'string' && allowanceHex.startsWith('0x')) {
          const allowance = BigInt(allowanceHex);
          debugLog(this.config.debug || false, 'evm erc20 allowance result', { allowance: allowance.toString() });
          if (allowance < params.amount) {
            const approveData = approveSelector + toAddressPadded(contractAddress) + toUint256(params.amount);
            debugLog(this.config.debug || false, 'evm erc20 approve', { to: tokenAddress, from: owner, dataLen: approveData.length, amount: params.amount.toString() });
            const approveTx = await eth.request({ method: 'eth_sendTransaction', params: [{ from: owner, to: String(tokenAddress), data: approveData }] });
            debugLog(this.config.debug || false, 'evm erc20 approve sent', { tx: approveTx });
            await waitForReceipt(approveTx, 90, 1000);
          }
        }
        const externalCostStr = (params.request as any)?.__externalCostAmount;
        const externalCost = externalCostStr != null && externalCostStr !== '' ? BigInt(String(externalCostStr)) : 0n;
        const extSel = selector.payERC20;
        if (!extSel) {
          throw new IcpayError({ code: ICPAY_ERROR_CODES.INVALID_CONFIG, message: 'Missing payERC20 overload selector from API; update API/chain metadata.' });
        }
        const data = extSel + idHex + toUint64(accountIdNum) + toAddressPadded(String(tokenAddress)) + toUint256(params.amount) + toUint256(externalCost);
        debugLog(this.config.debug || false, 'evm erc20 pay', { to: contractAddress, from: owner, token: tokenAddress, dataLen: data.length });
        txHash = await eth.request({ method: 'eth_sendTransaction', params: [{ from: owner, to: contractAddress, data }] });
      }
    } catch (e: any) {
      try { debugLog(this.config.debug || false, 'evm tx error', { message: e?.message, code: e?.code, data: e?.data, error: e }); } catch {}
      throw new IcpayError({ code: ICPAY_ERROR_CODES.TRANSACTION_FAILED, message: 'EVM transaction failed', details: e });
    }

    // Notify API with tx hash and wait for terminal status
    try { this.emitMethodSuccess('notifyLedgerTransaction', { paymentIntentId: params.paymentIntentId }); } catch {}
    // Inform API immediately with tx hash so it can start indexing
    try {
      await this.performNotifyPaymentIntent({ paymentIntentId: params.paymentIntentId, transactionId: txHash, maxAttempts: 1 });
    } catch {}
    const finalResponse = await this.awaitIntentTerminal({
      paymentIntentId: params.paymentIntentId,
      transactionId: txHash,
      ledgerCanisterId: params.ledgerCanisterId!,
      amount: params.amount.toString(),
      metadata: { ...(params.metadata || {}), icpay_evm_tx_hash: txHash },
    });
    return finalResponse;
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
      // Retry on transient certificate TrustError (clock skew) a few times
      const maxAttempts = 3;
      let lastErr: any = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
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
        } catch (e: any) {
          lastErr = e;
          const msg = String(e?.message || '').toLowerCase();
          const isCertSkew = msg.includes('certificate is signed more than') || msg.includes('trusterror');
          if (attempt < maxAttempts && isCertSkew) {
            await new Promise(r => setTimeout(r, attempt * 500));
            continue;
          }
          throw e;
        }
      }
      throw lastErr || new Error('Failed to fetch ledger balance');
    } catch (error) {
      this.emitMethodError('getLedgerBalance', error);
      throw error;
    }
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
   * Create a payment to a specific canister/ledger (public method)
   * This is now a real transaction
   */
  async createPayment(request: CreateTransactionRequest): Promise<TransactionResponse> {
    this.emitMethodStart('createPayment', { request: { ...request, amount: typeof request.amount === 'string' ? request.amount : String(request.amount) } });
    try {
      debugLog(this.config.debug || false, 'createPayment start', { request });
      // Resolve ledgerCanisterId from symbol if needed (legacy). If tokenShortcode provided, no resolution required.
      let ledgerCanisterId = request.ledgerCanisterId;
      const tokenShortcode: string | undefined = (request as any)?.tokenShortcode;
      if (!ledgerCanisterId && !tokenShortcode && !(request as any).symbol) {
        const err = new IcpayError({
          code: ICPAY_ERROR_CODES.INVALID_CONFIG,
          message: 'Provide either tokenShortcode or ledgerCanisterId (symbol is deprecated).',
          details: { request }
        });
        this.emitMethodError('createPayment', err);
        throw err;
      }

      let memo: Uint8Array | undefined = undefined;

      // 1) Create payment intent via API (backend will finalize amount/price)
      let paymentIntentId: string | null = null;
      let paymentIntentCode: number | null = null;
      let intentChainType: string | undefined;
      let intentChainId: string | number | undefined;
      let accountCanisterId: string;
      let resolvedAmountStr: string | undefined = typeof request.amount === 'string' ? request.amount : (request.amount != null ? String(request.amount) : undefined);
      try {
        debugLog(this.config.debug || false, 'creating payment intent');

        // Expected sender principal: allow override via request, fallback to connected wallet, then EVM provider
        let expectedSenderPrincipal: string | undefined = (request as any).expectedSenderPrincipal
          || this.connectedWallet?.owner
          || this.connectedWallet?.principal?.toString();
        const evm = (this.config as any)?.evmProvider || (globalThis as any)?.ethereum;
        if (evm?.request) {
          try {
            const accounts: string[] = await evm.request({ method: 'eth_accounts' });
            if (Array.isArray(accounts) && accounts[0]) {
              const lowerAccounts = accounts.map((a: string) => String(a).toLowerCase());
              const providedRaw = (request as any)?.expectedSenderPrincipal;
              if (providedRaw) {
                const provided = String(providedRaw).toLowerCase();
                expectedSenderPrincipal = lowerAccounts.includes(provided)
                  ? accounts[lowerAccounts.indexOf(provided)]
                  : (expectedSenderPrincipal || accounts[0]);
              } else if (!expectedSenderPrincipal) {
                expectedSenderPrincipal = accounts[0];
              }
            }
          } catch {}
        }
        if (!expectedSenderPrincipal) {
          throw new IcpayError({
            code: ICPAY_ERROR_CODES.WALLET_NOT_CONNECTED,
            message: 'Wallet must be connected to create payment intent',
            details: { connectedWallet: this.connectedWallet },
            retryable: false,
            userAction: 'Connect your wallet first'
          });
        }

        const onramp = (request.onrampPayment === true || this.config.onrampPayment === true) && this.config.onrampDisabled !== true ? true : false;
        const meta: any = request?.metadata || {};
        const isAtxp = Boolean(meta?.icpay_atxp_request) && typeof (meta?.atxp_request_id) === 'string';
        let intentResp: any;
        if (isAtxp) {
          // Route ATXP intents to the ATXP endpoint so they link to the request
          const atxpRequestId = String(meta.atxp_request_id);
          const endpoint = `/sdk/public/atxp/requests/${encodeURIComponent(atxpRequestId)}/payment-intents`;
          intentResp = await this.publicApiClient.post(endpoint, {
            tokenShortcode: tokenShortcode || undefined,
            description: (request as any).description,
          });
        } else {
          intentResp = await this.publicApiClient.post('/sdk/public/payments/intents', {
            amount: (typeof request.amount === 'string' ? request.amount : (request.amount != null ? String(request.amount) : undefined)),
            // Prefer tokenShortcode if provided
            tokenShortcode: tokenShortcode || undefined,
            // Legacy fields for backwards compatibility
            symbol: tokenShortcode ? undefined : (request as any).symbol,
            ledgerCanisterId: tokenShortcode ? undefined : ledgerCanisterId,
            description: (request as any).description,
            expectedSenderPrincipal,
            metadata: request.metadata || {},
            amountUsd: (request as any).amountUsd,
            // With tokenShortcode, backend derives chain. Keep legacy chainId for old flows.
            chainId: tokenShortcode ? undefined : (request as any).chainId,
            onrampPayment: onramp || undefined,
            widgetParams: request.widgetParams || undefined,
          });
        }
        paymentIntentId = intentResp?.paymentIntent?.id || null;
        paymentIntentCode = intentResp?.paymentIntent?.intentCode ?? null;
        resolvedAmountStr = intentResp?.paymentIntent?.amount || resolvedAmountStr;
        intentChainType = intentResp?.paymentIntent?.chainType || intentResp?.paymentIntent?.networkType || intentResp?.chainType;
        intentChainId = intentResp?.paymentIntent?.chainId || intentResp?.chainId || (request as any).chainId;
        const onrampData = intentResp?.onramp || null;
        const contractAddress = intentResp?.paymentIntent?.contractAddress || null;
        const rpcUrlPublic = intentResp?.paymentIntent?.rpcUrlPublic || null;
        const chainNameFromIntent = intentResp?.paymentIntent?.chainName || null;
        const rpcChainId = intentResp?.paymentIntent?.rpcChainId || null;
        const functionSelectors = intentResp?.paymentIntent?.functionSelectors || null;
        const externalCostAmount = intentResp?.paymentIntent?.externalCostAmount || null;
        const transactionBase64 = intentResp?.paymentIntent?.transactionBase64 || null;
        accountCanisterId = intentResp?.paymentIntent?.accountCanisterId || null;
        // Backfill ledgerCanisterId from intent if not provided in request (tokenShortcode flow)
        if (!ledgerCanisterId && intentResp?.paymentIntent?.ledgerCanisterId) {
          ledgerCanisterId = intentResp.paymentIntent.ledgerCanisterId;
        }
        debugLog(this.config.debug || false, 'payment intent created', { paymentIntentId, paymentIntentCode, expectedSenderPrincipal, resolvedAmountStr });
        // Emit transaction created event
        if (paymentIntentId) {
          this.emit('icpay-sdk-transaction-created', {
            paymentIntentId,
            amount: resolvedAmountStr,
            ledgerCanisterId,
            expectedSenderPrincipal,
            accountCanisterId,
          });
        }
        (request as any).__onramp = onrampData;
        (request as any).__contractAddress = contractAddress;
        (request as any).__rpcUrlPublic = rpcUrlPublic;
        (request as any).__chainName = chainNameFromIntent;
        (request as any).__functionSelectors = functionSelectors;
        (request as any).__rpcChainId = rpcChainId;
        (request as any).__externalCostAmount = externalCostAmount;
        (request as any).__transactionBase64 = transactionBase64;

      } catch (e) {
        // Do not proceed without a payment intent
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

      if (!resolvedAmountStr) {
        const err = new IcpayError({
          code: ICPAY_ERROR_CODES.API_ERROR,
          message: 'Payment intent did not return amount',
        });
        this.emitError(err);
        throw err;
      }

      const amount = BigInt(resolvedAmountStr);

      // Build packed memo
      const acctIdNum = parseInt(accountCanisterId);
      if (!isNaN(acctIdNum) && paymentIntentCode != null) {
        memo = this.createPackedMemo(acctIdNum, Number(paymentIntentCode));
        debugLog(this.config.debug || false, 'built packed memo', { accountCanisterId: acctIdNum, paymentIntentCode });
      }
      debugLog(this.config.debug || false, 'memo', { memo, accountCanisterId, paymentIntentCode });

      // Delegate to chain-specific processing
      const finalResponse = await this.processPaymentByChain({
        chainType: intentChainType,
        chainId: intentChainId,
        ledgerCanisterId,
        amount,
        memo,
        paymentIntentId: paymentIntentId!,
        request,
        resolvedAmountStr: amount.toString(),
        metadata: request.metadata,
        onrampData: (request as any).__onramp,
        contractAddress: (request as any).__contractAddress,
        accountCanisterId,
        rpcUrlPublic: (request as any).__rpcUrlPublic,
        chainName: (request as any).__chainName,
        rpcChainId: (request as any).__rpcChainId,
        paymentIntentCode,
      });
      this.emitMethodSuccess('createPayment', finalResponse);
      return finalResponse;
    } catch (error) {
      if (error instanceof IcpayError) {
        this.emitMethodError('createPayment', error);
        throw error;
      }
      const err = new IcpayError({
        code: 'TRANSACTION_FAILED',
        message: 'Failed to create payment',
        details: error
      });
      this.emitMethodError('createPayment', err);
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
    // Retry on transient certificate TrustError (clock skew)
    const maxAttempts = 3;
    let result: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const agent = new HttpAgent({ host: this.icHost });
        const actor = Actor.createActor(icpayIdl, { agent, canisterId });
        result = await (actor as any).notify_ledger_transaction({
          // Canister expects text for ledger_canister_id
          ledger_canister_id: ledgerCanisterId,
          block_index: blockIndex
        });
        break;
      } catch (e: any) {
        const msg = String(e?.message || '').toLowerCase();
        const isCertSkew = msg.includes('certificate is signed more than') || msg.includes('trusterror');
        if (attempt < maxAttempts && isCertSkew) {
          await new Promise(r => setTimeout(r, attempt * 500));
          continue;
        }
        throw e;
      }
    }

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
    const acctIdNum = parseInt(accountCanisterId);
    const maxAttempts = 3;
    let res: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const agent = new HttpAgent({ host: this.icHost });
        const actor = Actor.createActor(icpayIdl, { agent, canisterId });
        res = await (actor as any).get_transaction_status_public(
          acctIdNum,
          BigInt(canisterTransactionId),
          [indexReceived]
        );
        break;
      } catch (e: any) {
        const msg = String(e?.message || '').toLowerCase();
        const isCertSkew = msg.includes('certificate is signed more than') || msg.includes('trusterror');
        if (attempt < maxAttempts && isCertSkew) {
          await new Promise(r => setTimeout(r, attempt * 500));
          continue;
        }
        return null;
      }
    }
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
   * Public: Get balances for an external wallet (IC principal or EVM address) using publishable key
   */
  async getExternalWalletBalances(params: { network: 'evm' | 'ic'; address?: string; principal?: string; chainId?: string; amountUsd?: number; amount?: string; chainShortcodes?: string[]; tokenShortcodes?: string[] }): Promise<AllLedgerBalances> {
    this.emitMethodStart('getExternalWalletBalances', { params });
    try {
      const search = new URLSearchParams();
      if (params.network) search.set('network', params.network);
      if (params.address) search.set('address', params.address);
      if (params.principal) search.set('principal', params.principal);
      if (params.chainId) search.set('chainId', params.chainId);
      if (typeof params.amountUsd === 'number' && isFinite(params.amountUsd)) search.set('amountUsd', String(params.amountUsd));
      if (typeof params.amount === 'string' && params.amount) search.set('amount', params.amount);
      if (Array.isArray(params.chainShortcodes) && params.chainShortcodes.length > 0) search.set('chainShortcodes', params.chainShortcodes.join(','));
      if (Array.isArray(params.tokenShortcodes) && params.tokenShortcodes.length > 0) search.set('tokenShortcodes', params.tokenShortcodes.join(','));
      const response: any = await this.publicApiClient.get(`/sdk/public/wallet/external-balances?${search.toString()}`);
      const result: AllLedgerBalances = {
        balances: (response?.balances || []).map((balance: any) => ({
          ledgerId: balance.ledgerId,
          ledgerName: balance.ledgerName,
          ledgerSymbol: balance.ledgerSymbol,
          tokenShortcode: (balance?.tokenShortcode ?? balance?.shortcode) ?? null,
          canisterId: balance.canisterId,
          eip3009Version: balance?.eip3009Version ?? null,
          x402Accepts: balance?.x402Accepts != null ? Boolean(balance.x402Accepts) : undefined,
          balance: balance.balance,
          formattedBalance: balance.formattedBalance,
          decimals: balance.decimals,
          currentPrice: balance.currentPrice,
          lastPriceUpdate: balance.lastPriceUpdate ? new Date(balance.lastPriceUpdate) : undefined,
          lastUpdated: balance.lastUpdated ? new Date(balance.lastUpdated) : new Date(),
          // Chain metadata passthrough for multichain UX
          chainId: typeof balance.chainId === 'string' ? balance.chainId : (typeof balance.chainId === 'number' ? String(balance.chainId) : undefined),
          chainName: balance.chainName ?? (balance.chain && (balance.chain.name || balance.chain.chainName)) ?? null,
          rpcUrlPublic: balance.rpcUrlPublic ?? null,
          chainUuid: balance.chainUuid ?? null,
          requiredAmount: balance.requiredAmount,
          requiredAmountFormatted: balance.requiredAmountFormatted,
          hasSufficientBalance: balance.hasSufficientBalance,
          logoUrl: balance.logoUrl ?? null,
        })),
        totalBalancesUSD: response?.totalBalancesUSD,
        lastUpdated: new Date(response?.lastUpdated || Date.now()),
      };
      this.emitMethodSuccess('getExternalWalletBalances', { count: result.balances.length, totalUSD: result.totalBalancesUSD });
      return result;
    } catch (error) {
      const err = new IcpayError({
        code: 'ACCOUNT_WALLET_BALANCES_FETCH_FAILED',
        message: 'Failed to fetch external wallet balances (public)',
        details: error,
      });
      this.emitMethodError('getExternalWalletBalances', err);
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
  async getLedgerInfo(ledgerCanisterId: string, opts?: { chainId?: string | number | null }): Promise<SdkLedger> {
    this.emitMethodStart('getLedgerInfo', { ledgerCanisterId, opts });
    try {
      const isZeroAddress = typeof ledgerCanisterId === 'string' && /^0x0{40}$/i.test(ledgerCanisterId);
      // Back-compat safety: require chainId for native token (zero address)
      let url = `/sdk/public/ledgers/${encodeURIComponent(ledgerCanisterId)}`;
      if (isZeroAddress) {
        const chainId = opts?.chainId;
        if (!chainId && this.config?.debug) {
          debugLog(true, 'getLedgerInfo requires chainId for zero address', { ledgerCanisterId });
        }
        if (!chainId) {
          throw new IcpayError({
            code: ICPAY_ERROR_CODES.INVALID_CONFIG,
            message: 'chainId is required when querying native token (0x000…000). Prefer tokenShortcode in new flows.',
          });
        }
        const chainStr = typeof chainId === 'number' ? String(chainId) : chainId;
        url = `${url}?chainId=${encodeURIComponent(chainStr || '')}`;
      }
      const ledger = await this.publicApiClient.get(url);

      const result: SdkLedger = {
        id: ledger.id,
        name: ledger.name,
        symbol: ledger.symbol,
        chainId: ledger.chainId,
        shortcode: ledger.shortcode ?? null,
        canisterId: ledger.canisterId,
        decimals: ledger.decimals,
        logoUrl: ledger.logoUrl ?? null,
        verified: ledger.verified,
        fee: ledger.fee ?? null,
        network: ledger.network,
        description: ledger.description ?? null,
        coingeckoId: ledger.coingeckoId ?? null,
        currentPrice: ledger.currentPrice ?? null,
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
   * Create a payment from a USD amount to a specific ledger (public method)
   */
  async createPaymentUsd(request: CreatePaymentUsdRequest): Promise<TransactionResponse> {
    this.emitMethodStart('createPaymentUsd', { request });
    try {
      // Convert usdAmount to number if it's a string
      const usdAmount = typeof request.usdAmount === 'string' ? parseFloat(request.usdAmount) : request.usdAmount;

      // If tokenShortcode provided, skip canister resolution; otherwise resolve from symbol if needed
      const tokenShortcode: string | undefined = (request as any)?.tokenShortcode;
      let ledgerCanisterId = request.ledgerCanisterId;
      if (!ledgerCanisterId && !tokenShortcode && !(request as any).symbol) {
        const err = new IcpayError({
          code: ICPAY_ERROR_CODES.INVALID_CONFIG,
          message: 'Provide either tokenShortcode or ledgerCanisterId (symbol is deprecated).',
          details: { request }
        });
        this.emitMethodError('createPayment', err);
        throw err;
      }

      const createTransactionRequest: CreateTransactionRequest = {
        ledgerCanisterId: tokenShortcode ? undefined : ledgerCanisterId,
        symbol: tokenShortcode ? undefined : (request as any).symbol,
        tokenShortcode,
        amountUsd: usdAmount,
        description: (request as any).description,
        accountCanisterId: request.accountCanisterId,
        metadata: request.metadata,
        onrampPayment: request.onrampPayment,
        widgetParams: request.widgetParams,
        chainId: tokenShortcode ? undefined : (request as any).chainId,
      } as any;

      const res = await this.createPayment(createTransactionRequest);
      this.emitMethodSuccess('createPaymentUsd', res);
      return res;
    } catch (error) {
      if (error instanceof IcpayError) {
        this.emitMethodError('createPaymentUsd', error);
        throw error;
      }
      const err = new IcpayError({
        code: 'SEND_FUNDS_USD_FAILED',
        message: 'Failed to send funds from USD',
        details: error
      });
      this.emitMethodError('createPaymentUsd', err);
      throw err;
    }
  }

  /**
   * Create an X402 payment from a USD amount
   * Falls back to regular flow at caller level if unavailable.
   */
  async createPaymentX402Usd(request: CreatePaymentUsdRequest): Promise<TransactionResponse> {
    this.emitMethodStart('createPaymentX402Usd', { request });
    try {
      const usdAmount = typeof request.usdAmount === 'string' ? parseFloat(request.usdAmount) : request.usdAmount;

      // For X402, the backend will resolve ledger/symbol as needed from the intent.
      // We forward both amountUsd and amount (if provided), and do not resolve canister here.
      const ledgerCanisterId = request.ledgerCanisterId || '';
      const tokenShortcode: string | undefined = (request as any)?.tokenShortcode;

      // Hit X402 endpoint
      const body: any = {
        amount: (request as any).amount,
        amountUsd: usdAmount,
        // Prefer tokenShortcode; keep legacy fields if not provided
        tokenShortcode: tokenShortcode || undefined,
        symbol: tokenShortcode ? undefined : (request as any).symbol,
        ledgerCanisterId: tokenShortcode ? undefined : ledgerCanisterId,
        description: (request as any).description,
        metadata: request.metadata,
        chainId: tokenShortcode ? undefined : (request as any).chainId,
        x402: true,
      };

      try {
        const resp: any = await this.publicApiClient.post('/sdk/public/payments/intents/x402', body);
        // If backend indicates x402 is unavailable (failed + fallback), immediately switch to normal flow
        const respStatus = (resp?.status || '').toString().toLowerCase();
        const fallbackSuggested = Boolean(resp?.fallbackSuggested);
        if (respStatus === 'failed' && fallbackSuggested) {
          const fallback = await this.createPaymentUsd(request);
          this.emitMethodSuccess('createPaymentX402Usd', fallback);
          return fallback;
        }
        // If backend returned normal flow (no accepts), skip x402 and proceed with regular flow
        const hasAccepts = Array.isArray(resp?.accepts) && resp.accepts.length > 0;
        if (!hasAccepts) {
          const fallback = await this.createPaymentUsd(request);
          this.emitMethodSuccess('createPaymentX402Usd', fallback);
          return fallback;
        }
        // If backend returned accepts despite 200, keep previous behavior (pending with x402 metadata)
        const normalized = {
          transactionId: 0,
          status: 'pending',
          amount: (resp?.paymentIntent?.amount || resp?.amount || request.usdAmount)?.toString?.() || String(request.usdAmount),
          recipientCanister: ledgerCanisterId,
          timestamp: new Date(),
          metadata: { ...(request.metadata || {}), icpay_x402: true },
          payment: resp,
        } as any;
        this.emitMethodSuccess('createPaymentX402Usd', normalized);
        return normalized;
      } catch (e: any) {
        // If API responds with HTTP 402 to trigger wallet X402 flow, begin settlement wait instead of erroring
        if (e && typeof e.status === 'number' && e.status === 402) {
          // Try to extract paymentIntentId from response data to start polling
          const data = e?.data || {};
          // Support new x402 Payment Required Response body:
          // { x402Version, accepts: [{ ..., extra: { intentId } }], error }
          let paymentIntentId: string | null = data?.paymentIntentId || null;
          if (!paymentIntentId && Array.isArray(data?.accepts) && data.accepts[0]?.extra?.intentId) {
            paymentIntentId = String(data.accepts[0].extra.intentId);
          }
          if (paymentIntentId) {
            // Prefer ledgerCanisterId from request/body; fallback to server response if present
            const acceptsArr: any[] = Array.isArray(data?.accepts) ? data.accepts : [];
            let requirement: any = acceptsArr.length > 0 ? acceptsArr[0] : null;

            if (requirement) {
              try {
                const paymentHeader = await buildAndSignX402PaymentHeader(requirement, {
                  x402Version: Number(data?.x402Version || 1),
                  debug: this.config?.debug || false,
                  provider: (this.config as any)?.evmProvider || (typeof (globalThis as any)?.ethereum !== 'undefined' ? (globalThis as any).ethereum : undefined),
                });
                // Start verification stage while we wait for settlement to process
                try { this.emitMethodStart('notifyLedgerTransaction', { paymentIntentId }); } catch {}
                const settleResp: any = await this.publicApiClient.post('/sdk/public/payments/x402/settle', {
                  paymentIntentId,
                  paymentHeader,
                  paymentRequirements: requirement,
                });
                try {
                  debugLog(this.config?.debug || false, 'x402 settle response (from icpay-services via api)', {
                    ok: (settleResp as any)?.ok,
                    status: (settleResp as any)?.status,
                    txHash: (settleResp as any)?.txHash,
                    paymentIntentId: (settleResp as any)?.paymentIntent?.id,
                    paymentId: (settleResp as any)?.payment?.id,
                    rawKeys: Object.keys(settleResp || {}),
                  });
                } catch {}
                // Move to "Payment confirmation" stage (confirm loading)
                try { this.emitMethodSuccess('notifyLedgerTransaction', { paymentIntentId }); } catch {}
                const status = (settleResp?.status || settleResp?.paymentIntent?.status || 'completed').toString().toLowerCase();
                const amountStr =
                  (settleResp?.paymentIntent?.amount && String(settleResp.paymentIntent.amount)) ||
                  (typeof usdAmount === 'number' ? String(usdAmount) : (request as any)?.amount?.toString?.() || '0');
                const out = {
                  transactionId: Number(settleResp?.canisterTxId || 0),
                  status: status === 'succeeded' ? 'completed' : status,
                  amount: amountStr,
                  recipientCanister: ledgerCanisterId,
                  timestamp: new Date(),
                  metadata: { ...(request.metadata || {}), icpay_x402: true },
                  payment: settleResp || null,
                } as any;
                // If x402 failed due to minimal limits, emit failure and fall back to normal flow
                const failMsg = (settleResp as any)?.message || (settleResp as any)?.error || '';
                if (out.status === 'failed' && (failMsg === 'x402_minimal_platform_fee_not_met' || failMsg === 'x402_minimum_amount_not_met')) {
                  try { this.emit('icpay-sdk-transaction-failed', { ...out, reason: failMsg }); } catch {}
                  // Initiate regular flow (non-x402) with the same request
                  const fallback = await this.createPaymentUsd(request);
                  this.emitMethodSuccess('createPaymentX402Usd', fallback);
                  return fallback;
                }
                const isTerminal = (() => {
                  const s = String(out.status || '').toLowerCase();
                  return s === 'completed' || s === 'succeeded' || s === 'failed' || s === 'canceled' || s === 'cancelled' || s === 'mismatched';
                })();
                if (isTerminal) {
                  if (out.status === 'completed') {
                    this.emit('icpay-sdk-transaction-completed', out);
                  } else if (out.status === 'failed') {
                    this.emit('icpay-sdk-transaction-failed', out);
                  } else {
                    this.emit('icpay-sdk-transaction-updated', out);
                  }
                  this.emitMethodSuccess('createPaymentX402Usd', out);
                  return out;
                }
                // Non-terminal (e.g., requires_payment). Continue notifying until terminal.
                try { this.emit('icpay-sdk-transaction-updated', out); } catch {}
                const waited = await this.awaitIntentTerminal({
                  paymentIntentId,
                  ledgerCanisterId: ledgerCanisterId,
                  amount: amountStr,
                  metadata: { ...(request.metadata || {}), icpay_x402: true },
                });
                this.emitMethodSuccess('createPaymentX402Usd', waited);
                return waited;
              } catch {
                // Fall through to notify-based wait if settle endpoint not available
              }
            }
            // Fallback: wait until terminal via notify loop
            const amountStr =
              (data?.paymentIntent?.amount && String(data.paymentIntent.amount)) ||
              (Array.isArray(data?.accepts) && data.accepts[0]?.maxAmountRequired && String(data.accepts[0].maxAmountRequired)) ||
              (typeof usdAmount === 'number' ? String(usdAmount) : (request as any)?.amount?.toString?.() || '0');
            const finalResponse = await this.awaitIntentTerminal({
              paymentIntentId,
              ledgerCanisterId: ledgerCanisterId,
              amount: amountStr,
              metadata: { ...(request.metadata || {}), icpay_x402: true },
            });
            this.emitMethodSuccess('createPaymentX402Usd', finalResponse);
            return finalResponse;
          }
          // No intent id provided: return a pending response with x402 metadata
          const pending = {
            transactionId: 0,
            status: 'pending',
            amount: (typeof usdAmount === 'number' ? String(usdAmount) : (request as any)?.amount?.toString?.() || '0'),
            recipientCanister: ledgerCanisterId || null,
            timestamp: new Date(),
          metadata: { ...(request.metadata || {}), icpay_x402: true },
            payment: null,
          } as any;
          this.emitMethodSuccess('createPaymentX402Usd', pending);
          return pending;
        }
        // Any other error: rethrow to allow caller fallback
        throw e;
      }
    } catch (error) {
      if (error instanceof IcpayError) {
        this.emitMethodError('createPaymentX402Usd', error);
        throw error;
      }
      const err = new IcpayError({
        code: ICPAY_ERROR_CODES.API_ERROR,
        message: 'X402 payment flow not available',
        details: error,
      });
      this.emitMethodError('createPaymentX402Usd', err);
      throw err;
    }
  }

  /**
   * Continuously notifies the API about a payment intent (no canister tx id) for Onramp.
   * Uses publishable-key public endpoint. Emits icpay-sdk-transaction-updated only when
   * status changes, and icpay-sdk-transaction-completed when reaching completed/succeeded.
   */
  notifyPaymentIntentOnRamp(params: { paymentIntentId: string; intervalMs?: number; orderId?: string }): { stop: () => void } {
    const paymentIntentId = params.paymentIntentId;
    const intervalMs = Math.max(1000, params.intervalMs ?? 5000);
    const orderId = params.orderId;
    let timer: any = null;
    let lastStatus: string | null = null;
    // Signal progress bar that canister notification/verification phase has effectively started
    try { this.emitMethodSuccess('notifyLedgerTransaction', { paymentIntentId }); } catch {}
    const tick = async () => {
      const res = await this.performNotifyPaymentIntent({ paymentIntentId, orderId });
      const piStatus = ((res as any)?.paymentIntent?.status || '').toLowerCase();
      const payStatus = ((res as any)?.payment?.status || '').toLowerCase();
      const status = piStatus || payStatus || '';
      if (status && status !== lastStatus) {
        lastStatus = status;
        if (status === 'completed' || status === 'succeeded') {
          this.dispatchEvent(new CustomEvent('icpay-sdk-transaction-completed', { detail: { id: paymentIntentId, status } }));
        } else if (status === 'mismatched') {
          this.dispatchEvent(new CustomEvent('icpay-sdk-transaction-mismatched', { detail: { id: paymentIntentId, status, payment: (res as any)?.payment } }));
          // Also emit updated to ensure progress bar advances to terminal state
          this.dispatchEvent(new CustomEvent('icpay-sdk-transaction-updated', { detail: { id: paymentIntentId, status } }));
        } else {
          this.dispatchEvent(new CustomEvent('icpay-sdk-transaction-updated', { detail: { id: paymentIntentId, status } }));
        }
      }
    };
    // kick and schedule
    tick().catch(() => {});
    timer = setInterval(tick, intervalMs);
    return { stop: () => { if (timer) { clearInterval(timer); timer = null; } } };
  }

  /** Reusable notify helper for both ledger flow and onramp */
  private async performNotifyPaymentIntent(params: { paymentIntentId: string; canisterTransactionId?: string; transactionId?: string; maxAttempts?: number; delayMs?: number; orderId?: string }): Promise<any> {
    const notifyClient = this.publicApiClient;
    const notifyPath = '/sdk/public/payments/notify';
    const maxAttempts = params.maxAttempts ?? 1;
    const delayMs = params.delayMs ?? 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        debugLog(this.config.debug || false, 'notify payment intent', { attempt, notifyPath, paymentIntentId: params.paymentIntentId, canisterTxId: params.canisterTransactionId });
        const body: any = { paymentIntentId: params.paymentIntentId };
        if (params.canisterTransactionId) body.canisterTxId = params.canisterTransactionId;
        if (params.transactionId) body.transactionId = params.transactionId;
        if (params.orderId) body.orderId = params.orderId;
        const resp: any = await notifyClient.post(notifyPath, body);
        // If this is the last attempt, return whatever we got
        if (attempt === maxAttempts) {
          return resp;
        }
        // Otherwise, only return early if completed/succeeded based on intent or payment
        const status = (resp as any)?.paymentIntent?.status || (resp as any)?.payment?.status || (resp as any)?.status || '';
        if (typeof status === 'string') {
          const norm = status.toLowerCase();
          if (norm === 'completed' || norm === 'succeeded') {
            return resp;
          }
        }
        // Not completed yet; wait and retry
        if (delayMs > 0) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      } catch (e: any) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        debugLog(this.config.debug || false, 'notify payment intent error', { attempt, status, data });
        if (attempt < maxAttempts && delayMs > 0) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
    }
    return {};
  }

  // Waits until the API reports a terminal status for the intent/payment.
  // Retries indefinitely by default, backing off modestly, and only returns
  // when status is terminal. Never throws after funds are sent unless API reports
  // an explicit failure state.
  private async awaitIntentTerminal(params: { paymentIntentId: string; canisterTransactionId?: string; transactionId?: string; ledgerCanisterId: string; amount: string; metadata?: any }): Promise<any> {
    const baseDelay = 1000;
    const maxDelay = 10000;
    let attempt = 0;
    while (true) {
      attempt++;
      try {
        const resp = await this.performNotifyPaymentIntent({
          paymentIntentId: params.paymentIntentId,
          canisterTransactionId: params.canisterTransactionId,
          transactionId: params.transactionId || (params?.metadata?.icpay_evm_tx_hash ? String(params.metadata.icpay_evm_tx_hash) : undefined),
          maxAttempts: 1,
          delayMs: 0,
        });
        const status = (resp as any)?.paymentIntent?.status || (resp as any)?.payment?.status || (resp as any)?.status || '';
        const norm = typeof status === 'string' ? status.toLowerCase() : '';
        // Terminal statuses
        if (norm === 'completed' || norm === 'succeeded' || norm === 'mismatched') {
          const out = {
            transactionId: Number(params.canisterTransactionId || 0),
            status: norm === 'succeeded' ? 'completed' : (norm as any),
            amount: params.amount,
            recipientCanister: params.ledgerCanisterId,
            timestamp: new Date(),
            description: 'Fund transfer',
            metadata: params.metadata,
            payment: resp,
          };
          if (norm === 'mismatched') {
            const requested = (resp as any)?.payment?.requestedAmount || null;
            const paid = (resp as any)?.payment?.paidAmount || null;
            this.emit('icpay-sdk-transaction-mismatched', { ...out, requestedAmount: requested, paidAmount: paid });
            this.emit('icpay-sdk-transaction-updated', { ...out, status: 'mismatched', requestedAmount: requested, paidAmount: paid });
          } else {
            this.emit('icpay-sdk-transaction-completed', out);
          }
          return out;
        }
        if (norm === 'failed' || norm === 'canceled' || norm === 'cancelled') {
          const out = {
            transactionId: Number(params.canisterTransactionId || 0),
            status: 'failed',
            amount: params.amount,
            recipientCanister: params.ledgerCanisterId,
            timestamp: new Date(),
            description: 'Fund transfer',
            metadata: params.metadata,
            payment: resp,
          };
          this.emit('icpay-sdk-transaction-failed', out);
          return out;
        }
        // Not terminal yet; sleep with backoff and retry
      } catch (e) {
        // Network/API error; keep retrying
      }
      const delay = Math.min(maxDelay, baseDelay * Math.ceil(attempt / 5));
      await new Promise(r => setTimeout(r, delay));
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
        chainId: ledger.chainId,
        // Enriched chain fields
        chainName: ledger.chainName ?? null,
        chainShortcode: ledger.chainShortcode ?? null,
        chainType: ledger.chainType ?? null,
        nativeSymbol: ledger.nativeSymbol ?? null,
        rpcChainId: ledger.rpcChainId ?? null,
        shortcode: ledger.shortcode ?? null,
        canisterId: ledger.canisterId,
        decimals: ledger.decimals,
        logoUrl: ledger.logoUrl ?? null,
        verified: ledger.verified,
        fee: ledger.fee ?? null,
        network: ledger.network,
        description: ledger.description ?? null,
        coingeckoId: ledger.coingeckoId ?? null,
        currentPrice: ledger.currentPrice ?? null,
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