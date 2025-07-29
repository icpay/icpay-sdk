# ICPay SDK

Official SDK for Internet Computer payments with account-based authentication and wallet integration.

## Version History

### v1.2.0 (Upcoming)
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

## Quick Start

```typescript
import Icpay from '@icpay/sdk';

const icpay = new Icpay({
  secretKey: 'your-account-secret-key',
  accountId: 'your-account-id',
  environment: 'development', // or 'production'
  apiUrl: 'http://localhost:6201', // Your API URL
  icHost: 'http://localhost:8080', // Your IC replica or boundary node (NEW)
  // ...other config
});

// Example: Send funds to ICP ledger (principal will be converted to AccountIdentifier automatically)
const tx = await icpay.sendFunds({
  ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai', // ICP ledger
  toAddress: '727vn-fbcbl-r6jxr-soldf-cjr75-43oqc-u43ww-fpjua-mg4uz-u2mdz-kqe', // principal string
  amount: '100000000', // e8s
  currency: 'ICP',
  metadata: {}
});

// Example: Send funds to ICRC-1 ledger (principal used directly)
const tx2 = await icpay.sendFunds({
  ledgerCanisterId: 'iyedx-sqaaa-aaaak-quksq-cai', // ICRC-1 ledger
  toAddress: '727vn-fbcbl-r6jxr-soldf-cjr75-43oqc-u43ww-fpjua-mg4uz-u2mdz-kqe',
  amount: '100000000',
  currency: 'ICPAY_TEST',
  metadata: {}
});

console.log('ICP Ledger TX:', tx);
console.log('ICRC-1 Ledger TX:', tx2);
```

## Wallet Integration

### Built-in Plug N Play
- Set `usePlugNPlay: true` in config to use the SDK's built-in wallet modal (Plug, II, OISY, etc).
- Pass `plugNPlayConfig` for advanced options.

### External Wallet Injection
- Pass `externalWallet` in config (must implement `getPrincipal()`, `sign()`, etc).
- The SDK will use your wallet for all ledger transactions.

## Canister Integration (agent-js)

The SDK uses [@dfinity/agent](https://www.npmjs.com/package/@dfinity/agent) to call your canister's `get_transaction` and to send ledger transactions. The `icHost` config option controls which IC network is used (local, mainnet, etc).

## API Reference

### Authentication
The SDK uses account-based authentication with secret keys:
- `secretKey`: Your account's secret key
- `accountId`: Your account ID (optional, for additional validation)

### Methods

#### `sendFunds(request)`
Send funds to a canister using the connected wallet. Handles ICP ledger and ICRC-1 ledgers automatically.

#### `pollTransactionStatus(canisterId, transactionId, intervalMs, maxAttempts)`
Poll the canister for transaction status until completed.

#### `getTransactionStatusFromCanister(canisterId, transactionId)`
Fetch transaction status from the canister using agent-js.

## Types

### ExternalWallet
```typescript
interface ExternalWallet {
  getPrincipal(): string;
  sign(...args: any[]): Promise<any>;
}
```

## Error Handling

The SDK throws `IcpayError` for all errors:

```typescript
try {
  const tx = await icpay.sendFunds({ ... });
} catch (error) {
  if (error instanceof IcpayError) {
    console.error(error.code, error.message);
  }
}
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Development mode
npm run dev

# Test
npm test

# Lint
npm run lint
```

## License

MIT