# ICPay SDK

Official SDK for integrating Internet Computer payments with ICPay.

## Installation

Using pnpm:
```bash
pnpm add @ic-pay/icpay-sdk
```

Using yarn:
```bash
yarn add @ic-pay/icpay-sdk
```

Using npm:
```bash
npm install @ic-pay/icpay-sdk
```

## Quick start

```ts
import Icpay from '@ic-pay/icpay-sdk';

const sdk = new Icpay({
  publishableKey: process.env.NEXT_PUBLIC_ICPAY_PK!,
  // Optional for EVM flows in browser:
  evmProvider: (globalThis as any)?.ethereum,
  debug: false,
});

// Create a USD payment (amount in USD, token resolved by shortcode)
const tx = await sdk.createPaymentUsd({
  tokenShortcode: 'icp',
  usdAmount: 5,
  metadata: { orderId: 'ORDER-123' },
});

console.log('Payment status:', tx.status);
```

## Features

- Public/secret key support (browser and Node.js)
- Create payment intents in USD or token amounts
- Multi-chain payment processing:
  - EVM (native and ERC‑20), with automatic chain switching/addition hints
  - Internet Computer
- Wallet helpers: show connection modal, connect to providers, get providers, account address
- Balances and prices: external wallet balances, single-ledger balance, verified ledgers, all ledgers with prices
- Chain/ledger metadata: chains, ledger info (decimals, prices, logos)
- Evented API: start/success/error + transaction lifecycle events
- Advanced flows:
  - X402: HTTP 402 workflow with verify, settle + fallbacks
  - ATXP: quote/pay/execute

## Documentation

For full usage guides, configuration, API reference, and examples, see: https://docs.icpay.org

## TypeScript

- Fully typed with bundled `.d.ts`
- Named exports include `IcpayError`, `IcpayWallet`, events and types
