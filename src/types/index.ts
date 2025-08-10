import type { ActorSubclass } from '@dfinity/agent';

export interface IcpayConfig {
  secretKey: string;
  accountId: string;
  environment?: 'development' | 'production';
  apiUrl?: string;
  usePlugNPlay?: boolean;
  plugNPlayConfig?: Record<string, any>;
  externalWallet?: ExternalWallet;
  icHost?: string; // New: IC network host for agent-js
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

export interface BusinessAccount {
  id: string;
  accountCanisterId: number;
  name: string;
  email: string;
  businessName: string;
  isActive: boolean;
  isLive: boolean;
  platformFeePercentage: number | null;
  platformFeeFixed: number | null;
  walletAddress: string;
  walletBalance: number;
  walletCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface VerifiedLedger {
  id: string;
  name: string;
  symbol: string;
  canisterId: string;
  standard: string;
  decimals: number;
  logoUrl: string | null;
  supportsNotify: boolean;
  notifyMethod: string | null;
  verified: boolean;
  fee: string | null;
  network: string;
  description: string | null;
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
  accountCanisterId: string;
  accountId: string;
  currency: string;
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
  type: 'transaction.completed' | 'transaction.failed' | 'account.created';
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

export interface StoreConfig {
  walletAddress: string;
  platformPercentage: number;
  platformWallet: string;
  webhookUrl?: string;
  callbackUrl?: string;
  events: string[];
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

export interface PaymentRequest {
  amount: number;
  currency: string;
  ledgerCanisterId: string;
  accountCanisterId: number;
  description?: string;
  metadata?: Record<string, any>;
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