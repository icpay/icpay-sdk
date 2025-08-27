import type { AxiosInstance } from 'axios';
import { IcpayError } from './errors';
import type {
  SdkPaymentAggregate,
  SdkPaymentIntent,
  SdkInvoice,
  SdkTransaction,
  SdkWallet,
  SdkLedger,
  SdkWebhookEvent,
  AccountInfo,
  TransactionStatus,
  PaymentHistoryRequest,
  PaymentHistoryResponse,
  GetPaymentsByPrincipalRequest,
  AllLedgerBalances,
  LedgerBalance,
} from './types';

type EmitFn = (name: string, payload?: any) => void;

export class IcpayProtected {
  private publicApiClient: AxiosInstance;
  private privateApiClient: AxiosInstance | null;
  private emitStart: EmitFn;
  private emitSuccess: EmitFn;
  private emitError: EmitFn;

  constructor(params: {
    publicApiClient: AxiosInstance;
    privateApiClient: AxiosInstance | null;
    emitStart: EmitFn;
    emitSuccess: EmitFn;
    emitError: EmitFn;
  }) {
    this.publicApiClient = params.publicApiClient;
    this.privateApiClient = params.privateApiClient;
    this.emitStart = params.emitStart;
    this.emitSuccess = params.emitSuccess;
    this.emitError = params.emitError;
  }

  private requireSecretKey(methodName: string): void {
    if (!this.privateApiClient) {
      throw new IcpayError({
        code: 'SECRET_KEY_REQUIRED',
        message: `${methodName} requires secret key authentication. Please provide secretKey in configuration.`,
      });
    }
  }

  async getPaymentById(id: string): Promise<SdkPaymentAggregate> {
    this.requireSecretKey('getPaymentById');
    this.emitStart('getPaymentById', { id });
    try {
      const res = await this.privateApiClient!.get(`/sdk/payments/${id}`);
      this.emitSuccess('getPaymentById', { id });
      return res.data as SdkPaymentAggregate;
    } catch (error) {
      this.emitError('getPaymentById', error);
      throw error;
    }
  }

  async listPayments(): Promise<SdkPaymentAggregate[]> {
    this.requireSecretKey('listPayments');
    this.emitStart('listPayments');
    try {
      const res = await this.privateApiClient!.get('/sdk/payments');
      this.emitSuccess('listPayments', { count: Array.isArray(res.data) ? res.data.length : undefined });
      return res.data as SdkPaymentAggregate[];
    } catch (error) {
      this.emitError('listPayments', error);
      throw error;
    }
  }

  async getPaymentIntentById(id: string): Promise<SdkPaymentIntent> {
    this.requireSecretKey('getPaymentIntentById');
    this.emitStart('getPaymentIntentById', { id });
    try {
      const res = await this.privateApiClient!.get(`/sdk/payment-intents/${id}`);
      this.emitSuccess('getPaymentIntentById', { id });
      return res.data as SdkPaymentIntent;
    } catch (error) {
      this.emitError('getPaymentIntentById', error);
      throw error;
    }
  }

  async getInvoiceById(id: string): Promise<SdkInvoice> {
    this.requireSecretKey('getInvoiceById');
    this.emitStart('getInvoiceById', { id });
    try {
      const res = await this.privateApiClient!.get(`/sdk/invoices/${id}`);
      this.emitSuccess('getInvoiceById', { id });
      return res.data as SdkInvoice;
    } catch (error) {
      this.emitError('getInvoiceById', error);
      throw error;
    }
  }

  async getTransactionById(id: string): Promise<SdkTransaction> {
    this.requireSecretKey('getTransactionById');
    this.emitStart('getTransactionById', { id });
    try {
      const res = await this.privateApiClient!.get(`/sdk/transactions/${id}`);
      this.emitSuccess('getTransactionById', { id });
      return res.data as SdkTransaction;
    } catch (error) {
      this.emitError('getTransactionById', error);
      throw error;
    }
  }

  async getWalletById(id: string): Promise<SdkWallet> {
    this.requireSecretKey('getWalletById');
    this.emitStart('getWalletById', { id });
    try {
      const res = await this.privateApiClient!.get(`/sdk/wallets/${id}`);
      this.emitSuccess('getWalletById', { id });
      return res.data as SdkWallet;
    } catch (error) {
      this.emitError('getWalletById', error);
      throw error;
    }
  }

