import { buildAndSignX402PaymentHeader, buildX402HeaderFromAuthorization } from './x402/builders';
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

// Minimal helpers to support Phantom's base58 "message" signing without extra deps
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(bytes: Uint8Array): string {
  if (!bytes || bytes.length === 0) return '';
  // Count leading zeros
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  // Convert base-256 to base-58
  const digits: number[] = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      const x = digits[j] * 256 + carry;
      digits[j] = x % 58;
      carry = Math.floor(x / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  // Leading zero bytes are represented by '1'
  let out = '';
  for (let k = 0; k < zeros; k++) out += '1';
  for (let q = digits.length - 1; q >= 0; q--) out += B58_ALPHABET[digits[q]];
  return out;
}
function base58Decode(s: string): Uint8Array {
  if (!s || s.length === 0) return new Uint8Array(0);
  const MAP: { [k: string]: number } = {};
  for (let i = 0; i < B58_ALPHABET.length; i++) MAP[B58_ALPHABET.charAt(i)] = i;
  let zeros = 0;
  while (zeros < s.length && s.charAt(zeros) === '1') zeros++;
  const bytes: number[] = [0];
  for (let i = zeros; i < s.length; i++) {
    const ch = s.charAt(i);
    const val = MAP[ch];
    if (val === undefined) throw new Error('invalid base58');
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      const prev = bytes[j] as number;
      const x = (prev * 58) + (carry as number);
      bytes[j] = x & 0xff;
      carry = x >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const outArr = new Uint8Array(zeros + bytes.length);
  let p = 0;
  for (; p < zeros; p++) outArr[p] = 0;
  for (let q = bytes.length - 1; q >= 0; q--) outArr[p++] = (bytes[q] == null ? 0 : (bytes[q] as number));
  return outArr;
}
function b64FromBytes(bytes: Uint8Array): string {
  try {
    const Buf = (globalThis as any).Buffer;
    if (Buf) return Buf.from(bytes).toString('base64');
  } catch {}
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // btoa expects binary string
  return (globalThis as any)?.btoa ? (globalThis as any).btoa(bin) : '';
}
function u8FromBase64(b64: string): Uint8Array {
  try {
    const Buf = (globalThis as any).Buffer;
    if (Buf) return new Uint8Array(Buf.from(b64, 'base64'));
  } catch {}
  const bin = (globalThis as any)?.atob ? (globalThis as any).atob(b64) : '';
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/**
 * Normalize Solana signTransaction result to base64 signed transaction.
 * Wallets may return: signedTransaction, transaction, signedMessage (string base64/base58),
 * serializedTransaction (Uint8Array), or the raw value. Phantom may return base58.
 */
function normalizeSolanaSignedTransaction(r: any): string | null {
  if (r == null) return null;
  const toB64 = (val: any): string | null => {
    if (val == null) return null;
    if (typeof val === 'string') {
      const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(val) && val.length >= 80 && val.length % 4 === 0;
      if (looksBase64) return val;
      try {
        const decoded = base58Decode(val);
        if (decoded.length > 64) return b64FromBytes(decoded);
      } catch {}
      return null;
    }
    if (val.byteLength != null || ArrayBuffer.isView(val)) {
      const b = val instanceof Uint8Array ? val : new Uint8Array(val as ArrayBufferLike);
      if (b.length > 64) return b64FromBytes(b);
    }
    if (typeof val === 'object' && typeof val.serialize === 'function') {
      try {
        const out = val.serialize({ requireAllSignatures: false, verifySignatures: false });
        const b = out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBufferLike);
        if (b.length > 64) return b64FromBytes(b);
      } catch {}
    }
    return null;
  };
  const direct = toB64(r);
  if (direct) return direct;
  if (typeof r === 'object') {
    for (const key of ['signedTransaction', 'transaction', 'signedMessage', 'serializedTransaction', 'encodedTransaction', 'message']) {
      const v = (r as any)[key];
      const b64 = toB64(v);
      if (b64) return b64;
    }
  }
  return null;
}

/** Normalize Solana signMessage result to base64 64-byte signature. Phantom returns { signature, rawSignature }; some wallets return { signature: Uint8Array } or string. */
function normalizeSolanaMessageSignature(r: any): string | null {
  if (!r) return null;
  // Direct string (base58 or base64)
  if (typeof r === 'string') {
    if (r.length === 88 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(r)) {
      try { const b = base58Decode(r); return b.length === 64 ? b64FromBytes(b) : null; } catch { return null; }
    }
    try { const b = u8FromBase64(r); return b.length === 64 ? b64FromBytes(b) : null; } catch { return null; }
  }
  // Byte-like (Uint8Array / ArrayBufferView)
  if (r.byteLength != null || ArrayBuffer.isView(r)) {
    const b = r instanceof Uint8Array ? r : new Uint8Array(r as ArrayBufferLike);
    return b.length === 64 ? b64FromBytes(b) : null;
  }
  // Object: signature (string or Uint8Array) or rawSignature (base64 string)
  if (typeof r === 'object') {
    const sig = (r as any).signature;
    if (sig != null) {
      if (typeof sig === 'string') {
        try { const b = base58Decode(sig); return b.length === 64 ? b64FromBytes(b) : null; } catch {}
        try { const b = u8FromBase64(sig); return b.length === 64 ? b64FromBytes(b) : null; } catch {}
      }
      if (sig.byteLength != null || ArrayBuffer.isView(sig)) {
        const b = sig instanceof Uint8Array ? sig : new Uint8Array(sig as ArrayBufferLike);
        return b.length === 64 ? b64FromBytes(b) : null;
      }
    }
    const raw = (r as any).rawSignature;
    if (typeof raw === 'string') {
      try { const b = u8FromBase64(raw); return b.length === 64 ? b64FromBytes(b) : null; } catch {}
    }
    if (Array.isArray((r as any).data)) {
      const b = Uint8Array.from((r as any).data as number[]);
      return b.length === 64 ? b64FromBytes(b) : null;
    }
  }
  return null;
}

// Normalize metadata so internal icpay-managed fields are nested under metadata.icpay.
// If icpay exists, merge; otherwise create. Move known internal keys and icpay_* keys under icpay.
function normalizeSdkMetadata(base: any): any {
  const isObj = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
  const incoming: any = isObj(base) ? { ...base } : {};
  const hasGroup = isObj(incoming.icpay);
  const INTERNAL_KEYS = ['context', 'senderPrincipal', 'onrampProvider'];
  const moved: any = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (INTERNAL_KEYS.includes(k) || k.startsWith('icpay_')) {
      moved[k] = v;
      delete incoming[k];
    }
  }
  if (hasGroup) {
    incoming.icpay = { ...(incoming.icpay || {}), ...moved };
  } else {
    incoming.icpay = moved;
  }
  return incoming;
}

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
      onrampDisabled: false,
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
      case 'sol':
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
      // Attempt to decode accountCanisterId from packed memo (high 32 bits)
      let acctFromMemo: number | undefined = undefined;
      try {
        if (memo && memo.length > 0) {
          let big = 0n;
          for (let i = 0; i < memo.length; i++) {
            big |= BigInt(memo[i] & 0xff) << BigInt(8 * i);
          }
          const acct = Number(big >> 32n);
          if (Number.isFinite(acct) && acct > 0) acctFromMemo = acct;
        }
      } catch {}
      // Derive recipient principal for relay from request payload (IC address)
      const recipientPrincipal = (() => {
        const addrAny: any = (request as any);
        const icAddr = (addrAny?.recipientAddresses?.ic || addrAny?.recipientAddress || '').toString().trim();
        // Heuristic: treat non-hex, non-empty as IC principal candidate
        if (icAddr && !/^0x[a-fA-F0-9]{40}$/.test(icAddr)) return icAddr;
        return undefined;
      })();
      const externalCostAmount = (request as any).__externalCostAmount ?? (request as any)?.externalCostAmount ?? (request as any)?.metadata?.externalCostAmount;
      const notifyRes: any = await this.notifyLedgerTransaction(
        this.icpayCanisterId!,
        ledgerCanisterId!,
        BigInt(blockIndex),
        {
          accountCanisterId: acctFromMemo,
          externalCostAmount,
          recipientPrincipal
        }
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
      ledgerBlockIndex: blockIndex,
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
      if (pk && typeof pk.toBase58 === 'function') {
        payerKey = pk.toBase58();
      } else if (typeof pk === 'string') {
        payerKey = pk;
      } else if (pk && typeof pk.toString === 'function') {
        payerKey = pk.toString();
      } else {
        payerKey = pk ? String(pk) : null;
      }
    } catch {}
    if (!payerKey) {
      throw new IcpayError({ code: ICPAY_ERROR_CODES.WALLET_NOT_CONNECTED, message: 'Solana wallet not connected' });
    }
    // If the intent already provided an unsigned transaction, use it (no extra API roundtrip)
    const prebuiltBase64: string | undefined = (params.request as any)?.__transactionBase64;
    if (typeof prebuiltBase64 === 'string' && prebuiltBase64.length > 0) {
      let signature: string | null = null;
      let relay: any;
      try {
        if ((sol as any)?.request) {
          // Treat as Phantom only if the selected provider itself reports isPhantom,
          // or it is literally the same object as window.phantom.solana.
          const isPhantom = !!(
            (sol as any)?.isPhantom ||
            (((w as any)?.phantom?.solana) && ((w as any).phantom.solana === (sol as any)))
          );
          if (isPhantom) {
            // Prefer sign-only flow: signTransaction, then relay via backend (avoids Phantom simulation warning)
            const msgB58 = base58Encode(u8FromBase64(prebuiltBase64));
            let signedTxB64: string | null = null;
            let signerSigBase58: string | null = null;
            // Try multiple parameter shapes for maximum compatibility
            let r: any = null;
            try { r = await (sol as any).request({ method: 'signTransaction', params: { message: msgB58 } }); } catch {}
            if (!r) {
              try { r = await (sol as any).request({ method: 'signTransaction', params: msgB58 as any }); } catch {}
            }
            if (!r) {
              try { r = await (sol as any).request({ method: 'solana:signTransaction', params: { transaction: prebuiltBase64 } }); } catch {}
            }
            if (!r) {
              try { r = await (sol as any).request({ method: 'signTransaction', params: { transaction: prebuiltBase64 } }); } catch {}
            }
            signedTxB64 = normalizeSolanaSignedTransaction(r) ?? signedTxB64;
            if (!signedTxB64 && !signerSigBase58) {
              const candidate = (r?.signedTransaction || r?.transaction || r?.signedMessage || r) as any;
              if (typeof candidate === 'string') {
                const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(candidate) && candidate.length % 4 === 0;
                if (looksBase64) signedTxB64 = candidate; else signerSigBase58 = candidate;
              } else if (candidate && (candidate.byteLength != null || ArrayBuffer.isView(candidate))) {
                const b = candidate instanceof Uint8Array ? candidate : new Uint8Array(candidate as ArrayBufferLike);
                if (b.length > 64) signedTxB64 = b64FromBytes(b); else if (b.length === 64) signerSigBase58 = base58Encode(b);
              } else if (r && typeof r === 'object') {
                const obj = r as any;
                if (typeof obj.signedTransaction === 'string') signedTxB64 = obj.signedTransaction;
                if (!signedTxB64 && typeof obj.signature === 'string') signerSigBase58 = obj.signature;
                if (!signedTxB64 && obj && typeof obj.serialize === 'function') {
                  try {
                    const out = obj.serialize({ requireAllSignatures: false, verifySignatures: false });
                    if (out && (out.byteLength != null || ArrayBuffer.isView(out))) {
                      const b = out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBufferLike);
                      if (b.length > 64) signedTxB64 = b64FromBytes(b);
                    }
                  } catch {}
                }
              }
            }
            if (!signedTxB64 && typeof (sol as any).signTransaction === 'function') {
              try {
                const txBytes = u8FromBase64(prebuiltBase64);
                const stx = await (sol as any).signTransaction(txBytes as any);
                const parsed = normalizeSolanaSignedTransaction(stx);
                if (parsed) signedTxB64 = parsed;
                else if (stx && typeof stx === 'string' && stx.length === 88) signerSigBase58 = stx;
                else if (stx && (stx.byteLength != null || ArrayBuffer.isView(stx))) {
                  const b = stx instanceof Uint8Array ? stx : new Uint8Array(stx as ArrayBufferLike);
                  if (b.length === 64) signerSigBase58 = base58Encode(b);
                }
              } catch {}
            }
            if (!signedTxB64 && !signerSigBase58) throw new Error('Wallet did not return a signed transaction');
            // Relay via API (facilitatorPaysFee: true for x402 so facilitator pays network fee)
            if (signedTxB64) {
              relay = await this.publicApiClient.post('/sdk/public/payments/solana/relay', {
                signedTransactionBase64: signedTxB64,
                paymentIntentId: params.paymentIntentId,
                facilitatorPaysFee: true,
              });
            } else {
              relay = await this.publicApiClient.post('/sdk/public/payments/x402/relay', {
                paymentIntentId: params.paymentIntentId,
                signatureBase58: signerSigBase58,
                transactionBase64: prebuiltBase64,
                payerPublicKey: payerKey,
              });
            }
            signature = (relay && (relay.signature || relay?.txSig || relay?.txid)) || null;
            if (!signature) {
              // Fallback: if relay returned ok but no signature field, attempt to parse
              const maybe = (relay && (relay.ok === true) && (relay as any).status) ? (relay as any).signature : null;
              signature = maybe || null;
            }
          } else {
            // Other wallets may accept base64 "transaction"
            debugLog(this.config.debug || false, 'solana generic request', { method: 'signAndSendTransaction', param: 'transaction(base64)' });
            const r1 = await (sol as any).request({ method: 'signAndSendTransaction', params: { transaction: prebuiltBase64 } });
            signature = (r1 && (r1.signature || r1)) as string;
          }
        } else if (typeof (sol as any)?.signAndSendTransaction === 'function') {
          // Some providers (e.g., Backpack) expose direct signAndSendTransaction without request API.
          // Try common parameter shapes in order.
          const msgB58 = base58Encode(u8FromBase64(prebuiltBase64));
          let r2: any = null;
          try {
            debugLog(this.config.debug || false, 'solana direct call', { fn: 'signAndSendTransaction', param: 'message(base58)' });
            r2 = await (sol as any).signAndSendTransaction({ message: msgB58 });
          } catch {}
          if (!r2) {
            try {
              debugLog(this.config.debug || false, 'solana direct call', { fn: 'signAndSendTransaction', param: 'transaction(base64)' });
              r2 = await (sol as any).signAndSendTransaction({ transaction: prebuiltBase64 });
            } catch {}
          }
          if (!r2) {
            try {
              debugLog(this.config.debug || false, 'solana direct call', { fn: 'signAndSendTransaction', param: 'transaction(uint8array)' });
              r2 = await (sol as any).signAndSendTransaction(u8FromBase64(prebuiltBase64));
            } catch {}
          }
          signature = (r2 && (r2.signature || r2)) as string;
        } else {
          throw new Error('Unsupported Solana wallet interface');
        }
        if (!signature) throw new Error('Missing Solana transaction signature');
      } catch (e: any) {
        try { debugLog(this.config.debug || false, 'solana tx error (prebuilt)', { message: e?.message }); } catch {}
        throw new IcpayError({ code: ICPAY_ERROR_CODES.TRANSACTION_FAILED, message: 'Solana transaction failed', details: e });
      }
      try { this.emitMethodSuccess('notifyLedgerTransaction', { paymentIntentId: params.paymentIntentId }); } catch {}
      // If relay already returned completed payload (paymentIntent + payment), skip notify and polling
      const relayPayload = typeof (relay as any)?.paymentIntent !== 'undefined' || typeof (relay as any)?.payment !== 'undefined' ? (relay as any) : undefined;
      const relayStatus = relayPayload && (typeof (relayPayload as any).status === 'string' ? (relayPayload as any).status : (relayPayload as any)?.paymentIntent?.status || (relayPayload as any)?.payment?.status || '');
      const relayTerminal = typeof relayStatus === 'string' && ['completed', 'succeeded'].includes(String(relayStatus).toLowerCase());
      if (relayPayload && relayTerminal) {
        const norm = String(relayStatus).toLowerCase();
        const out = {
          transactionId: 0,
          status: norm === 'succeeded' ? 'completed' : (norm as any),
          amount: params.amount.toString(),
          recipientCanister: params.ledgerCanisterId!,
          timestamp: new Date(),
          description: 'Fund transfer',
          metadata: { ...(params.metadata || {}), icpay_solana_tx_sig: signature },
          payment: relayPayload,
        };
        this.emit('icpay-sdk-transaction-completed', out);
        return out;
      }
      try {
        await this.performNotifyPaymentIntent({ paymentIntentId: params.paymentIntentId, transactionId: signature, maxAttempts: 1 });
      } catch {}
      const finalQuick = await this.awaitIntentTerminal({
        paymentIntentId: params.paymentIntentId,
        transactionId: signature,
        ledgerCanisterId: params.ledgerCanisterId!,
        amount: params.amount.toString(),
        metadata: { ...(params.metadata || {}), icpay_solana_tx_sig: signature },
      });
      return finalQuick;
    }
    // No prebuilt transaction available and builder fallback disabled
    throw new IcpayError({ code: ICPAY_ERROR_CODES.API_ERROR, message: 'Payment intent missing transactionBase64 for Solana' });
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
      // Always use relay overloads; server maps payNative/payERC20 to relay selectors
      payNative: apiSelectors.payNative || '0x8062dd66',   // payNative(bytes32,uint64,uint256,address)
      payERC20: apiSelectors.payERC20 || '0xc20b92c7',     // payERC20(bytes32,uint64,address,uint256,uint256,address)
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
        recipientAddress: (params.request as any)?.recipientAddress || null,
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

      const ZERO = '0x0000000000000000000000000000000000000000';
      const reqAny: any = params.request as any;
      const recipientPrimary = String(reqAny?.recipientAddress || '').trim();
      const recipientFromMap = String((reqAny?.recipientAddresses || {})?.evm || '').trim();
      const recipientCandidate = recipientPrimary || recipientFromMap;
      const recipient = /^0x[a-fA-F0-9]{40}$/.test(recipientCandidate) ? recipientCandidate : ZERO;
      if (isNative) {
        const externalCostStr = (params.request as any)?.__externalCostAmount;
        const externalCost = externalCostStr != null && externalCostStr !== '' ? BigInt(String(externalCostStr)) : 0n;
        const extSel = selector.payNative;
        if (!extSel) {
          throw new IcpayError({ code: ICPAY_ERROR_CODES.INVALID_CONFIG, message: 'Missing payNative selector from API; update API/chain metadata.' });
        }
        const data = extSel + idHex + toUint64(accountIdNum) + toUint256(externalCost) + toAddressPadded(recipient);
        debugLog(this.config.debug || false, 'evm native tx', { to: contractAddress, from: owner, dataLen: data.length, value: amountHex, recipient });
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
          throw new IcpayError({ code: ICPAY_ERROR_CODES.INVALID_CONFIG, message: 'Missing payERC20 selector from API; update API/chain metadata.' });
        }
        const base = idHex + toUint64(accountIdNum) + toAddressPadded(String(tokenAddress)) + toUint256(params.amount) + toUint256(externalCost);
        const data = extSel + base + toAddressPadded(recipient);
        debugLog(this.config.debug || false, 'evm erc20 pay', { to: contractAddress, from: owner, token: tokenAddress, dataLen: data.length, recipient });
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
      const isOnrampFlow = ((request as any)?.onrampPayment === true) || ((this as any)?.config?.onrampPayment === true);
      if (!ledgerCanisterId && !tokenShortcode && !(request as any).symbol && !isOnrampFlow) {
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
      let intentResp: any;
      try {
        debugLog(this.config.debug || false, 'creating payment intent');

        // Resolve expected sender principal:
        // Start with any value explicitly provided on the request or via connectedWallet.
        let expectedSenderPrincipal: string | undefined =
          (request as any).expectedSenderPrincipal ||
          this.connectedWallet?.owner ||
          this.connectedWallet?.principal?.toString();
        // If none yet and a Solana provider is present (e.g., Phantom), prefer its publicKey (base58).
        try {
          const solProv: any = (this.config as any)?.solanaProvider || (globalThis as any)?.solana;
          const solPk = solProv?.publicKey ? String(solProv.publicKey) : undefined;
          if (!expectedSenderPrincipal && solPk) {
            expectedSenderPrincipal = String(solPk);
          }
        } catch {}
        // Only if still missing, fall back to EVM accounts.
        if (!expectedSenderPrincipal) {
          const evm = (this.config as any)?.evmProvider || (globalThis as any)?.ethereum;
          if (evm?.request) {
            try {
              const accounts: string[] = await evm.request({ method: 'eth_accounts' });
              if (Array.isArray(accounts) && accounts[0]) {
                const lowerAccounts = accounts.map((a: string) => String(a).toLowerCase());
                const providedRaw = (request as any)?.expectedSenderPrincipal;
                if (providedRaw) {
                  const provided = String(providedRaw).toLowerCase();
                  expectedSenderPrincipal = lowerAccounts.includes(provided) ? accounts[lowerAccounts.indexOf(provided)] : accounts[0];
                } else {
                  expectedSenderPrincipal = accounts[0];
                }
              }
            } catch {}
          }
        }
        if (!expectedSenderPrincipal && !(((request as any)?.onrampPayment === true) || ((this as any)?.config?.onrampPayment === true))) {
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
      // Resolve recipientAddress only for non-onramp flows
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
      const reqAny: any = request as any;
      const addrObj = (reqAny?.recipientAddresses) || {};
      const candidateEvm = addrObj.evm ? addrObj.evm : undefined;
      const candidateIC = addrObj.ic ? addrObj.ic : undefined;
      const candidateSol = addrObj.sol ? addrObj.sol : undefined;
      let recipientAddress: string | undefined = undefined;
      if (!onramp) {
        // Choose a default to persist on the intent; EVM will override to ZERO if non-hex when building tx
        recipientAddress = (reqAny?.recipientAddress) || candidateEvm || candidateIC || candidateSol || ZERO_ADDRESS;
        debugLog(this.config.debug || false, 'recipientAddress resolved for intent', { recipientAddress });
      }
        if (isAtxp) {
          // Route ATXP intents to the ATXP endpoint so they link to the request
          const atxpRequestId = String(meta.atxp_request_id);
          const endpoint = `/sdk/public/atxp/requests/${encodeURIComponent(atxpRequestId)}/payment-intents`;
          intentResp = await this.publicApiClient.post(endpoint, {
            tokenShortcode: tokenShortcode || undefined,
            description: (request as any).description,
            recipientAddress,
            recipientAddresses: (request as any)?.recipientAddresses || undefined,
            externalCostAmount: (request as any)?.externalCostAmount ?? (request as any)?.metadata?.externalCostAmount ?? undefined,
            fiat_currency: (request as any)?.fiat_currency,
          });
        } else {
          if (onramp) {
            // Route onramp flows to the dedicated onramp endpoint without requiring token/ledger
            intentResp = await this.publicApiClient.post('/sdk/public/onramp/intents', {
              usdAmount: (request as any).amountUsd,
              description: (request as any).description,
              metadata: normalizeSdkMetadata(request.metadata || {}),
              widgetParams: request.widgetParams || undefined,
              recipientAddresses: (request as any)?.recipientAddresses || undefined,
              fiat_currency: (request as any)?.fiat_currency,
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
              metadata: normalizeSdkMetadata(request.metadata || {}),
              amountUsd: (request as any).amountUsd,
              // With tokenShortcode, backend derives chain. Keep legacy chainId for old flows.
              chainId: tokenShortcode ? undefined : (request as any).chainId,
              widgetParams: request.widgetParams || undefined,
              recipientAddress,
              recipientAddresses: (request as any)?.recipientAddresses || undefined,
              externalCostAmount: (request as any)?.externalCostAmount ?? (request as any)?.metadata?.externalCostAmount ?? undefined,
              fiat_currency: (request as any)?.fiat_currency,
            });
          }
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
        // Emit transaction created event only for non-onramp flows
        if (paymentIntentId) {
          if (!isOnrampFlow) {
            this.emit('icpay-sdk-transaction-created', {
              paymentIntentId,
              amount: resolvedAmountStr,
              ledgerCanisterId,
              expectedSenderPrincipal,
              accountCanisterId,
            });
          } else {
            // Optional: emit an onramp-specific event for UI
            try {
              (this as any).emit?.('icpay-sdk-onramp-intent-created', {
                paymentIntentId,
                amountUsd: (request as any).amountUsd,
                onramp: intentResp?.onramp,
              });
            } catch {}
          }
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

      // If this is an onramp flow, do NOT proceed with chain processing. Return onramp payload instead.
      const onrampPayload = (request as any).__onramp;
      if (isOnrampFlow && onrampPayload) {
        const early = {
          paymentIntentId,
          paymentIntentCode,
          onramp: onrampPayload,
          paymentIntent: intentResp?.paymentIntent || null,
        };
        this.emitMethodSuccess('createPayment', early);
        return early as any;
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
  async notifyLedgerTransaction(
    canisterId: string,
    ledgerCanisterId: string,
    blockIndex: bigint,
    opts?: { accountCanisterId?: number; externalCostAmount?: string | number | bigint | null; recipientPrincipal?: string | null }
  ): Promise<string> {
    this.emitMethodStart('notifyLedgerTransaction', { canisterId, ledgerCanisterId, blockIndex: blockIndex.toString() });
    // Create anonymous actor for canister notifications (no signature required)
    // Retry on transient certificate TrustError (clock skew)
    const maxAttempts = 3;
    let result: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const agent = new HttpAgent({ host: this.icHost });
        const actor = Actor.createActor(icpayIdl, { agent, canisterId });
        // Prefer v2 when available and we have required inputs
        const maybeV2 = (actor as any)?.notify_ledger_transaction_v2;
        const haveAcct = typeof opts?.accountCanisterId === 'number' && Number.isFinite(opts.accountCanisterId);
        if (maybeV2 && haveAcct) {
          try { debugLog(this.config.debug || false, 'notify using v2', { ledgerCanisterId, blockIndex: blockIndex.toString(), accountCanisterId: opts?.accountCanisterId, hasExternalCost: opts?.externalCostAmount != null, hasRecipient: Boolean((opts?.recipientPrincipal || '').trim()) }); } catch {}
          const externalCost = (() => {
            if (opts?.externalCostAmount == null) return [];
            try {
              const v = BigInt(String(opts.externalCostAmount));
              if (v < 0n) return [];
              return [v];
            } catch { return []; }
          })();
          const recipient = (() => {
            const s = (opts?.recipientPrincipal || '').trim();
            return s ? [s] : [];
          })();
          result = await (actor as any).notify_ledger_transaction_v2(
            { ledger_canister_id: ledgerCanisterId, block_index: blockIndex },
            BigInt(opts!.accountCanisterId!),
            externalCost,
            recipient
          );
        } else {
          try { debugLog(this.config.debug || false, 'notify using v1 (fallback)', { ledgerCanisterId, blockIndex: blockIndex.toString(), haveAcct }); } catch {}
          // Fallback to legacy notify
          result = await (actor as any).notify_ledger_transaction({
            // Canister expects text for ledger_canister_id
            ledger_canister_id: ledgerCanisterId,
            block_index: blockIndex
          });
        }
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
  async getExternalWalletBalances(params: { network: 'evm' | 'ic'; address?: string; principal?: string; chainId?: string; amountUsd?: number; amount?: string; fiatCurrency?: string; chainShortcodes?: string[]; tokenShortcodes?: string[] }): Promise<AllLedgerBalances> {
    this.emitMethodStart('getExternalWalletBalances', { params });
    try {
      const search = new URLSearchParams();
      if (params.network) search.set('network', params.network);
      if (params.address) search.set('address', params.address);
      if (params.principal) search.set('principal', params.principal);
      if (params.chainId) search.set('chainId', params.chainId);
      if (typeof params.amountUsd === 'number' && isFinite(params.amountUsd)) search.set('amountUsd', String(params.amountUsd));
      if (typeof params.amount === 'string' && params.amount) search.set('amount', params.amount);
      if (typeof params.fiatCurrency === 'string' && params.fiatCurrency.trim()) search.set('fiatCurrency', params.fiatCurrency.trim());
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
      const isOnrampFlow = (request as any)?.onrampPayment === true || (this as any)?.config?.onrampPayment === true;
      if (!ledgerCanisterId && !tokenShortcode && !(request as any).symbol && !isOnrampFlow) {
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
        recipientAddress: (request as any)?.recipientAddress || '0x0000000000000000000000000000000000000000',
        recipientAddresses: (request as any)?.recipientAddresses,
        fiat_currency: (request as any)?.fiat_currency,
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
        metadata: normalizeSdkMetadata(request.metadata || {}),
        chainId: tokenShortcode ? undefined : (request as any).chainId,
        x402: true,
        recipientAddress: (request as any)?.recipientAddress || '0x0000000000000000000000000000000000000000',
        fiat_currency: (request as any)?.fiat_currency,
      };
      // Include Solana payerPublicKey so server can build unsigned tx (standard x402 flow)
      try {
        const w: any = (globalThis as any)?.window || (globalThis as any);
        const sol = (this.config as any)?.solanaProvider || (this.config as any)?.connectedWallet?.solana || (this.config as any)?.connectedWallet || w?.solana || w?.phantom?.solana;
        const pk = sol?.publicKey?.toBase58?.() || sol?.publicKey || null;
        if (pk && typeof pk === 'string') {
          (body as any).payerPublicKey = pk;
        }
      } catch {}

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
              // Determine network once for error handling policy
              const isSol = typeof (requirement as any)?.network === 'string' && String((requirement as any).network).toLowerCase().startsWith('solana:');
              try {
                const providerForHeader = isSol
                  ? ((this.config as any)?.solanaProvider || (globalThis as any)?.solana || (globalThis as any)?.phantom?.solana)
                  : ((this.config as any)?.evmProvider || (globalThis as any)?.ethereum);
                let paymentHeader: string | null = null;
                // IC x402: client-side settle via allowance + canister pull
                const isIc = typeof (requirement as any)?.network === 'string' && String((requirement as any).network).toLowerCase().startsWith('icp:');
                if (isIc) {
                  // IC x402: client ensures allowance; then call API settle so services (controller) pulls and notifies
                  if (!this.actorProvider) {
                    throw new IcpayError({ code: ICPAY_ERROR_CODES.WALLET_PROVIDER_NOT_AVAILABLE, message: 'actorProvider required for IC x402' });
                  }
                  // Ensure allowance first
                  const asset = String((requirement as any)?.asset || (requirement as any)?.payTo || '').trim();
                  const amountStr = String((requirement as any)?.maxAmountRequired || '0');
                  const amountBn = BigInt(amountStr);
                  if (!asset || amountBn <= 0n) {
                    throw new IcpayError({ code: ICPAY_ERROR_CODES.API_ERROR, message: 'Invalid x402 IC requirement (asset/amount)' });
                  }
                  // Approve spender (ICPay canister) for amount
                  if (!this.icpayCanisterId) {
                    // Prefer payTo from x402 requirement as ICPay canister id if present
                    try {
                      const maybe = String((requirement as any)?.payTo || '');
                      if (maybe) {
                        // Validate shape by attempting to parse
                        Principal.fromText(maybe);
                        this.icpayCanisterId = maybe;
                      }
                    } catch {}
                  }
                  if (!this.icpayCanisterId) {
                    // Fallback to account lookup
                    const acctInfo = await this.fetchAccountInfo();
                    this.icpayCanisterId = (acctInfo as any)?.icpayCanisterId?.toString?.() || this.icpayCanisterId;
                  }
                  if (!this.icpayCanisterId) {
                    throw new IcpayError({ code: ICPAY_ERROR_CODES.INVALID_CONFIG, message: 'Missing ICPay canister id for IC x402' });
                  }
                  // Fetch fee with anonymous agent so Oisy/signer only sees icrc2_approve (ICRC-21 supports
                  // icrc2_approve but not icrc1_fee – otherwise signer shows "UnsupportedCanisterCall: icrc1_fee")
                  let feeBn = 0n;
                  try {
                    const readOnlyAgent = new HttpAgent({ host: this.icHost });
                    const readOnlyLedger = Actor.createActor(ledgerIdl, { agent: readOnlyAgent, canisterId: asset });
                    const f = await readOnlyLedger.icrc1_fee();
                    feeBn = typeof f === 'bigint' ? f : BigInt(f as string | number | boolean);
                  } catch {}
                  const approveAmount = amountBn + (feeBn > 0n ? feeBn : 0n);
                  const ledgerActor = this.actorProvider(asset, ledgerIdl);
                  try {
                    await ledgerActor.icrc2_approve({
                      fee: [],
                      memo: [],
                      from_subaccount: [],
                      created_at_time: [],
                      amount: approveAmount,
                      expected_allowance: [],
                      expires_at: [],
                      spender: { owner: Principal.fromText(this.icpayCanisterId), subaccount: [] },
                    });
                  } catch (apprErr: any) {
                    throw new IcpayError({ code: ICPAY_ERROR_CODES.TRANSACTION_FAILED, message: 'ICRC-2 approve failed', details: apprErr });
                  }
                  // Obtain payer principal if available
                  let payerPrincipal: string | null = null;
                  try {
                    const p = this.wallet.getPrincipal();
                    if (p) payerPrincipal = p.toText();
                    else if (this.connectedWallet && typeof this.connectedWallet.getPrincipal === 'function') {
                      const maybe = await this.connectedWallet.getPrincipal();
                      if (typeof maybe === 'string') payerPrincipal = maybe;
                    } else if (this.connectedWallet?.principal) {
                      payerPrincipal = String(this.connectedWallet.principal);
                    }
                  } catch {}
                  // Build memo from accountCanisterId and intentCode for matching on services
                  let memoBytes: number[] | undefined = undefined;
                  try {
                    const extra: any = (requirement as any)?.extra || {};
                    const accIdStr = String(extra?.accountCanisterId || '');
                    const icIntentCodeStr = String(extra?.intentCode || '');
                    const accIdNum = accIdStr ? parseInt(accIdStr, 10) : 0;
                    const icIntentCodeNum = icIntentCodeStr ? parseInt(icIntentCodeStr, 10) : 0;
                    if (Number.isFinite(accIdNum) && accIdNum > 0 && Number.isFinite(icIntentCodeNum) && icIntentCodeNum > 0) {
                      const packed = this.createPackedMemo(accIdNum, icIntentCodeNum);
                      memoBytes = Array.from(packed);
                    }
                  } catch {}
                  // Call API to settle IC x402 via services (controller will pull + notify)
                  try { this.emitMethodStart('settleX402', { paymentIntentId, network: 'ic' }); } catch {}
                  const settleRespIc: any = await this.publicApiClient.post('/sdk/public/payments/x402/settle', {
                    paymentIntentId,
                    paymentHeader: null, // not used for IC allowance path
                    paymentRequirements: requirement,
                    payerPrincipal,
                    memoBytes: memoBytes || null,
                  });
                  const statusIc = (settleRespIc?.status || settleRespIc?.paymentIntent?.status || 'completed').toString().toLowerCase();
                  const amountIc =
                    (settleRespIc?.paymentIntent?.amount && String(settleRespIc.paymentIntent.amount)) ||
                    (typeof usdAmount === 'number' ? String(usdAmount) : (request as any)?.amount?.toString?.() || '0');
                  const outIc = {
                    transactionId: Number(settleRespIc?.canisterTxId || 0),
                    status: statusIc === 'succeeded' ? 'completed' : statusIc,
                    amount: amountIc,
                    recipientCanister: this.icpayCanisterId,
                    timestamp: new Date(),
                    metadata: { ...(request.metadata || {}), icpay_x402: true, icpay_network: 'ic' },
                    payment: settleRespIc || null,
                  } as any;
                  const isTerminalIc = (() => {
                    const s = String(outIc.status || '').toLowerCase();
                    return s === 'completed' || s === 'succeeded' || s === 'failed' || s === 'canceled' || s === 'cancelled' || s === 'mismatched';
                  })();
                  if (isTerminalIc) {
                    if (outIc.status === 'completed') {
                      this.emit('icpay-sdk-transaction-completed', outIc);
                    } else if (outIc.status === 'failed') {
                      this.emit('icpay-sdk-transaction-failed', outIc);
                    } else {
                      this.emit('icpay-sdk-transaction-updated', outIc);
                    }
                    this.emitMethodSuccess('createPaymentX402Usd', outIc);
                    return outIc;
                  }
                  try { this.emit('icpay-sdk-transaction-updated', outIc); } catch {}
                  const waitedIc = await this.awaitIntentTerminal({
                    paymentIntentId,
                    ledgerCanisterId: asset,
                    amount: amountIc,
                    canisterTransactionId: String(settleRespIc?.canisterTxId || ''),
                    metadata: { ...(request.metadata || {}), icpay_x402: true, icpay_network: 'ic' },
                  });
                  this.emitMethodSuccess('createPaymentX402Usd', waitedIc);
                  return waitedIc;
                }
                if (!isSol) {
                  paymentHeader = await buildAndSignX402PaymentHeader(requirement, {
                    x402Version: Number(data?.x402Version || 2),
                    debug: this.config?.debug || false,
                    provider: providerForHeader,
                  });
                }
                if (isSol) {
                  // Solana x402: follow standard flow (https://solana.com/developers/guides/getstarted/intro-to-x402)
                  // — client signs transaction with signTransaction, then relay. No signMessage.
                  const solTxBase64: string | undefined = (requirement as any)?.extra?.transactionBase64;
                  const solMsgB58: string | undefined = (requirement as any)?.extra?.messageBase58;
                  const signableMsgB64: string | undefined = (requirement as any)?.extra?.signableMessageBase64;
                  const signableFields: any = (requirement as any)?.extra?.signableFields || {};
                  const sol = providerForHeader;
                  if (!sol) throw new IcpayError({ code: ICPAY_ERROR_CODES.WALLET_PROVIDER_NOT_AVAILABLE, message: 'Solana provider not available (window.solana)' });
                  // Get public key (already connected from widget)
                  let fromBase58: string | null = null;
                  try { fromBase58 = sol?.publicKey?.toBase58?.() || sol?.publicKey || null; } catch {}
                  if (!fromBase58 && typeof sol.connect === 'function') {
                    try { const con = await (sol as any).connect({ onlyIfTrusted: false }); fromBase58 = con?.publicKey?.toBase58?.() || con?.publicKey || null; } catch {}
                  }
                  if (!fromBase58) throw new IcpayError({ code: ICPAY_ERROR_CODES.WALLET_NOT_CONNECTED, message: 'Solana wallet not connected' });
                  // Standard x402: when server provided unsigned tx, sign it and relay (no signMessage)
                  if (solTxBase64 && solTxBase64.length > 0) {
                    if (typeof (sol as any)?.connect === 'function') {
                      try { await (sol as any).connect({ onlyIfTrusted: false }); } catch {}
                    }
                    const __txB64 = String(solTxBase64);
                    const inlineMsgB58 = solMsgB58 && solMsgB58.length > 0 ? String(solMsgB58) : base58Encode(u8FromBase64(__txB64));
                    let signedTxB64: string | null = null;
                    let r: any = null;
                    if ((sol as any)?.request) {
                      try {
                        try { r = await (sol as any).request({ method: 'signTransaction', params: { message: inlineMsgB58 } }); } catch {}
                        if (!r) try { r = await (sol as any).request({ method: 'signTransaction', params: inlineMsgB58 as any }); } catch {}
                        if (!r) try { r = await (sol as any).request({ method: 'solana:signTransaction', params: { transaction: __txB64 } }); } catch {}
                        if (!r) try { r = await (sol as any).request({ method: 'signTransaction', params: { transaction: __txB64 } }); } catch {}
                      } catch {}
                    }
                    signedTxB64 = normalizeSolanaSignedTransaction(r) ?? signedTxB64;
                    if (!signedTxB64 && r) {
                      const candidate = (r?.signedTransaction || r?.transaction || r?.signedMessage || r) as any;
                      if (typeof candidate === 'string') {
                        const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(candidate) && candidate.length % 4 === 0;
                        if (looksBase64) signedTxB64 = candidate;
                      } else if (candidate && (candidate.byteLength != null || ArrayBuffer.isView(candidate))) {
                        const b = candidate instanceof Uint8Array ? candidate : new Uint8Array(candidate as ArrayBufferLike);
                        if (b.length > 64) signedTxB64 = b64FromBytes(b);
                      } else if (typeof r === 'object') {
                        const obj = r as any;
                        if (typeof obj.signedTransaction === 'string') signedTxB64 = obj.signedTransaction;
                        else if (typeof obj.transaction === 'string') signedTxB64 = obj.transaction;
                      }
                    }
                    if (!signedTxB64 && typeof (sol as any).signTransaction === 'function') {
                      try {
                        const txBytes = u8FromBase64(__txB64);
                        const stx = await (sol as any).signTransaction(txBytes as any);
                        signedTxB64 = normalizeSolanaSignedTransaction(stx) ?? signedTxB64;
                      } catch {}
                    }
                    if (signedTxB64) {
                      const relay = await this.publicApiClient.post('/sdk/public/payments/solana/relay', {
                        signedTransactionBase64: signedTxB64,
                        paymentIntentId,
                        facilitatorPaysFee: true,
                      });
                      const sig = (relay && (relay as any).signature) || null;
                      try { this.emitMethodSuccess('notifyLedgerTransaction', { paymentIntentId }); } catch {}
                      if (sig) {
                        try { await this.performNotifyPaymentIntent({ paymentIntentId, transactionId: sig, maxAttempts: 1 }); } catch {}
                      }
                      const relayStatus = (relay as any)?.status || (relay as any)?.paymentIntent?.status || (relay as any)?.payment?.status || '';
                      const terminal = typeof relayStatus === 'string' && ['completed', 'succeeded'].includes(String(relayStatus).toLowerCase());
                      if (terminal) {
                        const out = {
                          transactionId: 0,
                          status: String(relayStatus).toLowerCase() === 'succeeded' ? 'completed' : (relayStatus as string),
                          amount: (requirement as any)?.maxAmountRequired?.toString?.() || '',
                          recipientCanister: ledgerCanisterId,
                          timestamp: new Date(),
                          metadata: { ...(request.metadata || {}), icpay_x402: true, icpay_solana_tx_sig: sig },
                          payment: relay,
                        } as any;
                        this.emit('icpay-sdk-transaction-completed', out);
                        this.emitMethodSuccess('createPaymentX402Usd', out);
                        return out;
                      }
                      const waited = await this.awaitIntentTerminal({
                        paymentIntentId,
                        transactionId: sig,
                        ledgerCanisterId: ledgerCanisterId,
                        amount: (requirement as any)?.maxAmountRequired?.toString?.() || '',
                        metadata: { ...(request.metadata || {}), icpay_x402: true, icpay_solana_tx_sig: sig },
                      });
                      this.emitMethodSuccess('createPaymentX402Usd', waited);
                      return waited;
                    }
                    throw new IcpayError({
                      code: ICPAY_ERROR_CODES.TRANSACTION_FAILED,
                      message: 'Transaction was not signed. Please approve the transaction in your wallet.',
                    });
                  }
                  // Fallback: message-sign flow only when no transactionBase64 (e.g. 402 built without payerPublicKey)
                  if (signableMsgB64) {
                    // Sign the provided message and settle via header (services will submit)
                    // Ensure explicit connect prompt before signing
                    if (typeof (sol as any)?.connect === 'function') {
                      try { await (sol as any).connect({ onlyIfTrusted: false }); } catch {}
                    }
                    let sigB64: string | null = null;
                    const msgBytes = u8FromBase64(signableMsgB64);
                    const msgB58ForReq = base58Encode(msgBytes);
                    // Attempts in order (strict):
                    // 1) Wallet Standard: request colon form with Uint8Array (Phantom returns { signature, rawSignature } or { signature: Uint8Array })
                    if (!sigB64 && (sol as any)?.request) {
                      try {
                        try { debugLog(this.config?.debug || false, 'sol signMessage(request) params', { method: 'solana:signMessage', shape: 'object{message:Uint8Array}', len: msgBytes.length }); } catch {}
                        const r0: any = await (sol as any).request({ method: 'solana:signMessage', params: { message: msgBytes } });
                        sigB64 = normalizeSolanaMessageSignature(r0) ?? sigB64;
                      } catch (e0) {
                        try { debugLog(this.config?.debug || false, 'sol solana:signMessage failed', { error: String(e0) }); } catch {}
                      }
                    }
                    // 2) Native: signMessage(Uint8Array)
                    if (!sigB64 && typeof (sol as any)?.signMessage === 'function') {
                      try {
                        try { debugLog(this.config?.debug || false, 'sol signMessage(fn) Uint8Array'); } catch {}
                        const r2: any = await (sol as any).signMessage(msgBytes);
                        sigB64 = normalizeSolanaMessageSignature(r2) ?? sigB64;
                      } catch (e2) {
                        try { debugLog(this.config?.debug || false, 'sol signMessage(fn) failed', { error: String(e2) }); } catch {}
                      }
                    }
                    // 3) Request: signMessage with Uint8Array payload (legacy method name)
                    if (!sigB64 && (sol as any)?.request) {
                      try {
                        try { debugLog(this.config?.debug || false, 'sol signMessage(request) params', { method: 'signMessage', shape: 'object{message:Uint8Array}', len: msgBytes.length }); } catch {}
                        const r3: any = await (sol as any).request({ method: 'signMessage', params: { message: msgBytes } });
                        sigB64 = normalizeSolanaMessageSignature(r3) ?? sigB64;
                      } catch (e3) {
                        try { debugLog(this.config?.debug || false, 'sol signMessage(request Uint8Array) failed', { error: String(e3) }); } catch {}
                      }
                    }
                    // 4) Request: signMessage with base58
                    if (!sigB64 && (sol as any)?.request) {
                      try {
                        try { debugLog(this.config?.debug || false, 'sol signMessage(request) params', { method: 'signMessage', shape: 'object{message:base58}', len: msgB58ForReq.length }); } catch {}
                        const r4: any = await (sol as any).request({ method: 'signMessage', params: { message: msgB58ForReq } });
                        sigB64 = normalizeSolanaMessageSignature(r4) ?? sigB64;
                      } catch (e4) {
                        try { debugLog(this.config?.debug || false, 'sol signMessage(request legacy) failed', { error: String(e4) }); } catch {}
                      }
                    }
                    if (sigB64) {
                      // Build x402 header and settle
                    const header = buildX402HeaderFromAuthorization({
                      x402Version: Number(data?.x402Version || 2),
                      scheme: String((requirement as any)?.scheme || 'exact'),
                      network: String((requirement as any)?.network || ''),
                      from: String(fromBase58 || ''),
                      to: String((requirement as any)?.payTo || ''),
                      value: String((requirement as any)?.maxAmountRequired || '0'),
                      validAfter: String(signableFields?.validAfter || '0'),
                      validBefore: String(signableFields?.validBefore || '0'),
                      nonce: String(signableFields?.nonceHex || ''),
                      signature: String(sigB64),
                    });
                    const headerJson = JSON.stringify(header);
                    const headerB64 = (() => {
                      try {
                        const Buf = (globalThis as any).Buffer;
                        return Buf ? Buf.from(headerJson, 'utf8').toString('base64') : (globalThis as any)?.btoa?.(headerJson) || '';
                      } catch { return ''; }
                    })();
                    const settleRespSol: any = await this.publicApiClient.post('/sdk/public/payments/x402/settle', {
                      paymentIntentId,
                      paymentHeader: headerB64,
                      paymentRequirements: requirement,
                    });
                    try {
                      debugLog(this.config?.debug || false, 'x402 (sol) settle via header response', {
                        ok: (settleRespSol as any)?.ok,
                        status: (settleRespSol as any)?.status,
                        paymentIntentId: (settleRespSol as any)?.paymentIntent?.id,
                        paymentId: (settleRespSol as any)?.payment?.id,
                        rawKeys: Object.keys(settleRespSol || {}),
                      });
                    } catch {}
                    const statusSolHdr = (settleRespSol?.status || settleRespSol?.paymentIntent?.status || 'completed').toString().toLowerCase();
                    const amountSolHdr =
                      (settleRespSol?.paymentIntent?.amount && String(settleRespSol.paymentIntent.amount)) ||
                      (typeof usdAmount === 'number' ? String(usdAmount) : (request as any)?.amount?.toString?.() || '0');
                    const outSolHdr = {
                      transactionId: Number(settleRespSol?.canisterTxId || 0),
                      status: statusSolHdr === 'succeeded' ? 'completed' : statusSolHdr,
                      amount: amountSolHdr,
                      recipientCanister: ledgerCanisterId,
                      timestamp: new Date(),
                      metadata: { ...(request.metadata || {}), icpay_x402: true },
                      payment: settleRespSol || null,
                    } as any;
                    const isTerminalSolHdr = (() => {
                      const s = String(outSolHdr.status || '').toLowerCase();
                      return s === 'completed' || s === 'succeeded' || s === 'failed' || s === 'canceled' || s === 'cancelled' || s === 'mismatched';
                    })();
                    if (isTerminalSolHdr) {
                      if (outSolHdr.status === 'completed') {
                        this.emit('icpay-sdk-transaction-completed', outSolHdr);
                      } else if (outSolHdr.status === 'failed') {
                        this.emit('icpay-sdk-transaction-failed', outSolHdr);
                      } else {
                        this.emit('icpay-sdk-transaction-updated', outSolHdr);
                      }
                      this.emitMethodSuccess('createPaymentX402Usd', outSolHdr);
                      return outSolHdr;
                    }
                    // Non-terminal: wait until terminal via notify loop
                    try { this.emit('icpay-sdk-transaction-updated', outSolHdr); } catch {}
                    const waitedSolHdr = await this.awaitIntentTerminal({
                      paymentIntentId,
                      ledgerCanisterId: ledgerCanisterId,
                      amount: amountSolHdr,
                      metadata: { ...(request.metadata || {}), icpay_x402: true },
                    });
                    this.emitMethodSuccess('createPaymentX402Usd', waitedSolHdr);
                    return waitedSolHdr;
                    } else {
                      // Fallback: if API provided an unsigned transaction, try transaction-signing path (signTransaction like normal Solana flow)
                      const fallbackTx: string | undefined = (requirement as any)?.extra?.transactionBase64;
                      if (!fallbackTx) {
                        throw new IcpayError({
                          code: ICPAY_ERROR_CODES.TRANSACTION_FAILED,
                          message: 'Wallet did not sign message. Connect your Solana wallet before starting the payment and try again.',
                        });
                      }
                      // Inject for transaction-signing fallback below
                      // eslint-disable-next-line @typescript-eslint/no-unused-vars
                      const __fallbackTxBase64 = String(fallbackTx);
                      // Reassign txBase64 by creating a new block scope later; use a marker in metadata to indicate fallback used
                      try { debugLog(this.config?.debug || false, 'sol x402 fallback to transaction signing'); } catch {}
                      // Use local variable for fallback path
                      let signedTxB64: string | null = null;
                      let signerSigBase58: string | null = null;
                      const inlineMsgB58Fallback: string | undefined = (requirement as any)?.extra?.messageBase58 || undefined;
                      // Ensure explicit connect to prompt wallet if needed
                      if (typeof (sol as any)?.connect === 'function') {
                        try { await (sol as any).connect({ onlyIfTrusted: false }); } catch {}
                      }
                      // Do NOT submit from wallet; only sign, then relay to backend
                      // Try signAllTransactions (array) then signTransaction with message:base58 (prefer) then transaction:base64
                      if ((sol as any)?.request) {
                        try {
                          let r: any = null;
                          // 0) Try Wallet Standard signAllTransactions with Uint8Array
                          try {
                            const txBytes = u8FromBase64(__fallbackTxBase64);
                            try { debugLog(this.config?.debug || false, 'sol signAllTransactions(request) params', { method: 'solana:signAllTransactions', shape: 'object{transactions:Uint8Array[]}', count: 1, txLen: txBytes.length }); } catch {}
                            r = await (sol as any).request({ method: 'solana:signAllTransactions', params: { transactions: [txBytes] } });
                          } catch {}
                          // 0b) Legacy signAllTransactions with Uint8Array
                          if (!r) {
                            try {
                              const txBytes = u8FromBase64(__fallbackTxBase64);
                              try { debugLog(this.config?.debug || false, 'sol signAllTransactions(request) params', { method: 'signAllTransactions', shape: 'object{transactions:Uint8Array[]}', count: 1, txLen: txBytes.length }); } catch {}
                              r = await (sol as any).request({ method: 'signAllTransactions', params: { transactions: [txBytes] } });
                            } catch {}
                          }
                          // 0c) signAllTransactions with base64 strings
                          if (!r) {
                            try { debugLog(this.config?.debug || false, 'sol signAllTransactions(request) params', { method: 'solana:signAllTransactions', shape: 'object{transactions:base64[]}', count: 1, txLen: __fallbackTxBase64.length }); } catch {}
                            try { r = await (sol as any).request({ method: 'solana:signAllTransactions', params: { transactions: [__fallbackTxBase64] } }); } catch {}
                          }
                          if (!r) {
                            try { debugLog(this.config?.debug || false, 'sol signAllTransactions(request) params', { method: 'signAllTransactions', shape: 'object{transactions:base64[]}', count: 1, txLen: __fallbackTxBase64.length }); } catch {}
                            try { r = await (sol as any).request({ method: 'signAllTransactions', params: { transactions: [__fallbackTxBase64] } }); } catch {}
                          }
                          if (r) {
                            // Normalize array responses
                            const arr = Array.isArray(r) ? r : (Array.isArray((r as any)?.transactions) ? (r as any).transactions : null);
                            if (arr && arr.length > 0) {
                              const first = arr[0];
                              if (typeof first === 'string') {
                                const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(first) && first.length % 4 === 0;
                                if (looksBase64) signedTxB64 = first;
                              } else if (first && (first.byteLength != null || ArrayBuffer.isView(first))) {
                                const b = first instanceof Uint8Array ? first : new Uint8Array(first as ArrayBufferLike);
                                // If it's a raw signature (64 bytes) treat as signature; otherwise treat as signed tx bytes
                                if (b.length === 64) signerSigBase58 = base58Encode(b); else signedTxB64 = b64FromBytes(b);
                              }
                            }
                          }
                          if (signedTxB64 || signerSigBase58) {
                            // short-circuit to relay below
                          }
                          // 1) Try message: base58 (string form first)
                          if (inlineMsgB58Fallback) {
                            try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'signTransaction', paramShape: 'message:string(base58)', msgLen: inlineMsgB58Fallback.length }); } catch {}
                            try { r = await (sol as any).request({ method: 'signTransaction', params: inlineMsgB58Fallback as any }); } catch {}
                            let candidate = (r?.signedTransaction || r?.transaction || r?.signedMessage || r) as any;
                            if (!signedTxB64 && !signerSigBase58) {
                              if (typeof candidate === 'string') {
                                const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(candidate) && candidate.length % 4 === 0;
                                if (looksBase64) signedTxB64 = candidate; else signerSigBase58 = candidate;
                              } else if (candidate && (candidate.byteLength != null || ArrayBuffer.isView(candidate))) {
                                const b = candidate instanceof Uint8Array ? candidate : new Uint8Array(candidate as ArrayBufferLike);
                                if (b.length === 64) signerSigBase58 = base58Encode(b);
                              }
                            }
                            // 1b) Try message: base58 (array form)
                            if (!signedTxB64 && !signerSigBase58) {
                              try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'signTransaction', paramShape: 'message:[string]', msgLen: inlineMsgB58Fallback.length }); } catch {}
                              try { r = await (sol as any).request({ method: 'signTransaction', params: [inlineMsgB58Fallback] as any }); } catch {}
                              candidate = (r?.signedTransaction || r?.transaction || r?.signedMessage || r) as any;
                              if (typeof candidate === 'string') {
                                const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(candidate) && candidate.length % 4 === 0;
                                if (looksBase64) signedTxB64 = candidate; else signerSigBase58 = candidate;
                              } else if (candidate && (candidate.byteLength != null || ArrayBuffer.isView(candidate))) {
                                const b = candidate instanceof Uint8Array ? candidate : new Uint8Array(candidate as ArrayBufferLike);
                                if (b.length === 64) signerSigBase58 = base58Encode(b);
                              }
                            }
                            // 1c) Try message: base58 (object form)
                            if (!signedTxB64 && !signerSigBase58) {
                              try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'signTransaction', paramShape: 'message:object{message}', msgLen: inlineMsgB58Fallback.length }); } catch {}
                              try { r = await (sol as any).request({ method: 'signTransaction', params: { message: inlineMsgB58Fallback } }); } catch {}
                              candidate = (r?.signedTransaction || r?.transaction || r?.signedMessage || r) as any;
                              if (typeof candidate === 'string') {
                                const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(candidate) && candidate.length % 4 === 0;
                                if (looksBase64) signedTxB64 = candidate; else signerSigBase58 = candidate;
                              } else if (candidate && (candidate.byteLength != null || ArrayBuffer.isView(candidate))) {
                                const b = candidate instanceof Uint8Array ? candidate : new Uint8Array(candidate as ArrayBufferLike);
                                if (b.length === 64) signerSigBase58 = base58Encode(b);
                              }
                            }
                          }
                          // 2) If still nothing, try transaction: base64
                          if (!signedTxB64 && !signerSigBase58) {
                            // Wallet Standard first
                            try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'solana:signTransaction', paramShape: 'object{transaction:base64}', txLen: __fallbackTxBase64.length }); } catch {}
                            try { r = await (sol as any).request({ method: 'solana:signTransaction', params: { transaction: __fallbackTxBase64 } }); } catch {}
                            let candidate = (r?.signedTransaction || r?.transaction || r?.signedMessage || r) as any;
                            if (typeof candidate === 'string') {
                              const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(candidate) && candidate.length % 4 === 0;
                              if (looksBase64) signedTxB64 = candidate; else signerSigBase58 = candidate;
                            } else if (candidate && (candidate.byteLength != null || ArrayBuffer.isView(candidate))) {
                              const b = candidate instanceof Uint8Array ? candidate : new Uint8Array(candidate as ArrayBufferLike);
                              if (b.length === 64) signerSigBase58 = base58Encode(b);
                            }
                          }
                          if (!signedTxB64 && !signerSigBase58) {
                            // Legacy string form
                            try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'signTransaction', paramShape: 'transaction:string(base64)', txLen: __fallbackTxBase64.length }); } catch {}
                            try { r = await (sol as any).request({ method: 'signTransaction', params: __fallbackTxBase64 as any }); } catch {}
                            let candidate = (r?.signedTransaction || r?.transaction || r?.signedMessage || r) as any;
                            if (typeof candidate === 'string') {
                              const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(candidate) && candidate.length % 4 === 0;
                              if (looksBase64) signedTxB64 = candidate; else signerSigBase58 = candidate;
                            } else if (candidate && (candidate.byteLength != null || ArrayBuffer.isView(candidate))) {
                              const b = candidate instanceof Uint8Array ? candidate : new Uint8Array(candidate as ArrayBufferLike);
                              if (b.length === 64) signerSigBase58 = base58Encode(b);
                            }
                          }
                          if (!signedTxB64 && !signerSigBase58) {
                            // Legacy array form
                            try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'signTransaction', paramShape: 'transaction:[string]', txLen: __fallbackTxBase64.length }); } catch {}
                            try { r = await (sol as any).request({ method: 'signTransaction', params: [__fallbackTxBase64] as any }); } catch {}
                            const candidate = (r?.signedTransaction || r?.transaction || r?.signedMessage || r) as any;
                            if (typeof candidate === 'string') {
                              const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(candidate) && candidate.length % 4 === 0;
                              if (looksBase64) signedTxB64 = candidate; else signerSigBase58 = candidate;
                            } else if (candidate && (candidate.byteLength != null || ArrayBuffer.isView(candidate))) {
                              const b = candidate instanceof Uint8Array ? candidate : new Uint8Array(candidate as ArrayBufferLike);
                              if (b.length === 64) signerSigBase58 = base58Encode(b);
                            }
                          }
                          if (!signedTxB64 && !signerSigBase58) {
                            // Legacy object form
                            try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'signTransaction', paramShape: 'transaction:object{transaction}', txLen: __fallbackTxBase64.length }); } catch {}
                            try { r = await (sol as any).request({ method: 'signTransaction', params: { transaction: __fallbackTxBase64 } }); } catch {}
                            const candidate = (r?.signedTransaction || r?.transaction || r?.signedMessage || r) as any;
                            if (typeof candidate === 'string') {
                              const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(candidate) && candidate.length % 4 === 0;
                              if (looksBase64) signedTxB64 = candidate; else signerSigBase58 = candidate;
                            } else if (candidate && (candidate.byteLength != null || ArrayBuffer.isView(candidate))) {
                              const b = candidate instanceof Uint8Array ? candidate : new Uint8Array(candidate as ArrayBufferLike);
                              if (b.length === 64) signerSigBase58 = base58Encode(b);
                            }
                          }
                        } catch {}
                      }
                      let settleResp: any;
                      if (signedTxB64 && typeof signedTxB64 === 'string') {
                        settleResp = await this.publicApiClient.post('/sdk/public/payments/x402/relay', {
                          paymentIntentId,
                          signedTransactionBase64: signedTxB64,
                          rpcUrlPublic: (requirement as any)?.extra?.rpcUrlPublic || null,
                        });
                      } else if (signerSigBase58) {
                        settleResp = await this.publicApiClient.post('/sdk/public/payments/x402/relay', {
                          paymentIntentId,
                          signatureBase58: signerSigBase58,
                          transactionBase64: __fallbackTxBase64,
                          payerPublicKey: fromBase58,
                          rpcUrlPublic: (requirement as any)?.extra?.rpcUrlPublic || null,
                        });
                      } else {
                        throw new IcpayError({ code: ICPAY_ERROR_CODES.TRANSACTION_FAILED, message: 'Wallet did not return a signed transaction' });
                      }
                      const statusSol = (settleResp?.status || settleResp?.paymentIntent?.status || 'completed').toString().toLowerCase();
                      const amountSol =
                        (settleResp?.paymentIntent?.amount && String(settleResp.paymentIntent.amount)) ||
                        (typeof usdAmount === 'number' ? String(usdAmount) : (request as any)?.amount?.toString?.() || '0');
                      const outSol = {
                        transactionId: Number(settleResp?.canisterTxId || 0),
                        status: statusSol === 'succeeded' ? 'completed' : statusSol,
                        amount: amountSol,
                        recipientCanister: ledgerCanisterId,
                        timestamp: new Date(),
                        metadata: { ...(request.metadata || {}), icpay_x402: true },
                        payment: settleResp || null,
                      } as any;
                      this.emitMethodSuccess('createPaymentX402Usd', outSol);
                      return outSol;
                    }
                  }
                  // Otherwise fall back to unsigned transaction flow if provided
                  const inlineTx: string | undefined = (requirement as any)?.extra?.transactionBase64;
                  const wSolCtx2: any = (globalThis as any)?.window || (globalThis as any);
                  // fromBase58 already determined
                  // Build signer-based transaction, user signs it, and server relays
                  let txBase64: string;
                  if (inlineTx) {
                    txBase64 = String(inlineTx);
                  } else {
                    throw new IcpayError({
                      code: ICPAY_ERROR_CODES.API_ERROR,
                      message: 'X402 missing transactionBase64 in 402 response for Solana',
                      details: { note: 'API must include extra.transactionBase64 to avoid prepare' }
                    });
                  }
                  // Sign-only with wallet, then relay server-side (fee payer = relayer)
                  // Prefer request-based signTransaction with base58 "message" (serialized tx bytes)
                  let signedTxB64: string | null = null;
                  let signerSigBase58: string | null = null;
                  const inlineMsgB58: string | undefined = (requirement as any)?.extra?.messageBase58;
                  const msgB58 = inlineMsgB58 || undefined;
                  try {
                    debugLog(this.config?.debug || false, 'sol x402 payload sizes', {
                      txBase64Len: txBase64?.length || 0,
                      hasInlineMsgB58: !!inlineMsgB58,
                      msgB58Len: msgB58?.length || 0,
                    });
                  } catch {}
                  // Do NOT submit from wallet; only sign, then relay to backend
                  // For wallets that require request-based signing
                  const preferTransactionSigning = true;
                  // Try to sign using transaction MESSAGE first (wallets often expect base58 message)
                  if (!signedTxB64 && (sol as any)?.request) {
                    try {
                      let r: any = null;
                      // Some wallets expect bare string or array for message
                      if (msgB58) {
                        // Ensure a visible connect prompt if required by the wallet
                        if (typeof (sol as any)?.connect === 'function') {
                          try { await (sol as any).connect({ onlyIfTrusted: false }); } catch {}
                        }
                        // Prefer object form with Uint8Array message first
                        try {
                          const msgBytesU8 = (() => { try { return base58Decode(msgB58); } catch { return new Uint8Array(); } })();
                          if (msgBytesU8.length > 0) {
                            try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'signTransaction', paramShape: 'object{message:Uint8Array}', msgLen: msgBytesU8.length }); } catch {}
                            r = await (sol as any).request({ method: 'signTransaction', params: { message: msgBytesU8 } });
                          }
                        } catch {}
                        try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'signTransaction', paramShape: 'message:string(base58)', msgLen: msgB58.length }); } catch {}
                        try {
                          r = await (sol as any).request({ method: 'signTransaction', params: msgB58 as any });
                        } catch (eM1) {
                          try { debugLog(this.config?.debug || false, 'sol signTransaction(message:string) failed', { error: String(eM1) }); } catch {}
                          try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'signTransaction', paramShape: 'message:[string]', msgLen: msgB58.length }); } catch {}
                          try {
                            r = await (sol as any).request({ method: 'signTransaction', params: [msgB58] as any });
                          } catch (eM2) {
                            try { debugLog(this.config?.debug || false, 'sol signTransaction(message:array) failed', { error: String(eM2) }); } catch {}
                            try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'signTransaction', paramShape: 'message:object', msgLen: msgB58.length }); } catch {}
                            r = await (sol as any).request({ method: 'signTransaction', params: { message: msgB58 } });
                          }
                        }
                      }
                      let candidate = (r?.signedTransaction || r?.transaction || r?.signedMessage || r) as any;
                      try {
                        const rawKeys = r && typeof r === 'object' ? Object.keys(r || {}) : [];
                        debugLog(this.config?.debug || false, 'sol signTransaction(request) raw result', { hasResult: !!r, rawKeys });
                      } catch {}
                      if (typeof candidate === 'string') {
                        const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(candidate) && candidate.length % 4 === 0;
                        if (looksBase64) signedTxB64 = candidate; else signerSigBase58 = candidate;
                      } else if (candidate && (candidate.byteLength != null || ArrayBuffer.isView(candidate))) {
                        try { const b = candidate instanceof Uint8Array ? candidate : new Uint8Array(candidate as ArrayBufferLike); if (b.length === 64) signerSigBase58 = base58Encode(b); } catch {}
                      } else if (candidate && typeof candidate === 'object' && Array.isArray((candidate as any).data)) {
                        try { const b = Uint8Array.from((candidate as any).data as number[]); if (b.length === 64) signerSigBase58 = base58Encode(b); } catch {}
                      } else if (r && typeof r === 'object') {
                        const obj = r as any;
                        if (typeof obj.signature === 'string') {
                          signerSigBase58 = obj.signature;
                        } else if (Array.isArray(obj.signatures) && typeof obj.signatures[0] === 'string') {
                          signerSigBase58 = obj.signatures[0];
                        }
                      }
                    } catch {}
                  }
                  // If message-based did not yield, try transaction (prefer Uint8Array), then base64 (some wallets accept this)
                  if (!signedTxB64 && !signerSigBase58 && (sol as any)?.request) {
                    try {
                      let r: any = null;
                      // Prefer Uint8Array object form first to trigger wallet UI
                      try {
                        const txBytesU8 = u8FromBase64(txBase64);
                        try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'signTransaction', paramShape: 'object{transaction:Uint8Array}', txLen: txBytesU8.length }); } catch {}
                        r = await (sol as any).request({ method: 'signTransaction', params: { transaction: txBytesU8 } });
                      } catch {}
                      if (!r) {
                        try {
                          const txBytesU8b = u8FromBase64(txBase64);
                          try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'solana:signTransaction', paramShape: 'object{transaction:Uint8Array}', txLen: txBytesU8b.length }); } catch {}
                          r = await (sol as any).request({ method: 'solana:signTransaction', params: { transaction: txBytesU8b } });
                        } catch {}
                      }
                      // Try string param, then array, then object
                      try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'signTransaction', paramShape: 'transaction:string(base64)', txLen: txBase64.length }); } catch {}
                      try {
                        r = await (sol as any).request({ method: 'signTransaction', params: txBase64 as any });
                      } catch (eT1) {
                        try { debugLog(this.config?.debug || false, 'sol signTransaction(transaction:string) failed', { error: String(eT1) }); } catch {}
                        try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'signTransaction', paramShape: 'transaction:[string]', txLen: txBase64.length }); } catch {}
                        try {
                          r = await (sol as any).request({ method: 'signTransaction', params: [txBase64] as any });
                        } catch (eT2) {
                          try { debugLog(this.config?.debug || false, 'sol signTransaction(transaction:array) failed', { error: String(eT2) }); } catch {}
                          try { debugLog(this.config?.debug || false, 'sol signTransaction(request) params', { method: 'signTransaction', paramShape: 'transaction:object', txLen: txBase64.length }); } catch {}
                          r = await (sol as any).request({ method: 'signTransaction', params: { transaction: txBase64 } });
                        }
                      }
                      let candidate = (r?.signedTransaction || r?.transaction || r?.signedMessage || r) as any;
                      if (typeof candidate === 'string') {
                        const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(candidate) && candidate.length % 4 === 0;
                        if (looksBase64) signedTxB64 = candidate; else signerSigBase58 = candidate;
                      } else if (candidate && (candidate.byteLength != null || ArrayBuffer.isView(candidate))) {
                        try { const b = candidate instanceof Uint8Array ? candidate : new Uint8Array(candidate as ArrayBufferLike); if (b.length === 64) signerSigBase58 = base58Encode(b); } catch {}
                      } else if (candidate && typeof candidate === 'object' && Array.isArray((candidate as any).data)) {
                        try { const b = Uint8Array.from((candidate as any).data as number[]); if (b.length === 64) signerSigBase58 = base58Encode(b); } catch {}
                      }
                    } catch {}
                  }
                  // No hosted signer fallback; rely on wallet API only
                  // Prefer signMessage path only if explicitly allowed (disabled by default)
                  try {
                    const signableMsgB64: string | undefined = (requirement as any)?.extra?.signableMessageBase64;
                    if (!preferTransactionSigning && !signedTxB64 && !signerSigBase58 && signableMsgB64) {
                      const message = u8FromBase64(signableMsgB64);
                      let sigResp: any = null;
                      let signErr: any = null;
                      try { debugLog(this.config?.debug || false, 'sol signMessage attempts begin', { hasBuffer: !!(globalThis as any).Buffer, msgLen: message.length }); } catch {}
                      // A) Direct signMessage with Buffer first (some wallets require Buffer)
                      if (typeof (sol as any)?.signMessage === 'function') {
                        try {
                          const Buf = (globalThis as any).Buffer;
                          if (Buf) {
                            try { debugLog(this.config?.debug || false, 'sol signMessage(Buffer)'); } catch {}
                            sigResp = await (sol as any).signMessage(Buf.from(message));
                          }
                        } catch (eA) { signErr = eA; try { debugLog(this.config?.debug || false, 'sol signMessage(Buffer) failed', { error: String(eA) }); } catch {} }
                      }
                      // B) Direct signMessage with Uint8Array
                      if (!sigResp && typeof (sol as any)?.signMessage === 'function') {
                        try { try { debugLog(this.config?.debug || false, 'sol signMessage(Uint8Array)'); } catch {}; sigResp = await (sol as any).signMessage(message); } catch (eB) { signErr = eB; try { debugLog(this.config?.debug || false, 'sol signMessage(Uint8Array) failed', { error: String(eB) }); } catch {} }
                      }
                      // C) Direct signer.signMessage if present
                      if (!sigResp && (sol as any)?.signer && typeof (sol as any).signer.signMessage === 'function') {
                        try { try { debugLog(this.config?.debug || false, 'sol signer.signMessage(Uint8Array)'); } catch {}; sigResp = await (sol as any).signer.signMessage(message); } catch (eC) { signErr = eC; try { debugLog(this.config?.debug || false, 'sol signer.signMessage failed', { error: String(eC) }); } catch {} }
                      }
                      // D) Wallet-standard request with array-of-bytes
                      if (!sigResp && (sol as any)?.request) {
                        try { try { debugLog(this.config?.debug || false, 'sol request signMessage(array-of-bytes)'); } catch {}; const arr = Array.from(message); sigResp = await (sol as any).request({ method: 'signMessage', params: { message: arr, display: 'hex' } }); } catch (eD) { signErr = eD; try { debugLog(this.config?.debug || false, 'sol request signMessage(array-of-bytes) failed', { error: String(eD) }); } catch {} }
                      }
                      // E) Wallet-standard request with base58 message
                      if (!sigResp && (sol as any)?.request) {
                        try { try { debugLog(this.config?.debug || false, 'sol request signMessage(base58)'); } catch {}; const msgB58ForReq = base58Encode(message); sigResp = await (sol as any).request({ method: 'signMessage', params: { message: msgB58ForReq, display: 'hex' } }); } catch (eE) { signErr = eE; try { debugLog(this.config?.debug || false, 'sol request signMessage(base58) failed', { error: String(eE) }); } catch {} }
                      }
                      let messageSigB64: string | null = null;
                      if (sigResp) {
                        // Normalize common shapes: Uint8Array, Buffer-like, base58/base64 string, or { signature }
                        if (typeof sigResp === 'string') {
                          // Could be base58 or base64; try base58 first
                          try {
                            const asBytes = base58Decode(sigResp);
                            messageSigB64 = b64FromBytes(asBytes);
                          } catch {
                            // assume base64 already
                            messageSigB64 = sigResp;
                          }
                        } else if (sigResp && (sigResp.byteLength != null || ArrayBuffer.isView(sigResp))) {
                          try {
                            const bytes = sigResp instanceof Uint8Array ? sigResp : new Uint8Array(sigResp as ArrayBufferLike);
                            if (bytes && bytes.length === 64) {
                              messageSigB64 = b64FromBytes(bytes);
                            }
                          } catch {}
                        } else if (sigResp && typeof sigResp === 'object') {
                          const obj = sigResp as any;
                          if (typeof obj.signature === 'string') {
                            try {
                              const asBytes = base58Decode(obj.signature);
                              messageSigB64 = b64FromBytes(asBytes);
                            } catch {
                              messageSigB64 = obj.signature;
                            }
                          } else if (Array.isArray(obj.data)) {
                            try {
                              const bytes = Uint8Array.from(obj.data as number[]);
                              if (bytes && bytes.length === 64) {
                                messageSigB64 = b64FromBytes(bytes);
                              }
                            } catch {}
                          }
                        }
                        try {
                          debugLog(this.config?.debug || false, 'sol signMessage result normalized (message signature)', {
                            hasSignature: !!messageSigB64,
                            signatureLen: messageSigB64 ? messageSigB64.length : null,
                          });
                        } catch {}
                      } else if (signErr) {
                        try { debugLog(this.config?.debug || false, 'sol signMessage failed (all attempts)', { error: String(signErr) }); } catch {}
                      }
                      // If we obtained a message signature, construct x402 header and settle via API
                      if (messageSigB64) {
                        const fields = ((requirement as any)?.extra?.signableFields || {}) as any;
                        const header = buildX402HeaderFromAuthorization({
                          x402Version: Number((requirement as any)?.x402Version || (data?.x402Version || 2)),
                          scheme: String((requirement as any)?.scheme || 'exact'),
                          network: String((requirement as any)?.network || ''),
                          from: String(fromBase58 || ''),
                          to: String((requirement as any)?.payTo || ''),
                          value: String((requirement as any)?.maxAmountRequired || '0'),
                          validAfter: String(fields?.validAfter || '0'),
                          validBefore: String(fields?.validBefore || '0'),
                          nonce: String(fields?.nonceHex || ''),
                          signature: String(messageSigB64),
                        });
                        const headerJson = JSON.stringify(header);
                        let headerB64: string;
                        try {
                          const Buf = (globalThis as any).Buffer;
                          headerB64 = Buf ? Buf.from(headerJson, 'utf8').toString('base64') : (globalThis as any)?.btoa?.(headerJson) || '';
                        } catch { headerB64 = ''; }
                        if (headerB64) {
                          try { this.emitMethodStart('notifyLedgerTransaction', { paymentIntentId }); } catch {}
                          const settleRespSol: any = await this.publicApiClient.post('/sdk/public/payments/x402/settle', {
                            paymentIntentId,
                            paymentHeader: headerB64,
                            paymentRequirements: requirement,
                          });
                          try {
                            debugLog(this.config?.debug || false, 'x402 (sol) settle via header response', {
                              ok: (settleRespSol as any)?.ok,
                              status: (settleRespSol as any)?.status,
                              paymentIntentId: (settleRespSol as any)?.paymentIntent?.id,
                              paymentId: (settleRespSol as any)?.payment?.id,
                              rawKeys: Object.keys(settleRespSol || {}),
                            });
                          } catch {}
                          const statusSolHdr = (settleRespSol?.status || settleRespSol?.paymentIntent?.status || 'completed').toString().toLowerCase();
                          const amountSolHdr =
                            (settleRespSol?.paymentIntent?.amount && String(settleRespSol.paymentIntent.amount)) ||
                            (typeof usdAmount === 'number' ? String(usdAmount) : (request as any)?.amount?.toString?.() || '0');
                          const outSolHdr = {
                            transactionId: Number(settleRespSol?.canisterTxId || 0),
                            status: statusSolHdr === 'succeeded' ? 'completed' : statusSolHdr,
                            amount: amountSolHdr,
                            recipientCanister: ledgerCanisterId,
                            timestamp: new Date(),
                            metadata: { ...(request.metadata || {}), icpay_x402: true },
                            payment: settleRespSol || null,
                          } as any;
                          const isTerminalSolHdr = (() => {
                            const s = String(outSolHdr.status || '').toLowerCase();
                            return s === 'completed' || s === 'succeeded' || s === 'failed' || s === 'canceled' || s === 'cancelled' || s === 'mismatched';
                          })();
                          if (isTerminalSolHdr) {
                            if (outSolHdr.status === 'completed') {
                              this.emit('icpay-sdk-transaction-completed', outSolHdr);
                            } else if (outSolHdr.status === 'failed') {
                              this.emit('icpay-sdk-transaction-failed', outSolHdr);
                            } else {
                              this.emit('icpay-sdk-transaction-updated', outSolHdr);
                            }
                            this.emitMethodSuccess('createPaymentX402Usd', outSolHdr);
                            return outSolHdr;
                          }
                          // Non-terminal: wait until terminal via notify loop
                          try { this.emit('icpay-sdk-transaction-updated', outSolHdr); } catch {}
                          const waitedSolHdr = await this.awaitIntentTerminal({
                            paymentIntentId,
                            ledgerCanisterId: ledgerCanisterId,
                            amount: amountSolHdr,
                            metadata: { ...(request.metadata || {}), icpay_x402: true },
                          });
                          this.emitMethodSuccess('createPaymentX402Usd', waitedSolHdr);
                          return waitedSolHdr;
                        }
                      }
                    }
                  } catch {}
                  if (!signedTxB64 && !signerSigBase58) {
                    throw new IcpayError({ code: ICPAY_ERROR_CODES.TRANSACTION_FAILED, message: 'Wallet did not return a signed transaction' });
                  }
                  let settleResp: any;
                  if (signedTxB64 && typeof signedTxB64 === 'string') {
                    settleResp = await this.publicApiClient.post('/sdk/public/payments/x402/relay', {
                      paymentIntentId,
                      signedTransactionBase64: signedTxB64,
                      rpcUrlPublic: (requirement as any)?.extra?.rpcUrlPublic || null,
                    });
                  } else if (signerSigBase58) {
                    // Relay signature + unsigned tx; server will attach and co-sign
                    settleResp = await this.publicApiClient.post('/sdk/public/payments/x402/relay', {
                      paymentIntentId,
                      signatureBase58: signerSigBase58,
                      transactionBase64: txBase64,
                      payerPublicKey: fromBase58,
                      rpcUrlPublic: (requirement as any)?.extra?.rpcUrlPublic || null,
                    });
                  } else {
                    throw new IcpayError({ code: ICPAY_ERROR_CODES.TRANSACTION_FAILED, message: 'Wallet did not return a signed transaction' });
                  }
                  try {
                    debugLog(this.config?.debug || false, 'x402 (sol) settle response (relay via services)', {
                      ok: (settleResp as any)?.ok,
                      status: (settleResp as any)?.status,
                      paymentIntentId: (settleResp as any)?.paymentIntent?.id,
                      paymentId: (settleResp as any)?.payment?.id,
                      rawKeys: Object.keys(settleResp || {}),
                    });
                  } catch {}
                  // Move to "Payment confirmation" stage (after relayer submission)
                  try { this.emitMethodSuccess('notifyLedgerTransaction', { paymentIntentId }); } catch {}
                  const statusSol = (settleResp?.status || settleResp?.paymentIntent?.status || 'completed').toString().toLowerCase();
                  const amountSol =
                    (settleResp?.paymentIntent?.amount && String(settleResp.paymentIntent.amount)) ||
                    (typeof usdAmount === 'number' ? String(usdAmount) : (request as any)?.amount?.toString?.() || '0');
                  const outSol = {
                    transactionId: Number(settleResp?.canisterTxId || 0),
                    status: statusSol === 'succeeded' ? 'completed' : statusSol,
                    amount: amountSol,
                    recipientCanister: ledgerCanisterId,
                    timestamp: new Date(),
                    metadata: { ...(request.metadata || {}), icpay_x402: true },
                    payment: settleResp || null,
                  } as any;
                  // Do not fallback to normal flow for Solana x402; surface failure
                  const isTerminalSol = (() => {
                    const s = String(outSol.status || '').toLowerCase();
                    return s === 'completed' || s === 'succeeded' || s === 'failed' || s === 'canceled' || s === 'cancelled' || s === 'mismatched';
                  })();
                  if (isTerminalSol) {
                    if (outSol.status === 'completed') {
                      this.emit('icpay-sdk-transaction-completed', outSol);
                    } else if (outSol.status === 'failed') {
                      this.emit('icpay-sdk-transaction-failed', outSol);
                    } else {
                      this.emit('icpay-sdk-transaction-updated', outSol);
                    }
                    this.emitMethodSuccess('createPaymentX402Usd', outSol);
                    return outSol;
                  }
                  // Non-terminal: wait until terminal via notify loop
                  try { this.emit('icpay-sdk-transaction-updated', outSol); } catch {}
                  const waitedSol = await this.awaitIntentTerminal({
                    paymentIntentId,
                    ledgerCanisterId: ledgerCanisterId,
                    amount: amountSol,
                    metadata: { ...(request.metadata || {}), icpay_x402: true },
                  });
                  this.emitMethodSuccess('createPaymentX402Usd', waitedSol);
                  return waitedSol;
                }
                // EVM: server-side settlement
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
              } catch (err) {
                // For Solana x402, do not silently fall back; surface the error so user can retry/sign
                if (isSol) {
                  throw (err instanceof IcpayError) ? err : new IcpayError({ code: ICPAY_ERROR_CODES.TRANSACTION_FAILED, message: 'X402 Solana flow failed before signing', details: err });
                }
                // Non-Solana: fall through to notify-based wait if settle endpoint not available
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
  private async performNotifyPaymentIntent(params: { paymentIntentId: string; canisterTransactionId?: string; transactionId?: string; maxAttempts?: number; delayMs?: number; orderId?: string; ledgerCanisterId?: string; ledgerBlockIndex?: string | number; accountCanisterId?: number; externalCostAmount?: string | number; recipientPrincipal?: string }): Promise<any> {
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
        if (params.ledgerCanisterId) body.ledgerCanisterId = params.ledgerCanisterId;
        if (params.ledgerBlockIndex != null) body.ledgerBlockIndex = params.ledgerBlockIndex;
        if (typeof params.accountCanisterId === 'number') body.accountCanisterId = params.accountCanisterId;
        if (params.externalCostAmount != null) body.externalCostAmount = params.externalCostAmount;
        if (typeof params.recipientPrincipal === 'string') body.recipientPrincipal = params.recipientPrincipal;
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
  private async awaitIntentTerminal(params: { paymentIntentId: string; canisterTransactionId?: string; transactionId?: string; ledgerCanisterId: string; ledgerBlockIndex?: string | number; amount: string; metadata?: any; accountCanisterId?: number; externalCostAmount?: string | number; recipientPrincipal?: string }): Promise<any> {
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
          ledgerCanisterId: params.ledgerCanisterId,
          ledgerBlockIndex: params.ledgerBlockIndex,
          accountCanisterId: params.accountCanisterId,
          externalCostAmount: params.externalCostAmount,
          recipientPrincipal: params.recipientPrincipal,
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