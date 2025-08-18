## ICPay SDK — Send Funds Quickstart

A minimal example to initialize the ICPay SDK and create a payment using `sendFunds`.

### 1) Install

```bash
npm install @icpay/sdk
```

### 2) Initialize and send funds (frontend-safe)

```typescript
import Icpay from '@icpay/sdk';

async function main() {
  // 1) Create SDK instance using your publishable key
  const icpay = new Icpay({
    publishableKey: 'pk_live_your_publishable_key_here'
  });

  await icpay.connectWallet('internet-identity');

  const payment = await icpay.sendFunds({
    ledgerCanisterId: await icpay.getLedgerCanisterIdBySymbol('ICP'),
    amount: '10000000', // 0.1 ICP
    metadata: {
      orderId: 'order-123',
      note: 'Example payment'
    }
  });

  console.log('Payment sent:', {
    transactionId: payment.transactionId,
    status: payment.status,
    amount: payment.amount,
    timestamp: payment.timestamp
  });
}

main().catch(console.error);
```

### Notes

- `ledgerCanisterId` above is the ICP mainnet ledger. Use another verified ledger ID as needed.
- `amount` must be provided in the smallest unit (e8s for ICP).
- To send by USD instead of token units, use `sendFundsUsd({ usdAmount, ledgerCanisterId, metadata })`.
- For server-side usage, initialize with `secretKey` instead of `publishableKey`.


