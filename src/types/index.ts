import type { ActorSubclass } from '@dfinity/agent';

export interface IcpayConfig {
  // For public operations (frontend-safe)
  publishableKey?: string;

  // For private operations (server-side only)
  secretKey?: string;

  environment?: 'development' | 'production';
  apiUrl?: string;
  connectedWallet?: ConnectedWallet;
  icHost?: string; // IC network host for agent-js
  /**
   * Optional: Provide a function to create an actor for any canister
   * (canisterId: string, idl: any) => ActorSubclass<any>
   */
  actorProvider?: (canisterId: string, idl: any) => ActorSubclass<any>;

  /**
   * Optional: Enable debug logging
   * When set to true, all console.log messages will be output
   */
  debug?: boolean;

  /**
   * Enable or disable SDK events emission. Defaults to true (enabled).
   */
  enableEvents?: boolean;

  /**
   * If true, wait for server notification result in sendFunds.
   * Defaults to false (do not await; fire-and-forget notify).
   */
  awaitServerNotification?: boolean;

  /** If true, SDK will initiate Onramp flow instead of direct transfer */
  onrampPayment?: boolean;
}

export interface ConnectedWallet {
  /**
   * The principal/owner of the wallet (string format)
   * Required for balance checking and transaction operations
   */
  owner?: string;

  /**
   * The principal of the wallet (Principal object format)
   * Alternative to owner property
   */
  principal?: any; // Principal type from @dfinity/principal

  /**
   * Whether the wallet is currently connected
   * Used to determine connection status
   */
  connected?: boolean;

  /**
   * Optional method to get the principal
   * Alternative to owner/principal properties
   */
  getPrincipal?: () => string | any;
}

export interface VerifiedLedger {
  id: string;
  name: string;
  symbol: string;
  canisterId: string;
  decimals: number;
  logoUrl: string | null;
  verified: boolean;
  fee: string | null;
  // Price-related fields
  currentPrice?: number | null;
  lastPriceUpdate?: string | null;
}

export interface WalletProvider {
  id: string;
  name: string;
  icon: string;
  description: string;
}

