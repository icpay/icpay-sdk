# ICPay SDK

Official SDK for Internet Computer payments with account-based authentication and wallet integration.

## Version History

### v1.3.2 (Latest)
- Initial release with user-based authentication

## Installation

```bash
npm install @icpay/sdk
```

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
```

### Server-Side Usage (Private Mode)
```typescript
import Icpay from '@icpay/sdk';

const icpay = new Icpay({
  secretKey: 'sk_live_your_secret_key_here',
  environment: 'production'
});

// Server-side operations
const transactions = await icpay.getTransactionHistory();
const accountBalances = await icpay.getAccountWalletBalances();
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
Use `secretKey` for server-side operations:

```typescript
const icpay = new Icpay({
  secretKey: 'sk_live_your_secret_key_here',
  environment: 'production'
});
```

**Available in Private Mode:**
- All public methods
- `getDetailedAccountInfo()` - Full account data
- `getTransactionStatus()` - Transaction status by ID
- `getTransactionHistory()` - Transaction data with filtering
- `getAccountWalletBalances()` - Detailed balance info

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

### 4. USD-Based Payments

Send funds using USD amounts with automatic token conversion:

```typescript
const payment = await icpay.sendFundsUsd({
  usdAmount: 5.25, // $5.25 USD
  ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
  metadata: {
    orderId: 'order-123',
    customerEmail: 'customer@example.com'
  }
});

console.log('Payment sent:', {
  transactionId: payment.transactionId,
  status: payment.status,
  amount: payment.amount,
  timestamp: payment.timestamp
});
```

### 5. Enhanced Ledger Information

Get detailed ledger information including price data:

```typescript
const ledgerInfo = await icpay.getLedgerInfo('ryjl3-tyaaa-aaaaa-aaaba-cai');
console.log('Ledger Info:', {
  name: ledgerInfo.name,
  symbol: ledgerInfo.symbol,
  currentPrice: ledgerInfo.currentPrice,
  lastPriceUpdate: ledgerInfo.lastPriceUpdate
});
```

## Connected Wallet Integration

When using your own wallet connector instead of Plug N Play, provide a `connectedWallet` object:

```typescript
interface ConnectedWallet {
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
```

**Minimum Requirements:**
- Provide either `owner` (string) or `principal` (Principal object) for balance checking
- Provide `connected` property or implement `getPrincipal()` method for connection status
- For transaction signing, provide `actorProvider` function that returns an actor with signing capabilities

**Example with Plug N Play:**
```typescript
const icpay = new Icpay({
  publishableKey: 'pk_live_your_key',
  connectedWallet: account, // Plug N Play account object
  actorProvider: getActor, // Plug N Play actor provider
});
```

**Example with custom wallet:**
```typescript
const icpay = new Icpay({
  publishableKey: 'pk_live_your_key',
  connectedWallet: {
    owner: 'your-principal-string',
    connected: true
  },
  actorProvider: (canisterId, idl) => {
    // Return your custom actor with signing capabilities
    return createActor(canisterId, idl);
  }
});
```

## Configuration

```typescript
interface IcpayConfig {
  // For public operations (frontend-safe)
  publishableKey?: string;

  // For private operations (server-side only)
  secretKey?: string;

  environment?: 'development' | 'production';
  apiUrl?: string;
  icHost?: string;

  // Wallet configuration
  usePlugNPlay?: boolean;
  plugNPlayConfig?: Record<string, any>;
  connectedWallet?: ConnectedWallet;
  actorProvider?: (canisterId: string, idl: any) => ActorSubclass<any>;
}
```

**Note:** Either `publishableKey` (public mode) or `secretKey` (private mode) must be provided.

## API Reference

### Account Methods

#### `getAccountInfo(): Promise<PublicAccountInfo>`
Get basic account information (public method).

#### `getDetailedAccountInfo(): Promise<AccountInfo>`
Get detailed account information (private method).

### Ledger Methods

#### `getVerifiedLedgers(): Promise<VerifiedLedger[]>`
Get list of verified ledgers with price information.

#### `getLedgerInfo(ledgerCanisterId: string): Promise<LedgerInfo>`
Get detailed information for a specific ledger.

#### `getAllLedgersWithPrices(): Promise<LedgerInfo[]>`
Get all ledgers with current price information.

### Balance Methods

#### `getAllLedgerBalances(): Promise<AllLedgerBalances>`
Get balances for all verified ledgers (requires connected wallet).

#### `getSingleLedgerBalance(ledgerCanisterId: string): Promise<LedgerBalance>`
Get balance for a specific ledger (requires connected wallet).

#### `getLedgerBalance(ledgerCanisterId: string): Promise<bigint>`
Get raw balance for a specific ledger (requires connected wallet).

#### `getAccountWalletBalances(): Promise<AllLedgerBalances>`
Get account wallet balances from API (private method).

### Transaction Methods

#### `sendFunds(request: CreateTransactionRequest): Promise<TransactionResponse>`
Send funds to a specific ledger.

#### `sendFundsUsd(request: SendFundsUsdRequest): Promise<TransactionResponse>`
Send funds using USD amount with automatic conversion.

#### `getTransactionStatus(canisterTransactionId: number): Promise<TransactionStatus>`
Get transaction status by canister transaction ID (private method).

#### `getTransactionHistory(request?: TransactionHistoryRequest): Promise<TransactionHistoryResponse>`
Get transaction history for the account with optional filtering (private method).

### Price Methods

#### `calculateTokenAmountFromUSD(request: PriceCalculationRequest): Promise<PriceCalculationResult>`
Calculate token amount from USD price for a specific ledger.

### Wallet Methods

#### `showWalletModal(): Promise<WalletConnectionResult>`
Show wallet connection modal.

#### `connectWallet(providerId: string): Promise<WalletConnectionResult>`
Connect to a specific wallet provider.

#### `disconnectWallet(): Promise<void>`
Disconnect from wallet.

#### `isWalletConnected(): boolean`
Check if wallet is connected.

#### `getAccountAddress(): string`
Get the connected wallet's account address.

### Types

#### `VerifiedLedger`
```typescript
interface VerifiedLedger {
  id: string;
  name: string;
  symbol: string;
  canisterId: string;
  decimals: number;
  logoUrl: string | null;
  verified: boolean;
  fee: string | null;
  currentPrice?: number | null;
  lastPriceUpdate?: string | null;
}
```

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

## Support

For support and questions, please refer to the ICPay documentation or contact the development team.