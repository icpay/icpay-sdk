# ICPay Reference

API surface, entities, background workers, relay payments, X402 v2, split payments, refunds, and notifications. Use when implementing or debugging API, payment links, or services.

## API (icpay-api)

- **Base URL:** `https://api.icpay.org` (or env `API_URL`). **Sandbox:** use the sandbox API base for betterstripe.com (testnets: Solana devnet, Base Sepolia, Ark network testnet, etc.) when developing by setting it to https://api.betterstripe.com`; same API surface, test keys only.
- **Auth:** `Authorization: Bearer <publishableKey | secretKey>`.

### Public SDK (publishable key)

- `POST /sdk/payment-intents` — Create payment intent (amount, symbol/ledger, metadata).
- `GET /sdk/public/payments/intents/:id` — Get payment intent by id (used by SDK when only `paymentIntentId` is provided).
- `GET /sdk/payments/:id` — Payment aggregate by ID.
- `POST /sdk/notify` — Notify ICPay about a transaction to expedite reconciliation.
- **`POST /sdk/public/payment-links`** — Create payment link + payment intent (POS flow). Auth: publishable key. Body: **CreatePosPaymentLinkDto** — `amountUsd` (required), optional `name`, `description`, `tokenShortcodes` (array; one = intent created with that token), `showWalletConnectQr`, `showBaseWalletQr`. Returns `{ shortcode, paymentIntentId, ... }`. Use pay page URL `https://icpay.org/pay/<shortcode>` (optionally `?paymentIntentId=<id>`).
- **`POST /sdk/public/payments/intents/x402`** — Create or reuse payment intent for X402. Body may include **`paymentIntentId`**; when present, API reuses that intent (same account, status requires_payment/processing), merges `icpay_x402` + clientIp into metadata, and returns it for the x402 response instead of creating a new intent. SDK sends `paymentIntentId` when config or request has an existing intent so pay link + x402 use a single intent.
- X402 v2: facilitator endpoints for verify/settle (IC, EVM, Solana); SDK uses `createPaymentX402Usd` and settle with X402 header.

### Public payment links (no auth)

- `GET /public/payment-links/:shortcode` — Returns `{ link, account }` for pay page. Link: DTO with amountUsd, shortcode, collect/require fields, widgetOptions, showWalletConnectQr, showBaseWalletQr. Account: id, name, email, businessName, publishableKey, branding.

### User (JWT)

- `POST /auth/register` — Register user.
- `POST /auth/login` — Login; returns JWT.
- `POST /user-accounts` — Create account (CreateAccountDto).
- `GET /user-accounts` — List user's accounts.
- Payment links: CRUD under user payment-links controllers (create/update/list by account).

## Key entities

- **Account** — Merchant context; has publishableKey; linked to User via AccountUser (roles: OWNER, etc.).
- **PaymentLink** — name, description, amountUsd, fiatCurrencyId (display currency), shortcode (unique), collect/require (email, name, address, phone, business, shipping), quantity (allow, min, max, default), widgetOptions (JSON), showWalletConnectQr, showBaseWalletQr, isActive.
- **PaymentIntent** — Created for a prospective payment; links to PaymentLink (optional).
- **Payment** — Realized payment; ties intent to settlement; can have refund.
- **Transaction** — On-chain movement(s); status, references.
- **Refund** — Refund entity; execute-refunds worker; webhook payment.refunded.
- **SplitRule** — Optional; accountId, targetAccountId / targetAccountCanisterId, percentageBps; multiple merchants share revenue.
- **WebhookEndpoint** — URL, filters; used for delivery.
- **Chain / Ledger** — Supported networks/tokens; verified ledgers used for pricing and pay.
- **Account** — Can have default fiat currency for display; relay fee (percentage); notification preferences.

## Payment link DTOs and service