export interface Transaction {
  id: string;
  accountId?: string;
  transactionType: 'payment' | 'refund' | 'transfer' | 'withdrawal';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  amount: string;
  currency: string;
  ledgerCanisterId?: string;
  fromAddress?: string;
  toAddress: string;
  blockHeight?: string;
  fee?: string;
  metadata?: any;
  errorMessage?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTransactionRequest {
  amount: string;
  ledgerCanisterId: string;
  accountCanisterId?: string;
  metadata?: Record<string, any>;
  onrampPayment?: boolean;
  widgetParams?: Record<string, any>;
  amountUsd?: number | string;
}

export interface TransactionResponse {
  transactionId: number;
  status: 'pending' | 'completed' | 'failed';
  amount: string;
  recipientCanister: string;
  timestamp: Date;
  description?: string;
  metadata?: Record<string, any>;
  payment?: PublicNotifyResponse;
}

export interface TransactionStatus {
  transactionId: number;
  status: 'pending' | 'completed' | 'failed';
  blockHeight?: number;
  timestamp: Date;
  error?: string;
}

export interface AccountInfo {
  id: string;
  name: string | null;
  email: string | null;
  isActive: boolean;
  isLive: boolean;
  accountCanisterId: number;
  walletAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicAccountInfo {
  id: string;
  name: string | null;
  isActive: boolean;
  isLive: boolean;
  accountCanisterId: number;
  icpayCanisterId?: string;
  branding?: AccountBranding | null;
}

export interface IcpayError {
  code: string;
  message: string;
  details?: any;
}

export interface WalletConnectionResult {
  provider: string;
  principal: string;
  accountId: string;
  connected: boolean;
}

// New types for enhanced SDK functionality

export interface LedgerBalance {
  ledgerId: string;
  ledgerName: string;
  ledgerSymbol: string;
  canisterId: string;
  balance: string; // Raw balance in smallest unit
  formattedBalance: string; // Human readable balance
  decimals: number;
  currentPrice?: number; // USD price if available
  lastPriceUpdate?: Date;
  lastUpdated: Date;
}

export interface AllLedgerBalances {
  balances: LedgerBalance[];
  totalBalancesUSD?: number; // Total value in USD if prices are available
  lastUpdated: Date;
}

export interface PriceCalculationRequest {
  usdAmount: number;
  ledgerCanisterId: string;
  ledgerSymbol?: string; // Optional, will be fetched if not provided
}

export interface PriceCalculationResult {
  usdAmount: number;
  ledgerCanisterId: string;
  ledgerSymbol: string;
  ledgerName: string;
  currentPrice: number;
  priceTimestamp: Date;
  tokenAmountHuman: string; // Human readable amount (e.g., "1.5 ICP")
  tokenAmountDecimals: string; // Amount in smallest unit (e.g., "150000000")
  decimals: number;
}

export interface PaymentHistoryRequest {
  accountId?: string;
  ledgerCanisterId?: string;
  fromTimestamp?: Date;
  toTimestamp?: Date;
  status?: 'pending' | 'completed' | 'failed';
  limit?: number;
  offset?: number;
}

export interface PaymentHistoryItem {
  id: string;
  transactionId: number;
  status: 'pending' | 'completed' | 'failed';
  amount: string;
  currency: string;
  ledgerCanisterId: string;
  ledgerSymbol: string;
  fromAddress?: string;
  toAddress: string;
  blockHeight?: number;
  fee?: string;
  decimals?: number;
  tokenPrice?: string;
  expectedSenderPrincipal?: string;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentHistoryResponse {
  payments: PaymentHistoryItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// Public SDK responses
export interface PublicCreateIntentResponse {
  paymentIntentId: string;
  paymentIntentCode: number | null;
  payment: PaymentPublic;
  paymentIntent: SdkPaymentIntent;
}

export interface PublicNotifyResponse {
  paymentId: string;
  paymentIntentId: string | null;
  status: PaymentStatus;
  canisterTxId: number | null;
  transactionId: string | null;
}

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'canceled' | 'refunded' | 'mismatched';
export type PaymentIntentStatus = 'requires_payment' | 'processing' | 'succeeded' | 'completed' | 'failed' | 'canceled';
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void';
export type RefundStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type PayoutStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type LedgerStandard = 'ICRC-1' | 'ICRC-2' | 'ICRC-3' | 'ICRC-10' | 'ICRC-21' | 'ICP' | 'EXT';
export type LedgerNetwork = 'mainnet' | 'testnet';
export type PriceFetchMethod = 'coingecko' | 'icpswap';
export type WalletNetwork = 'ic' | 'eth' | 'btc' | 'sol';
export type WalletType = 'user' | 'platform' | 'canister';

export interface AccountPublic {
  id: string;
  name: string | null;
  isActive: boolean;
  isLive: boolean;
  accountCanisterId: number;
  icpayCanisterId?: string;
  branding?: AccountBranding | null;
}

export interface AccountBranding {
  logoUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  statementDescriptor?: string | null;
  statementDescriptorSuffix?: string | null;
}

export interface LedgerPublic {
  id: string;
  name: string;
  symbol: string;
  canisterId: string;
  decimals: number;
  logoUrl: string | null;
  verified: boolean;
  fee: string | null;
  currentPrice: number | null;
  lastPriceUpdate: string | null;
}

export interface PaymentPublic {
  id: string;
  accountId: string;
  paymentIntentId: string;
  transactionId: string | null;
  transactionSplitId?: string | null;
  canisterTxId: number | null;
  amount: string;
  ledgerCanisterId: string;
  ledgerTxId?: string | null;
  accountCanisterId?: number | null;
  basePaymentAccountId?: string | null;
  status: PaymentStatus;
  // Enriched fields (if available)
  requestedAmount?: string | null; // from payment_intent.amount
  paidAmount?: string | null; // from transaction.amount
  invoiceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SdkLedger {
  id: string;
  name: string;
  symbol: string;
  canisterId: string;
  standard: LedgerStandard;
  decimals: number;
  logoUrl: string | null;
  verified: boolean;
  fee: string | null;
  network: LedgerNetwork;
  description: string | null;
  lastBlockIndex: string | null;
  coingeckoId: string | null;
  currentPrice: number | null;
  priceFetchMethod: PriceFetchMethod | null;
  lastPriceUpdate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SdkPaymentIntent {
  id: string;
  accountId: string;
  amount: string;
  ledgerCanisterId: string;
  description: string | null;
  expectedSenderPrincipal: string | null;
  status: PaymentIntentStatus;
  metadata: Record<string, unknown>;
  intentCode: number;
  createdAt: string;
  updatedAt: string;
}

export interface SdkPayment {
  id: string;
  accountId: string;
  paymentIntentId: string;
  transactionId: string | null;
  transactionSplitId?: string | null;
  canisterTxId: number | null;
  amount: string;
  ledgerCanisterId: string;
  ledgerTxId?: string | null;
  accountCanisterId?: number | null;
  basePaymentAccountId?: string | null;
  status: PaymentStatus;
  requestedAmount?: string | null;
  paidAmount?: string | null;
  invoiceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SdkInvoice {
  id: string;
  accountId: string;
  paymentId: string | null;
  invoiceNumber: string | null;
  amountDue: string;
  amountPaid: string | null;
  currency: string | null;
  status: InvoiceStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SdkTransaction {
  id: string;
  accountId: string;
  canisterTxId: number | null;
  accountCanisterId: string | null;
  senderPrincipalId: string;
  transactionType: 'payment' | 'refund' | 'transfer' | 'withdrawal';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  amount: string;
  accountAmount: string | null;
  platformFeeAmount: string | null;
  tokenPrice: number | null;
  ledgerId: string | null;
  ledgerCanisterId: string;
  timestamp: number | null;
  indexReceived: number | null;
  indexToAccount: number | null;
  timestampReceived: number | null;
  timestampToAccount: number | null;
  metadata: Record<string, unknown>;
  memo: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SdkRefund {
  id: string;
  accountId: string;
  transactionId: string | null;
  canisterRefundId: string | null;
  canisterTxId: string | null;
  ledgerCanisterId: string | null;
  amount: string;
  accountAmount: string | null;
  platformRefundAmount: string | null;
  status: RefundStatus;
  statusMessage: string | null;
  indexPlatformToAccount: string | null;
  indexToSender: string | null;
  timestampPlatformToAccount: string | null;
  timestampToSender: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SdkPayout {
  id: string;
  accountId: string;
  walletId: string | null;
  userId: string | null;
  amount: string;
  ledgerId: string | null;
  ledgerCanisterId: string | null;
  accountCanisterId: string | null;
  fromSubaccount: string | null;
  toWalletAddress: string | null;
  toWalletSubaccount: string | null;
  blockIndex: string | null;
  ledgerTxHash: string | null;
  status: PayoutStatus;
  statusMessage: string | null;
  retryCount: number;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SdkWallet {
  id: string;
  accountId: string | null;
  walletName: string;
  walletAddress: string;
  network: WalletNetwork;
  type: WalletType;
  subaccount: string | null;
  icpAccountIdentifier: string | null;
  isActive: boolean;
  isChanged: boolean;
  previousAddress: string | null;
  isPrimary: boolean;
  isInternal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SdkWebhookEvent {
  id: string;
  webhookEndpointId: string;
  eventType: string;
  eventData: any;
  endpointUrl: string;
  relationName: string | null;
  relationId: string | null;
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'cancelled';
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  responseStatus: number | null;
  responseHeaders: Record<string, string> | null;
  responseBody: string | null;
  requestHeaders: Record<string, string> | null;
  requestBody: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  processingTimeMs: number | null;
  signature: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SdkPaymentAggregate {
  payment: SdkPayment;
  intent: SdkPaymentIntent | null;
  invoice: SdkInvoice | null;
  transaction: SdkTransaction | null;
}

export interface GetPaymentsByPrincipalRequest {
  principalId: string;
  limit?: number;
  offset?: number;
  status?: 'pending' | 'completed' | 'failed';
}

export interface LedgerInfo {
  id: string;
  name: string;
  symbol: string;
  canisterId: string;
  decimals: number;
  logoUrl?: string;
  verified: boolean;
  fee?: string;
  currentPrice?: number;
  lastPriceUpdate?: Date;
}

export interface SendFundsUsdRequest {
  usdAmount: string | number;
  ledgerCanisterId: string;
  accountCanisterId?: string;
  metadata?: Record<string, any>;
  onrampPayment?: boolean;
  widgetParams?: Record<string, any>;
}

// Payments types
export interface PaymentIntent {
  id: string;
  amount: string;
  ledgerCanisterId: string;
  status: 'requires_payment' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  metadata?: Record<string, any>;
  createdAt: string;
}

