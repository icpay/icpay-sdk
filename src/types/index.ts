import type { ActorSubclass } from '@dfinity/agent';

export interface IcpayConfig {
  // For public operations (frontend-safe)
  publishableKey?: string;

  // For private operations (server-side only)
  secretKey?: string;
  accountId?: string;

  environment?: 'development' | 'production';
  apiUrl?: string;
  usePlugNPlay?: boolean;
  plugNPlayConfig?: Record<string, any>;
  externalWallet?: ExternalWallet;
  icHost?: string; // IC network host for agent-js
  /**
   * Optional: Provide a function to create an actor for any canister (e.g. from Plug N Play or direct agent-js)
   * (canisterId: string, idl: any) => ActorSubclass<any>
   */
  actorProvider?: (canisterId: string, idl: any) => ActorSubclass<any>;
}

export interface ExternalWallet {
  getPrincipal(): string;
  sign(...args: any[]): Promise<any>;
  // Add more as needed
}

export interface VerifiedLedger {
  id: string;
  name: string;
  symbol: string;
  canisterId: string;
  standard: string;
  decimals: number;
  logoUrl: string | null;
  verified: boolean;
  fee: string | null;
  network: string;
  description: string | null;
  // Price-related fields
  currentPrice?: number | null;
  priceFetchMethod?: string | null;
  lastPriceUpdate?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletInfo {
  principal: string;
  accountId: string;
  balance: {
    icp: number;
    icpayTest: number;
  };
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
  transactionHash?: string;
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
}

export interface TransactionStatus {
  transactionId: number;
  status: 'pending' | 'completed' | 'failed';
  blockHeight?: number;
  timestamp: Date;
  error?: string;
}

export interface WebhookEvent {
  id: string;
  type: 'transaction.completed' | 'transaction.failed';
  data: any;
  timestamp: Date;
}

export interface AccountInfo {
  id: string;
  name: string | null;
  email: string | null;
  isActive: boolean;
  isLive: boolean;
  accountCanisterId: number;
  walletAddress: string | null;
  walletBalance: number;
  walletCurrency: string;
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
  walletCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IcpayError {
  code: string;
  message: string;
  details?: any;
}

export interface Balance {
  icp: number;
  icpayTest: number;
}

export interface WalletConnectionResult {
  provider: string;
  principal: string;
  accountId: string;
  connected: boolean;
}

export interface CanisterInfo {
  canisterId: string;
  name: string;
  description?: string;
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
  priceFetchMethod?: string;
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
  priceFetchMethod: string;
  tokenAmountHuman: string; // Human readable amount (e.g., "1.5 ICP")
  tokenAmountDecimals: string; // Amount in smallest unit (e.g., "150000000")
  decimals: number;
}

export interface TransactionHistoryRequest {
  accountId?: string;
  ledgerCanisterId?: string;
  fromTimestamp?: Date;
  toTimestamp?: Date;
  status?: 'pending' | 'completed' | 'failed';
  limit?: number;
  offset?: number;
}

export interface TransactionHistoryItem {
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
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionHistoryResponse {
  transactions: TransactionHistoryItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface LedgerInfo {
  id: string;
  name: string;
  symbol: string;
  canisterId: string;
  standard: string;
  decimals: number;
  logoUrl?: string;
  verified: boolean;
  fee?: string;
  network: string;
  description?: string;
  currentPrice?: number;
  priceFetchMethod?: string;
  lastPriceUpdate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SendFundsUsdRequest {
  usdAmount: string | number;
  ledgerCanisterId: string;
  accountCanisterId?: string; // Optional, will be fetched if not provided
  metadata?: Record<string, any>;
}

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
