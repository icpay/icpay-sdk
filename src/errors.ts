// Standard error codes for consistent error handling
export const ICPAY_ERROR_CODES = {
  // Wallet-related errors
  WALLET_NOT_CONNECTED: 'WALLET_NOT_CONNECTED',
  WALLET_CONNECTION_FAILED: 'WALLET_CONNECTION_FAILED',
  WALLET_DISCONNECTED: 'WALLET_DISCONNECTED',
  WALLET_SIGNATURE_REJECTED: 'WALLET_SIGNATURE_REJECTED',
  WALLET_USER_CANCELLED: 'WALLET_USER_CANCELLED',
  WALLET_PROVIDER_NOT_AVAILABLE: 'WALLET_PROVIDER_NOT_AVAILABLE',
  UNSUPPORTED_PROVIDER: 'UNSUPPORTED_PROVIDER',
  NO_PROVIDERS_AVAILABLE: 'NO_PROVIDERS_AVAILABLE',

  // Balance-related errors
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  BALANCE_CHECK_FAILED: 'BALANCE_CHECK_FAILED',

  // Transaction-related errors
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  TRANSACTION_TIMEOUT: 'TRANSACTION_TIMEOUT',
  TRANSACTION_CANCELLED: 'TRANSACTION_CANCELLED',
  TRANSACTION_INVALID: 'TRANSACTION_INVALID',

  // Network/API errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  API_ERROR: 'API_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // Configuration errors
  INVALID_CONFIG: 'INVALID_CONFIG',
  MISSING_PUBLISHABLE_KEY: 'MISSING_PUBLISHABLE_KEY',
  INVALID_PUBLISHABLE_KEY: 'INVALID_PUBLISHABLE_KEY',
  SECRET_KEY_REQUIRED: 'SECRET_KEY_REQUIRED',

  // Ledger/Token errors
  LEDGER_NOT_FOUND: 'LEDGER_NOT_FOUND',
  LEDGER_NOT_VERIFIED: 'LEDGER_NOT_VERIFIED',
  TOKEN_NOT_SUPPORTED: 'TOKEN_NOT_SUPPORTED',
  INVALID_LEDGER_SYMBOL: 'INVALID_LEDGER_SYMBOL',
  LEDGER_SYMBOL_NOT_FOUND: 'LEDGER_SYMBOL_NOT_FOUND',

  // Account errors
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  ACCOUNT_INFO_FETCH_FAILED: 'ACCOUNT_INFO_FETCH_FAILED',

  // Transaction errors
  TRANSACTION_STATUS_FETCH_FAILED: 'TRANSACTION_STATUS_FETCH_FAILED',
  TRANSACTION_SYNC_TRIGGER_FAILED: 'TRANSACTION_SYNC_TRIGGER_FAILED',

  // Balance errors
  BALANCES_FETCH_FAILED: 'BALANCES_FETCH_FAILED',
  SINGLE_BALANCE_FETCH_FAILED: 'SINGLE_BALANCE_FETCH_FAILED',

  // Price/Calculation errors
  INVALID_USD_AMOUNT: 'INVALID_USD_AMOUNT',
  PRICE_NOT_AVAILABLE: 'PRICE_NOT_AVAILABLE',
  PRICE_CALCULATION_FAILED: 'PRICE_CALCULATION_FAILED',

  // Transaction errors
  TRANSACTION_HISTORY_FETCH_FAILED: 'TRANSACTION_HISTORY_FETCH_FAILED',
  PAYMENT_HISTORY_FETCH_FAILED: 'PAYMENT_HISTORY_FETCH_FAILED',
  PAYMENTS_BY_PRINCIPAL_FETCH_FAILED: 'PAYMENTS_BY_PRINCIPAL_FETCH_FAILED',
  SEND_FUNDS_USD_FAILED: 'SEND_FUNDS_USD_FAILED',

  // Ledger errors
  LEDGER_INFO_FETCH_FAILED: 'LEDGER_INFO_FETCH_FAILED',
  LEDGERS_WITH_PRICES_FETCH_FAILED: 'LEDGERS_WITH_PRICES_FETCH_FAILED',
  VERIFIED_LEDGERS_FETCH_FAILED: 'VERIFIED_LEDGERS_FETCH_FAILED',

  // Account errors
  ACCOUNT_WALLET_BALANCES_FETCH_FAILED: 'ACCOUNT_WALLET_BALANCES_FETCH_FAILED',

  // Generic errors
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR'
} as const;

export type IcpayErrorCode = typeof ICPAY_ERROR_CODES[keyof typeof ICPAY_ERROR_CODES];

export interface IcpayErrorDetails {
  code: IcpayErrorCode;
  message: string;
  details?: any;
  retryable?: boolean;
  userAction?: string;
}

export class IcpayError extends Error {
  public code: IcpayErrorCode;
  public details?: any;
  public retryable: boolean;
  public userAction?: string;

