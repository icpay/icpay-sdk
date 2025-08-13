# ICPay SDK

Official SDK for Internet Computer payments with account-based authentication and wallet integration.

## Version History

### v1.3.0 (Latest)
- ✅ **Public/Private API Separation** - Support for both publishable and secret keys
- ✅ **Frontend-Safe Operations** - Public methods for client-side applications
- ✅ **Enhanced Balance Management** - Fetch balances for all ledgers or single ledgers
- ✅ **Price Calculation** - Convert USD amounts to token amounts with real-time pricing
- ✅ **USD-Based Payments** - Send funds using USD amounts with automatic token conversion
- ✅ **Transaction History** - Get detailed transaction history with filtering
- ✅ **Enhanced Ledger Information** - Detailed ledger data including price information
- ✅ **Account Wallet Balances** - Get account wallet balances from API
- ✅ **Price-Aware Balance Display** - Balances with USD values when prices are available

### v1.2.0
- ✅ **Plug N Play wallet integration** (optional, built-in modal)
- ✅ **External wallet injection** (bring your own wallet, must implement required methods)
- ✅ **Ledger transaction support** (send funds to canister using connected wallet)
- ✅ **Canister polling** (poll transaction status via canister get_transaction)
- ✅ **Agent-js integration** (for canister calls and ledger transactions)
- ✅ **IC Host configuration** (`icHost` option for agent-js calls)

### v1.1.0
- Account-based authentication, updated endpoints, simplified API, better error handling

### v1.0.0
- Initial release with user-based authentication

## Installation

```bash
npm install @icpay/sdk
```

## Authentication Modes

The SDK supports two authentication modes:

### Public Mode (Frontend-Safe)
Use `publishableKey` for client-side applications:

```typescript
const icpay = new Icpay({
  publishableKey: 'pk_live_your_publishable_key_here',
  environment: 'production'
});
```

**Available in Public Mode:**
- `getAccountInfo()` - Basic account information
- `getVerifiedLedgers()` - Ledger list with prices
- `getLedgerInfo()` - Individual ledger details
- `getAllLedgersWithPrices()` - All ledgers with pricing
- `calculateTokenAmountFromUSD()` - Price calculations
- `getAllLedgerBalances()` - All ledger balances (with connected wallet)
- `getSingleLedgerBalance()` - Single ledger balance (with connected wallet)
- `sendFunds()` - Send funds to canister
- `sendFundsUsd()` - Send funds using USD amounts
- Wallet connection and balance checking (with connected wallet)

### Private Mode (Server-Side)
Use `secretKey` and `accountId` for server-side operations:

```typescript
const icpay = new Icpay({
  secretKey: 'sk_live_your_secret_key_here',
  accountId: 'your-account-id',
  environment: 'production'
});
```

**Available in Private Mode:**
- All public methods
- `getTransactionHistory()` - Transaction data
- `getAccountWalletBalances()` - Detailed balance info

## Quick Start

### Frontend Usage (Public Mode)
```typescript
import Icpay from '@icpay/sdk';

const icpay = new Icpay({
  publishableKey: 'pk_live_your_publishable_key_here',
  environment: 'production'
});

// Safe for client-side
const accountInfo = await icpay.getAccountInfo();
const ledgers = await icpay.getVerifiedLedgers();
const priceCalc = await icpay.calculateTokenAmountFromUSD({
  usdAmount: 100,
  ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai'
});

// Connect wallet for balance and transaction operations
await icpay.connectWallet('internet-identity');
const balances = await icpay.getAllLedgerBalances();
const tx = await icpay.sendFundsUsd({
  usdAmount: 5.61,
  ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai'
});
```

### Backend Usage (Private Mode)
```typescript
import Icpay from '@icpay/sdk';

const icpay = new Icpay({
  secretKey: 'sk_live_your_secret_key_here',
  accountId: 'your-account-id',
  environment: 'production',
  icHost: 'https://ic0.app'
});

// Server-side operations
const transactions = await icpay.getTransactionHistory();
const accountBalances = await icpay.getAccountWalletBalances();
```

## Enhanced Features

### 1. Balance Management

#### Get All Ledger Balances
Fetch balances for all verified ledgers for the connected wallet:

```typescript
// Connect wallet first
await icpay.connectWallet('internet-identity');

// Get all balances
const allBalances = await icpay.getAllLedgerBalances();
console.log('Total USD Value:', allBalances.totalBalancesUSD);
console.log('Balances:', allBalances.balances.map(b => ({
  symbol: b.ledgerSymbol,
  balance: b.formattedBalance,
  usdValue: b.currentPrice ?
    (parseFloat(b.formattedBalance) * b.currentPrice).toFixed(2) : 'N/A'
})));
```

#### Get Single Ledger Balance
Fetch balance for a specific ledger:

```typescript
const icpBalance = await icpay.getSingleLedgerBalance('ryjl3-tyaaa-aaaaa-aaaba-cai');
console.log('ICP Balance:', {
  balance: icpBalance.formattedBalance,
  usdValue: icpBalance.currentPrice ?
    (parseFloat(icpBalance.formattedBalance) * icpBalance.currentPrice).toFixed(2) : 'N/A'
});
```

### 2. Price Calculation

Convert USD amounts to token amounts using real-time pricing:

