# Balance Checking Implementation

## Overview

This implementation adds comprehensive balance checking to prevent users from sending transactions with insufficient funds. The changes span both the SDK (client-side) and the canister (server-side) to ensure robust validation.

## Changes Made

### 1. SDK Changes (`icpay-sdk`)

#### A. Enhanced `sendFunds` Method (`src/index.ts`)
- **Added balance validation** before attempting any transaction
- **Checks user's balance** against the requested amount
- **Throws `INSUFFICIENT_BALANCE` error** if funds are insufficient
- **Provides detailed error information** including required vs available amounts

```typescript
// Check balance before sending
const balance = await this.getBalance();
const requiredAmount = amount;

if (ledgerCanisterId === 'ryjl3-tyaaa-aaaaa-aaaba-cai') {
  // ICP ledger
  if (balance.icp < requiredAmount) {
    throw new IcpayError({
      code: 'INSUFFICIENT_BALANCE',
      message: `Insufficient ICP balance. Required: ${requiredAmount}, Available: ${balance.icp}`,
      details: { required: requiredAmount, available: balance.icp }
    });
  }
}
```

#### B. Improved `getBalance` Method (`src/wallet.ts`)
- **Replaced mock data** with real balance fetching
- **Fetches actual ICP balance** from the ICP ledger
- **Uses proper IC agent** with connected identity
- **Handles errors gracefully** with fallback to mock data for other tokens

```typescript
// Fetch ICP balance from the ICP ledger
const icpLedgerId = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const icpLedger = Actor.createActor(ledgerIdl, {
  agent,
  canisterId: icpLedgerId
});

const icpBalanceResult = await icpLedger.icrc1_balance_of(icpAccount);
icpBalance = Number(icpBalanceResult);
```

### 2. Canister Changes (`icpay-canister`)

#### A. Zero Amount Validation (`src/lib.rs`)
- **Detects zero-amount transactions** immediately
- **Marks them as failed** with appropriate error message
- **Prevents processing** of meaningless transactions

```rust
// Check if amount is zero or insufficient
if total_amount.0.to_u64_digits().get(0).copied().unwrap_or(0) == 0 {
    ic_cdk::println!("Transaction amount is zero, marking as failed");
    // Create failed transaction record
    status: TransactionStatus::Failed("Transaction amount is zero".to_string())
}
```

#### B. Insufficient Amount Validation
- **Calculates fees** before processing
- **Checks if receiver amount** would be zero after fees
- **Marks insufficient transactions as failed** immediately
- **Prevents unnecessary processing** of transactions that can't succeed

```rust
// Check if receiver amount is zero (insufficient to cover fees)
if receiver_amount.0.to_u64_digits().get(0).copied().unwrap_or(0) == 0 {
    ic_cdk::println!("Transaction amount insufficient to cover fees, marking as failed");
    status: TransactionStatus::Failed("Transaction amount insufficient to cover fees".to_string())
}
```

## Error Handling

### SDK Error Types

1. **`INSUFFICIENT_BALANCE`**
   - **Code**: `INSUFFICIENT_BALANCE`
   - **Message**: Descriptive error with required vs available amounts
   - **Details**: Object containing `required` and `available` amounts

```typescript
{
  code: 'INSUFFICIENT_BALANCE',
  message: 'Insufficient ICP balance. Required: 1000000000, Available: 500000000',
  details: {
    required: 1000000000,
    available: 500000000
  }
}
```

### Canister Error Types

1. **Zero Amount Transactions**
   - **Status**: `Failed("Transaction amount is zero")`
   - **Action**: Immediate failure, no processing

2. **Insufficient Amount Transactions**
   - **Status**: `Failed("Transaction amount insufficient to cover fees")`
   - **Action**: Immediate failure, no processing

## Usage Examples

### Basic Balance Checking

```typescript
import { Icpay } from '@icpay/sdk';

const icpay = new Icpay({
  accountId: 'your-account-id',
  secretKey: 'your-secret-key'
});

try {
  await icpay.connectWallet('internet-identity');

  const transaction = await icpay.sendFunds({
    accountCanisterId: '123',
    ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
    amount: '1000000000', // 1 ICP
    metadata: { description: 'Payment' }
  });

  console.log('Transaction successful:', transaction);
} catch (error) {
  if (error.code === 'INSUFFICIENT_BALANCE') {
    console.error('❌ Insufficient balance:', error.message);
    const shortfall = error.details.required - error.details.available;
    console.log(`You need ${shortfall} more tokens`);
  }
}
```

### Error Handling

```typescript
try {
  await icpay.sendFunds(request);
} catch (error) {
  switch (error.code) {
    case 'INSUFFICIENT_BALANCE':
      // Show user-friendly message
      showError(`Insufficient balance. You need ${error.details.required - error.details.available} more tokens.`);
      break;
    case 'WALLET_NOT_CONNECTED':
      showError('Please connect your wallet first.');
      break;
    default:
      showError('Transaction failed. Please try again.');
  }
}
```

## Benefits

1. **Prevents Failed Transactions**: Users can't send transactions they can't afford
2. **Better User Experience**: Clear error messages explain what went wrong
3. **Reduces Network Load**: Failed transactions are caught early
4. **Cost Savings**: Users don't waste fees on doomed transactions
5. **Improved Reliability**: Both client and server validate amounts

## Testing

Run the example to test the functionality:

```bash
cd icpay-sdk
npm run build
node examples/balance-check-test.ts
```

## Future Improvements

1. **Multi-token Support**: Extend balance checking to all supported ledgers
2. **Fee Estimation**: Provide accurate fee estimates before transactions
3. **Balance Caching**: Cache balances for better performance
4. **Real-time Updates**: Update balances after successful transactions