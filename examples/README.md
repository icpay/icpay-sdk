# ICPay SDK Examples

This directory contains example usage of the ICPay SDK demonstrating different features and use cases.

## Examples Overview

### 1. `basic-usage.ts`
**Purpose:** Basic SDK functionality demonstration
**Key Features:**
- SDK initialization with secret key
- Account information retrieval
- Wallet connection
- Sending funds (both direct and USD-based)
- Transaction status checking
- Wallet modal usage
- Multi-ledger support

**Best For:** Getting started with the SDK and understanding core functionality.

### 2. `public-usage.ts`
**Purpose:** Frontend-safe SDK usage with publishable key
**Key Features:**
- SDK initialization with publishable key (safe for frontend)
- Limited account information (no sensitive data)
- Public API methods only
- Wallet operations
- Price calculations
- Balance checking
- Sending funds

**Best For:** Frontend applications where you need to expose the SDK to users.

### 3. `enhanced-usage.ts` (formerly `private-usage.ts`)
**Purpose:** Server-side SDK usage with full API access
**Key Features:**
- SDK initialization with secret key
- Full account information access
- Private API methods
- Transaction history
- Account analytics
- Advanced balance operations
- Complete transaction management

**Best For:** Backend services and server-side applications requiring full API access.

### 4. `balance-check-test.ts`
**Purpose:** Testing balance and price-related functionality
**Key Features:**
- Price calculation testing
- Ledger information retrieval
- Balance checking across multiple ledgers
- USD-based transactions
- Transaction history testing

**Best For:** Testing and validating balance-related features.

## Authentication Modes

### Public Mode (Frontend-Safe)
```typescript
const icpay = new Icpay({
  publishableKey: 'pk_live_your_publishable_key_here'
});
```

**Available Methods:**
- `getAccountInfo()` (limited data)
- `getVerifiedLedgers()`
- `getAllLedgersWithPrices()`
- `getLedgerInfo()`
- `calculateTokenAmountFromUSD()`
- `getAllLedgerBalances()`
- `getSingleLedgerBalance()`
- `sendFunds()`
- `sendFundsUsd()`
- Wallet connection methods

### Private Mode (Server-Side)
```typescript
const icpay = new Icpay({
  secretKey: 'sk_live_your_secret_key_here',
  accountId: 'your-account-id'
});
```

**Available Methods:**
- All public methods
- `getAccountInfo()` (full data)
- `getTransactionStatus()`
- `getTransactionHistory()`
- `getAccountWalletBalances()`

## Key Changes in v1.3.0

### Simplified API
- ✅ **Removed `currency` field** from `CreateTransactionRequest`
- ✅ **Automatic `accountCanisterId` fetching** in `sendFunds()` and `sendFundsUsd()`
- ✅ **Generic error messages** using "token" instead of specific symbols
- ✅ **No ledger info fetch** for error messages (performance improvement)

### Enhanced Features
- ✅ **USD-based transactions** with `sendFundsUsd()`
- ✅ **Price calculations** from USD amounts
- ✅ **Multi-ledger balance checking**
- ✅ **Public/Private API separation**

## Running Examples

```bash
# Install dependencies
npm install

# Build the SDK
npm run build

# Run a specific example
npx ts-node examples/basic-usage.ts
npx ts-node examples/public-usage.ts
npx ts-node examples/enhanced-usage.ts
npx ts-node examples/balance-check-test.ts
```

## Notes

- Replace placeholder keys (`your-secret-key`, `your-publishable-key`, etc.) with actual credentials
- Examples use development environment by default
- Wallet connection examples require user interaction
- Some examples may fail if wallet is not connected or insufficient balance
