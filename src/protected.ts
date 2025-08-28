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
export type ProtectedApi = {
  getPaymentById(id: string): Promise<SdkPaymentAggregate>;
  listPayments(): Promise<SdkPaymentAggregate[]>;
  getPaymentIntentById(id: string): Promise<SdkPaymentIntent>;
  getInvoiceById(id: string): Promise<SdkInvoice>;
  getTransactionById(id: string): Promise<SdkTransaction>;
  getWalletById(id: string): Promise<SdkWallet>;
  getVerifiedLedgersPrivate(): Promise<SdkLedger[]>;
  getAllLedgersWithPricesPrivate(): Promise<SdkLedger[]>;
  getLedgerInfoPrivate(idOrCanisterId: string): Promise<SdkLedger>;
  getWebhookEventById(id: string): Promise<SdkWebhookEvent>;
  getDetailedAccountInfo(): Promise<AccountInfo>;
  getTransactionStatus(canisterTransactionId: number): Promise<TransactionStatus>;
  getPaymentHistory(request?: PaymentHistoryRequest): Promise<PaymentHistoryResponse>;
  getPaymentsByPrincipal(request: GetPaymentsByPrincipalRequest): Promise<PaymentHistoryResponse>;
  getAccountWalletBalances(): Promise<AllLedgerBalances>;
};