  async getVerifiedLedgersPrivate(): Promise<SdkLedger[]> {
    this.requireSecretKey('getVerifiedLedgersPrivate');
    this.emitStart('getVerifiedLedgersPrivate');
    try {
      const res = await this.privateApiClient!.get('/sdk/ledgers/verified');
      this.emitSuccess('getVerifiedLedgersPrivate', { count: Array.isArray(res.data) ? res.data.length : undefined });
      return res.data as SdkLedger[];
    } catch (error) {
      this.emitError('getVerifiedLedgersPrivate', error);
      throw error;
    }
  }

  async getAllLedgersWithPricesPrivate(): Promise<SdkLedger[]> {
    this.requireSecretKey('getAllLedgersWithPricesPrivate');
    this.emitStart('getAllLedgersWithPricesPrivate');
    try {
      const res = await this.privateApiClient!.get('/sdk/ledgers/all-with-prices');
      this.emitSuccess('getAllLedgersWithPricesPrivate', { count: Array.isArray(res.data) ? res.data.length : undefined });
      return res.data as SdkLedger[];
    } catch (error) {
      this.emitError('getAllLedgersWithPricesPrivate', error);
      throw error;
    }
  }

  async getLedgerInfoPrivate(idOrCanisterId: string): Promise<SdkLedger> {
    this.requireSecretKey('getLedgerInfoPrivate');
    this.emitStart('getLedgerInfoPrivate', { idOrCanisterId });
    try {
      const res = await this.privateApiClient!.get(`/sdk/ledgers/${idOrCanisterId}`);
      this.emitSuccess('getLedgerInfoPrivate', { idOrCanisterId });
      return res.data as SdkLedger;
    } catch (error) {
      this.emitError('getLedgerInfoPrivate', error);
      throw error;
    }
  }

  async getWebhookEventById(id: string): Promise<SdkWebhookEvent> {
    this.requireSecretKey('getWebhookEventById');
    this.emitStart('getWebhookEventById', { id });
    try {
      const res = await this.privateApiClient!.get(`/sdk/webhook-events/${id}`);
      this.emitSuccess('getWebhookEventById', { id });
      return res.data as SdkWebhookEvent;
    } catch (error) {
      this.emitError('getWebhookEventById', error);
      throw error;
    }
  }

  // ===== Moved secret methods from Icpay =====

  async getDetailedAccountInfo(): Promise<AccountInfo> {
    this.requireSecretKey('getDetailedAccountInfo');
    this.emitStart('getDetailedAccountInfo');
    try {
      const response = await this.privateApiClient!.get('/sdk/account');
      const account = response.data;
      const result: AccountInfo = {
        id: account.id,
        name: account.name,
        email: account.email,
        isActive: account.isActive,
        isLive: account.isLive,
        accountCanisterId: account.accountCanisterId,
        walletAddress: account.walletAddress,
        createdAt: new Date(account.createdAt),
        updatedAt: new Date(account.updatedAt),
      } as any;
      this.emitSuccess('getDetailedAccountInfo', result);
      return result;
    } catch (error) {
      const err = new IcpayError({
        code: 'ACCOUNT_INFO_FETCH_FAILED',
        message: 'Failed to fetch detailed account information',
        details: error,
      });
      this.emitError('getDetailedAccountInfo', err);
      throw err;
    }
  }

  async getTransactionStatus(canisterTransactionId: number): Promise<TransactionStatus> {
    this.requireSecretKey('getTransactionStatus');
    this.emitStart('getTransactionStatus', { canisterTransactionId });
    try {
      const response = await this.privateApiClient!.get(`/sdk/transactions/${canisterTransactionId}/status`);
      const result = response.data;
      this.emitSuccess('getTransactionStatus', result);
      return result;
    } catch (error) {
      const err = new IcpayError({
        code: 'TRANSACTION_STATUS_FETCH_FAILED',
        message: 'Failed to fetch transaction status',
        details: error,
      });
      this.emitError('getTransactionStatus', err);
      throw err;
    }
  }