- **CreatePaymentLinkDto** — name, description, amountUsd, fiatCurrencyId (optional), collectEmail, requireEmail, collectName, requireName, collectBusinessName, requireBusinessName, collectAddress, requireAddress, collectShippingAddress, requireShippingAddress, collectPhone, requirePhone, allowQuantity, allowBuyerChangeQuantity, defaultQuantity, minQuantity, maxQuantity, maxRedemptions, widgetOptions, showWalletConnectQr, showBaseWalletQr, isActive.
- **CreatePosPaymentLinkDto** (POS / public SDK) — amountUsd (required, min 0.01), optional name, description, tokenShortcodes (array; one = intent with that token), showWalletConnectQr (default false), showBaseWalletQr (default true). Used by `POST /sdk/public/payment-links` with publishable key.
- **PaymentLinksService** — `createForAccount(accountId, dto)` (generates unique shortcode), `updateForAccount`, `getActiveByShortcode(shortcode)`.
- **User payment links:** User-scoped controllers in `icpay-api/src/payments/` (user-payment-links.controller, etc.).
- **Public SDK payment links:** `icpay-api/src/payments/public-sdk-payment-links.controller.ts` — `POST /sdk/public/payment-links` creates link + intent; returns shortcode and paymentIntentId.

## SDK protected API (secret key)

- `getPaymentById(id)`, `listPayments()`
- `getPaymentIntentById(id)`, `getInvoiceById(id)`, `getTransactionById(id)`, `getWalletById(id)`
- `getVerifiedLedgersPrivate()`, `getAllLedgersWithPricesPrivate()`, `getLedgerInfoPrivate(idOrCanisterId)`
- `getWebhookEventById(id)`, `getDetailedAccountInfo()`, `getTransactionStatus(canisterTransactionId)`
- `getPaymentHistory(request?)`, `getPaymentsByPrincipal(request)`, `getPaymentsByMetadata(request)`, `getAccountWalletBalances()`

Defined in `src/protected.ts` (this repo); called via `icpay.protected.*` when SDK (@ic-pay/icpay-sdk) is initialized with `secretKey`.

## SDK events (icpay-sdk)

The SDK emits events for agents and apps to listen to: **`icpay-sdk-transaction-completed`** (success — use for order fulfillment), `icpay-sdk-transaction-created`, `icpay-sdk-transaction-updated`, `icpay-sdk-transaction-failed`, `icpay-sdk-transaction-mismatched`, `icpay-sdk-method-start`, `icpay-sdk-method-success`, `icpay-sdk-method-error`, `icpay-sdk-error`, and optionally `icpay-sdk-onramp-intent-created`. Subscribe with `icpay.on(type, (detail) => { ... })`. Full event payloads and usage are documented in [SKILL.md](SKILL.md#sdk-events-icpay-sdk).

## Relay payments

- Widget/SDK config: `recipientAddresses: { evm?, ic?, sol? }`. When set, payment is relayed to that address per chain; wallet list is filtered to matching chains. Relay fee (optional) is configured per account in dashboard (Settings → ICPay Fees → Relay Fee).

## X402 v2

- Supported for IC, EVM, and Solana. Flow: get acceptance(s) from API → client signs (EIP-712 for EVM, message/tx for Solana) → settle via facilitator. SDK: `createPaymentX402Usd`; fallback to regular createPaymentUsd when X402 not available. Docs: `icpay-docs/src/app/x402/page.mdx`.
- **Payment intent reuse:** When the client already has a payment intent (e.g. pay link or POS), the SDK sends **paymentIntentId** in the body to `POST /sdk/public/payments/intents/x402`. The API reuses that intent when valid (same account, status requires_payment or processing), merges x402 metadata, and returns it instead of creating a new intent so one intent is used for the full flow.

## Split payments

- **Splits module:** `icpay-api/src/splits/` — SplitsService: getAccountSplitRules, createSplitRule, updateSplitRule. SplitRule: accountId, targetAccountId (UUID), targetAccountCanisterId (bigint), percentageBps. User/sdk controllers expose CRUD. Services distribute funds to target accounts per rules.

## Refunds

- Refund flow: request via API or dashboard; execute-refunds worker processes. Webhook: `payment.refunded`. Email notification. API: RefundsModule.