export function createProtectedApi(params: {
  privateApiClient: AxiosInstance | null;
  emitStart: EmitFn;
  emitSuccess: EmitFn;
  emitError: EmitFn;
}): ProtectedApi {
  const privateApiClient = params.privateApiClient;
  const emitStart = params.emitStart;
  const emitSuccess = params.emitSuccess;
  const emitError = params.emitError;

  const requireSecretKey = (methodName: string) => {
    if (!privateApiClient) {
      throw new IcpayError({
        code: 'SECRET_KEY_REQUIRED',
        message: `${methodName} requires secret key authentication. Please provide secretKey in configuration.`,
      });
    }
  };

  return {
    async getPaymentById(id: string): Promise<SdkPaymentAggregate> {
      requireSecretKey('getPaymentById');
      emitStart('getPaymentById', { id });
      try {
        const res = await privateApiClient!.get(`/sdk/payments/${id}`);
        emitSuccess('getPaymentById', { id });
        return res.data as SdkPaymentAggregate;
      } catch (error) {
        emitError('getPaymentById', error);
        throw error;
      }
    },

    async listPayments(): Promise<SdkPaymentAggregate[]> {
      requireSecretKey('listPayments');
      emitStart('listPayments');
      try {
        const res = await privateApiClient!.get('/sdk/payments');
        emitSuccess('listPayments', { count: Array.isArray(res.data) ? res.data.length : undefined });
        return res.data as SdkPaymentAggregate[];
      } catch (error) {
        emitError('listPayments', error);
        throw error;
      }
    },

    async getPaymentIntentById(id: string): Promise<SdkPaymentIntent> {
      requireSecretKey('getPaymentIntentById');
      emitStart('getPaymentIntentById', { id });
      try {
        const res = await privateApiClient!.get(`/sdk/payment-intents/${id}`);
        emitSuccess('getPaymentIntentById', { id });
        return res.data as SdkPaymentIntent;
      } catch (error) {
        emitError('getPaymentIntentById', error);
        throw error;
      }
    },

    async getInvoiceById(id: string): Promise<SdkInvoice> {
      requireSecretKey('getInvoiceById');
      emitStart('getInvoiceById', { id });
      try {
        const res = await privateApiClient!.get(`/sdk/invoices/${id}`);
        emitSuccess('getInvoiceById', { id });
        return res.data as SdkInvoice;
      } catch (error) {
        emitError('getInvoiceById', error);
        throw error;
      }
    },

    async getTransactionById(id: string): Promise<SdkTransaction> {
      requireSecretKey('getTransactionById');
      emitStart('getTransactionById', { id });
      try {
        const res = await privateApiClient!.get(`/sdk/transactions/${id}`);
        emitSuccess('getTransactionById', { id });
        return res.data as SdkTransaction;
      } catch (error) {
        emitError('getTransactionById', error);
        throw error;
      }
    },

    async getWalletById(id: string): Promise<SdkWallet> {
      requireSecretKey('getWalletById');
      emitStart('getWalletById', { id });
      try {
        const res = await privateApiClient!.get(`/sdk/wallets/${id}`);
        emitSuccess('getWalletById', { id });
        return res.data as SdkWallet;
      } catch (error) {
        emitError('getWalletById', error);
        throw error;
      }
    },

    async getVerifiedLedgersPrivate(): Promise<SdkLedger[]> {
      requireSecretKey('getVerifiedLedgersPrivate');
      emitStart('getVerifiedLedgersPrivate');
      try {
        const res = await privateApiClient!.get('/sdk/ledgers/verified');
        emitSuccess('getVerifiedLedgersPrivate', { count: Array.isArray(res.data) ? res.data.length : undefined });
        return res.data as SdkLedger[];
      } catch (error) {
        emitError('getVerifiedLedgersPrivate', error);
        throw error;
      }
    },

    async getAllLedgersWithPricesPrivate(): Promise<SdkLedger[]> {
      requireSecretKey('getAllLedgersWithPricesPrivate');
      emitStart('getAllLedgersWithPricesPrivate');
      try {
        const res = await privateApiClient!.get('/sdk/ledgers/all-with-prices');
        emitSuccess('getAllLedgersWithPricesPrivate', { count: Array.isArray(res.data) ? res.data.length : undefined });
        return res.data as SdkLedger[];
      } catch (error) {
        emitError('getAllLedgersWithPricesPrivate', error);
        throw error;
      }
    },

    async getLedgerInfoPrivate(idOrCanisterId: string): Promise<SdkLedger> {
      requireSecretKey('getLedgerInfoPrivate');
      emitStart('getLedgerInfoPrivate', { idOrCanisterId });
      try {
        const res = await privateApiClient!.get(`/sdk/ledgers/${idOrCanisterId}`);
        emitSuccess('getLedgerInfoPrivate', { idOrCanisterId });
        return res.data as SdkLedger;
      } catch (error) {
        emitError('getLedgerInfoPrivate', error);
        throw error;
      }
    },

    async getWebhookEventById(id: string): Promise<SdkWebhookEvent> {
      requireSecretKey('getWebhookEventById');
      emitStart('getWebhookEventById', { id });
      try {
        const res = await privateApiClient!.get(`/sdk/webhook-events/${id}`);
        emitSuccess('getWebhookEventById', { id });
        return res.data as SdkWebhookEvent;
      } catch (error) {
        emitError('getWebhookEventById', error);
        throw error;
      }
    },

    async getDetailedAccountInfo(): Promise<AccountInfo> {
      requireSecretKey('getDetailedAccountInfo');
      emitStart('getDetailedAccountInfo');
      try {
        const response = await privateApiClient!.get('/sdk/account');
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
        emitSuccess('getDetailedAccountInfo', result);
        return result;
      } catch (error) {
        const err = new IcpayError({
          code: 'ACCOUNT_INFO_FETCH_FAILED',
          message: 'Failed to fetch detailed account information',
          details: error,
        });
        emitError('getDetailedAccountInfo', err);
        throw err;
      }
    },

    async getTransactionStatus(canisterTransactionId: number): Promise<TransactionStatus> {
      requireSecretKey('getTransactionStatus');
      emitStart('getTransactionStatus', { canisterTransactionId });
      try {
        const response = await privateApiClient!.get(`/sdk/transactions/${canisterTransactionId}/status`);
        const result = response.data;
        emitSuccess('getTransactionStatus', result);
        return result;
      } catch (error) {
        const err = new IcpayError({
          code: 'TRANSACTION_STATUS_FETCH_FAILED',
          message: 'Failed to fetch transaction status',
          details: error,
        });
        emitError('getTransactionStatus', err);
        throw err;
      }
    },

    async getPaymentHistory(request: PaymentHistoryRequest = {}): Promise<PaymentHistoryResponse> {
      requireSecretKey('getPaymentHistory');
      emitStart('getPaymentHistory', { request });
      try {
        const params = new URLSearchParams();
        if (request.accountId) params.append('accountId', request.accountId);
        if (request.ledgerCanisterId) params.append('ledgerCanisterId', request.ledgerCanisterId);
        if (request.fromTimestamp) params.append('fromTimestamp', request.fromTimestamp.toISOString());
        if (request.toTimestamp) params.append('toTimestamp', request.toTimestamp.toISOString());
        if (request.status) params.append('status', request.status);
        if (request.limit) params.append('limit', request.limit.toString());
        if (request.offset) params.append('offset', request.offset.toString());

        const response = await privateApiClient!.get(`/sdk/payments/history?${params.toString()}`);
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
        emitSuccess('getPaymentHistory', { total: result.total });
        return result;
      } catch (error) {
        const err = new IcpayError({
          code: 'PAYMENT_HISTORY_FETCH_FAILED',
          message: 'Failed to fetch payment history',
          details: error,
        });
        emitError('getPaymentHistory', err);
        throw err;
      }
    },

    async getPaymentsByPrincipal(request: GetPaymentsByPrincipalRequest): Promise<PaymentHistoryResponse> {
      requireSecretKey('getPaymentsByPrincipal');
      emitStart('getPaymentsByPrincipal', { request });
      try {
        const params = new URLSearchParams();
        if (request.limit) params.append('limit', request.limit.toString());
        if (request.offset) params.append('offset', request.offset.toString());
        if (request.status) params.append('status', request.status);

        const response = await privateApiClient!.get(`/sdk/payments/by-principal/${request.principalId}?${params.toString()}`);
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
        emitSuccess('getPaymentsByPrincipal', { total: result.total });
        return result;
      } catch (error) {
        const err = new IcpayError({
          code: 'PAYMENTS_BY_PRINCIPAL_FETCH_FAILED',
          message: 'Failed to fetch payments by principal',
          details: error,
        });
        emitError('getPaymentsByPrincipal', err);
        throw err;
      }
    },

    async getAccountWalletBalances(): Promise<AllLedgerBalances> {
      requireSecretKey('getAccountWalletBalances');
      emitStart('getAccountWalletBalances');
      try {
        const response = await privateApiClient!.get('/sdk/account/wallet-balances');
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
        emitSuccess('getAccountWalletBalances', { count: result.balances.length, totalUSD: result.totalBalancesUSD });
        return result;
      } catch (error) {
        const err = new IcpayError({
          code: 'ACCOUNT_WALLET_BALANCES_FETCH_FAILED',
          message: 'Failed to fetch account wallet balances',
          details: error,
        });
        emitError('getAccountWalletBalances', err);
        throw err;
      }
    },
  };
}

