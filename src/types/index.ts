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
  accountCanisterId?: string; // Optional, will be fetched if not provided
  metadata?: Record<string, any>;
}

export interface TransactionResponse {
  transactionId: number;
  status: 'pending' | 'completed' | 'failed';
  amount: string;
  recipientCanister: string;
  timestamp: Date;
  description?: string;
  metadata?: Record<string, any>;
  payment?: PaymentObject;
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
  walletAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  accountCanisterId?: string; // Optional, will be fetched if not provided
  metadata?: Record<string, any>;
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

export interface PaymentObject {
  payment: any;
  intent: any;
  invoice?: any;
  transaction?: any;
}