```typescript
const priceCalculation = await icpay.calculateTokenAmountFromUSD({
  usdAmount: 100, // $100 USD
  ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai' // ICP ledger
});

console.log('Token Amount:', {
  humanReadable: priceCalculation.tokenAmountHuman, // "1.5 ICP"
  inDecimals: priceCalculation.tokenAmountDecimals, // "150000000"
  currentPrice: priceCalculation.currentPrice,
  priceTimestamp: priceCalculation.priceTimestamp
});
```

### 3. Transaction History

Get detailed transaction history with filtering:

```typescript
const history = await icpay.getTransactionHistory({
  limit: 20,
  offset: 0,
  status: 'completed',
  fromTimestamp: new Date('2024-01-01'),
  toTimestamp: new Date()
});

console.log('Transactions:', history.transactions.map(tx => ({
  id: tx.id,
  amount: tx.amount,
  currency: tx.currency,
  status: tx.status,
  createdAt: tx.createdAt
})));
```


### 7. Enhanced Ledger Information

Get detailed ledger information including price data:

```typescript
const ledgerInfo = await icpay.getLedgerInfo('ryjl3-tyaaa-aaaaa-aaaba-cai');
console.log('Ledger Info:', {
  name: ledgerInfo.name,
  symbol: ledgerInfo.symbol,
  currentPrice: ledgerInfo.currentPrice,
  priceFetchMethod: ledgerInfo.priceFetchMethod,
  lastPriceUpdate: ledgerInfo.lastPriceUpdate
});
```

### 8. Account Wallet Balances

Get account wallet balances from API (not connected wallet):

```typescript
const accountBalances = await icpay.getAccountWalletBalances();
console.log('Account Balances:', {
  totalBalancesUSD: accountBalances.totalBalancesUSD,
  balances: accountBalances.balances.map(b => ({
    symbol: b.ledgerSymbol,
    balance: b.formattedBalance,
    currentPrice: b.currentPrice
  }))
});
```

## API Reference

### Public Methods (Frontend-Safe)

#### `getAccountInfo(): Promise<AccountInfo | PublicAccountInfo>`
Get account information (limited data in public mode, full data in private mode).

#### `getVerifiedLedgers(): Promise<VerifiedLedger[]>`
Get verified ledgers with price information.

#### `getLedgerInfo(ledgerCanisterId: string): Promise<LedgerInfo>`
Get detailed ledger information including price data.

#### `getAllLedgersWithPrices(): Promise<LedgerInfo[]>`
Get all ledgers with price information.

#### `calculateTokenAmountFromUSD(request: PriceCalculationRequest): Promise<PriceCalculationResult>`
Calculate token amount from USD price for a specific ledger.

#### `getAllLedgerBalances(): Promise<AllLedgerBalances>`
Get balance for all verified ledgers for the connected wallet.

#### `getSingleLedgerBalance(ledgerCanisterId: string): Promise<LedgerBalance>`
Get balance for a specific ledger by canister ID.

#### `sendFunds(request: CreateTransactionRequest): Promise<TransactionResponse>`
Send funds to a specific canister/ledger. The currency symbol is automatically determined from the ledger. If `accountCanisterId` is not provided, it will be automatically fetched from the API.

#### `sendFundsUsd(request: SendFundsUsdRequest): Promise<TransactionResponse>`
Send funds using USD amount with automatic token conversion. If `accountCanisterId` is not provided, it will be automatically fetched from the API.

### Private Methods (Server-Side Only)

#### `getTransactionHistory(request?: TransactionHistoryRequest): Promise<TransactionHistoryResponse>`
Get transaction history for the account with optional filtering.

#### `getAccountWalletBalances(): Promise<AllLedgerBalances>`
Get account wallet balances from API.

### Types

#### `LedgerBalance`
```typescript
interface LedgerBalance {
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
```

#### `PriceCalculationResult`
```typescript
interface PriceCalculationResult {
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
```

#### `SendFundsUsdRequest`
```typescript
interface SendFundsUsdRequest {
  usdAmount: string | number;
  ledgerCanisterId: string;
  accountCanisterId?: string; // Optional, will be fetched if not provided
  metadata?: Record<string, any>;
}
```

## Examples

See the `examples/` directory for comprehensive usage examples:

- `basic-usage.ts` - Basic SDK functionality
- `public-usage.ts` - Frontend-safe operations with publishable key
- `enhanced-usage.ts` - Server-side operations with secret key

## Error Handling

The SDK uses a consistent error handling pattern:

```typescript
try {
  const balances = await icpay.getAllLedgerBalances();
} catch (error) {
  if (error instanceof IcpayError) {
    console.error('ICPay Error:', error.code, error.message);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Configuration

```typescript
interface IcpayConfig {
  // For public operations (frontend-safe)
  publishableKey?: string;

  // For private operations (server-side only)
  secretKey?: string;
  accountId?: string;

  environment?: 'development' | 'production';
  apiUrl?: string;
  icHost?: string;
  usePlugNPlay?: boolean;
  plugNPlayConfig?: Record<string, any>;
  externalWallet?: ExternalWallet;
  actorProvider?: (canisterId: string, idl: any) => ActorSubclass<any>;
}
```

**Note:** Either `publishableKey` (public mode) or `secretKey` + `accountId` (private mode) must be provided.

## Support

For support and questions, please refer to the ICPay documentation or contact the development team.