  constructor(error: IcpayErrorDetails) {
    super(error.message);
    this.name = 'IcpayError';
    this.code = error.code;
    this.details = error.details;
    this.retryable = error.retryable ?? false;
    this.userAction = error.userAction;
  }

  // Helper method to check if error is user-cancelled
  isUserCancelled(): boolean {
    return this.code === ICPAY_ERROR_CODES.WALLET_USER_CANCELLED ||
           this.code === ICPAY_ERROR_CODES.WALLET_SIGNATURE_REJECTED ||
           this.code === ICPAY_ERROR_CODES.TRANSACTION_CANCELLED;
  }

  // Helper method to check if error is retryable
  isRetryable(): boolean {
    return this.retryable;
  }

  // Helper method to check if error is wallet-related
  isWalletError(): boolean {
    const walletErrors: IcpayErrorCode[] = [
      ICPAY_ERROR_CODES.WALLET_NOT_CONNECTED,
      ICPAY_ERROR_CODES.WALLET_CONNECTION_FAILED,
      ICPAY_ERROR_CODES.WALLET_DISCONNECTED,
      ICPAY_ERROR_CODES.WALLET_SIGNATURE_REJECTED,
      ICPAY_ERROR_CODES.WALLET_USER_CANCELLED,
      ICPAY_ERROR_CODES.WALLET_PROVIDER_NOT_AVAILABLE,
      ICPAY_ERROR_CODES.UNSUPPORTED_PROVIDER,
      ICPAY_ERROR_CODES.NO_PROVIDERS_AVAILABLE
    ];
    return walletErrors.includes(this.code);
  }

  // Helper method to check if error is balance-related
  isBalanceError(): boolean {
    const balanceErrors: IcpayErrorCode[] = [
      ICPAY_ERROR_CODES.INSUFFICIENT_BALANCE,
      ICPAY_ERROR_CODES.BALANCE_CHECK_FAILED,
      ICPAY_ERROR_CODES.BALANCES_FETCH_FAILED,
      ICPAY_ERROR_CODES.SINGLE_BALANCE_FETCH_FAILED
    ];
    return balanceErrors.includes(this.code);
  }

  // Helper method to check if error is network-related
  isNetworkError(): boolean {
    const networkErrors: IcpayErrorCode[] = [
      ICPAY_ERROR_CODES.NETWORK_ERROR,
      ICPAY_ERROR_CODES.API_ERROR,
      ICPAY_ERROR_CODES.RATE_LIMIT_EXCEEDED
    ];
    return networkErrors.includes(this.code);
  }
}

// Helper functions to create common errors
export const createWalletError = (code: IcpayErrorCode, message?: string, details?: any): IcpayError => {
  const defaultMessages: Record<string, string> = {
    [ICPAY_ERROR_CODES.WALLET_NOT_CONNECTED]: 'Wallet is not connected. Please connect your wallet first.',
    [ICPAY_ERROR_CODES.WALLET_CONNECTION_FAILED]: 'Failed to connect wallet. Please try again.',
    [ICPAY_ERROR_CODES.WALLET_DISCONNECTED]: 'Wallet has been disconnected.',
    [ICPAY_ERROR_CODES.WALLET_SIGNATURE_REJECTED]: 'Transaction was rejected by the user.',
    [ICPAY_ERROR_CODES.WALLET_USER_CANCELLED]: 'Transaction was cancelled by the user.',
    [ICPAY_ERROR_CODES.WALLET_PROVIDER_NOT_AVAILABLE]: 'Wallet provider is not available.',
    [ICPAY_ERROR_CODES.UNSUPPORTED_PROVIDER]: 'Unsupported wallet provider.',
    [ICPAY_ERROR_CODES.NO_PROVIDERS_AVAILABLE]: 'No wallet providers are available.'
  };

  return new IcpayError({
    code,
    message: message || defaultMessages[code] || 'Wallet error occurred',
    details,
    retryable: code === ICPAY_ERROR_CODES.WALLET_CONNECTION_FAILED,
    userAction: code === ICPAY_ERROR_CODES.WALLET_NOT_CONNECTED ? 'Connect wallet' : undefined
  });
};

export const createBalanceError = (required: string, available: string, details?: any): IcpayError => {
  return new IcpayError({
    code: ICPAY_ERROR_CODES.INSUFFICIENT_BALANCE,
    message: `Insufficient balance. Required: ${required}, Available: ${available}`,
    details: { required, available, ...details },
    retryable: false,
    userAction: 'Add funds to your wallet'
  });
};

export const createNetworkError = (message?: string, details?: any): IcpayError => {
  return new IcpayError({
    code: ICPAY_ERROR_CODES.NETWORK_ERROR,
    message: message || 'Network error occurred. Please check your connection.',
    details,
    retryable: true,
    userAction: 'Try again'
  });
};