  async getPaymentHistory(request: PaymentHistoryRequest = {}): Promise<PaymentHistoryResponse> {
    this.requireSecretKey('getPaymentHistory');
    this.emitStart('getPaymentHistory', { request });
    try {
      const params = new URLSearchParams();
      if (request.accountId) params.append('accountId', request.accountId);
      if (request.ledgerCanisterId) params.append('ledgerCanisterId', request.ledgerCanisterId);
      if (request.fromTimestamp) params.append('fromTimestamp', request.fromTimestamp.toISOString());
      if (request.toTimestamp) params.append('toTimestamp', request.toTimestamp.toISOString());
      if (request.status) params.append('status', request.status);
      if (request.limit) params.append('limit', request.limit.toString());
      if (request.offset) params.append('offset', request.offset.toString());

      const response = await this.privateApiClient!.get(`/sdk/payments/history?${params.toString()}`);
      const result: PaymentHistoryResponse = {
        payments: response.data.payments.map((tx: any) => ({
          id: tx.id,
          status: tx.status,
          amount: tx.amount,
          ledgerCanisterId: tx.ledgerCanisterId,
          ledgerSymbol: tx.ledgerSymbol,
          fromAddress: tx.fromAddress,
          toAddress: tx.toAddress,
          fee: tx.fee,
          decimals: tx.decimals,
          tokenPrice: tx.tokenPrice,
          expectedSenderPrincipal: tx.expectedSenderPrincipal,
          metadata: tx.metadata,
          createdAt: new Date(tx.createdAt),
          updatedAt: new Date(tx.updatedAt),
        })),
        total: response.data.total,
        limit: response.data.limit,
        offset: response.data.offset,
        hasMore: response.data.hasMore,
      } as any;
      this.emitSuccess('getPaymentHistory', { total: result.total });
      return result;
    } catch (error) {
      const err = new IcpayError({
        code: 'PAYMENT_HISTORY_FETCH_FAILED',
        message: 'Failed to fetch payment history',
        details: error,
      });
      this.emitError('getPaymentHistory', err);
      throw err;
    }
  }

  async getPaymentsByPrincipal(request: GetPaymentsByPrincipalRequest): Promise<PaymentHistoryResponse> {
    this.requireSecretKey('getPaymentsByPrincipal');
    this.emitStart('getPaymentsByPrincipal', { request });
    try {
      const params = new URLSearchParams();
      if (request.limit) params.append('limit', request.limit.toString());
      if (request.offset) params.append('offset', request.offset.toString());
      if (request.status) params.append('status', request.status);

      const response = await this.privateApiClient!.get(`/sdk/payments/by-principal/${request.principalId}?${params.toString()}`);
      const result: PaymentHistoryResponse = {
        payments: response.data.payments.map((tx: any) => ({
          id: tx.id,
          status: tx.status,
          amount: tx.amount,
          ledgerCanisterId: tx.ledgerCanisterId,
          ledgerSymbol: tx.ledgerSymbol,
          fromAddress: tx.fromAddress,
          toAddress: tx.toAddress,
          fee: tx.fee,
          decimals: tx.decimals,
          tokenPrice: tx.tokenPrice,
          expectedSenderPrincipal: tx.expectedSenderPrincipal,
          metadata: tx.metadata,
          createdAt: new Date(tx.createdAt),
          updatedAt: new Date(tx.updatedAt),
        })),
        total: response.data.total,
        limit: response.data.limit,
        offset: response.data.offset,
        hasMore: response.data.hasMore,
      } as any;
      this.emitSuccess('getPaymentsByPrincipal', { total: result.total });
      return result;
    } catch (error) {
      const err = new IcpayError({
        code: 'PAYMENTS_BY_PRINCIPAL_FETCH_FAILED',
        message: 'Failed to fetch payments by principal',
        details: error,
      });
      this.emitError('getPaymentsByPrincipal', err);
      throw err;
    }
  }

  async getAccountWalletBalances(): Promise<AllLedgerBalances> {
    this.requireSecretKey('getAccountWalletBalances');
    this.emitStart('getAccountWalletBalances');
    try {
      const response = await this.privateApiClient!.get('/sdk/account/wallet-balances');
      const result: AllLedgerBalances = {
        balances: response.data.balances.map((balance: any) => ({
          ledgerId: balance.ledgerId,
          ledgerName: balance.ledgerName,
          ledgerSymbol: balance.ledgerSymbol,
          canisterId: balance.canisterId,
          balance: balance.balance,
          formattedBalance: balance.formattedBalance,
          decimals: balance.decimals,
          currentPrice: balance.currentPrice,
          lastPriceUpdate: balance.lastPriceUpdate ? new Date(balance.lastPriceUpdate) : undefined,
          lastUpdated: new Date(balance.lastUpdated),
        } as LedgerBalance)),
        totalBalancesUSD: response.data.totalBalancesUSD,
        lastUpdated: new Date(response.data.lastUpdated),
      };
      this.emitSuccess('getAccountWalletBalances', { count: result.balances.length, totalUSD: result.totalBalancesUSD });
      return result;
    } catch (error) {
      const err = new IcpayError({
        code: 'ACCOUNT_WALLET_BALANCES_FETCH_FAILED',
        message: 'Failed to fetch account wallet balances',
        details: error,
      });
      this.emitError('getAccountWalletBalances', err);
      throw err;
    }
  }
}


