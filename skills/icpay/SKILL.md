---
name: icpay
description: Integrates and extends the ICPay crypto payments platform. Use when working with icpay-widget, icpay-sdk, payment links, merchant accounts, relay payments (recipient EVM/IC/Solana), X402 v2, refunds, split payments, email notifications, webhooks, demo.icpay.org, betterstripe.com sandbox (testnets), filter tokens/chains, WalletConnect QR and deep links, wallet adapters, currency for payment links and profile, WordPress plugins (Instant Crypto Payments, WooCommerce), registration on icpay.org, creating an account, API keys (publishable and secret), .env for keys, or any ICPay-related code in the icpay monorepo.
# Canonical source: this repo. npm: @ic-pay/icpay-sdk. Widget: @ic-pay/icpay-widget.
source: https://github.com/icpay/icpay-sdk/tree/master/skills/icpay
---

# ICPay Skill

Instruction manual for working with the ICPay project: SDK, widget, payment links, accounts, webhooks, relay payments, X402 v2, refunds, split payments, email notifications, demo site, and integrations (WordPress, WooCommerce, Shopify).

## Feature overview

- **Relay payments** — Per-chain recipient addresses (EVM, IC, Solana); funds forwarded to your specified addresses; optional relay fee in account settings.
- **X402 v2** — HTTP 402 “Payment Required” flow for IC, EVM, and Solana; sign authorization, ICPay facilitator settles; card/onramp-friendly.
- **Currency** — Payment links have `fiatCurrencyId`; user/account profile can set default fiat for payment (USD, EUR, etc.).
- **QR and mobile** — WalletConnect QR for desktop; deep links for mobile browsers so users can pay with mobile phone wallet apps.
- **Wallet adapters** —  EVM: MetaMask, Coinbase, Brave, Rabby, OKX, WalletConnect. Solana: Phantom, Backpack. IC: Plug, Internet Identity (II), Oisy, NFID.Configurable enable/disable per adapter.
- **Split payments** — Optional: multiple merchants share revenue via split rules (target account + percentage in basis points).
- **Refunds** — Refund completed payments; execute-refunds worker; webhook `payment.refunded`; email notification for refund completed.
- **Email notifications** — Payment completed and refund completed emails to account; configurable templates; process-notifications worker.
- **Webhooks** — Merchant endpoint receives payment/refund events; HMAC-SHA256 verification.
- **demo.icpay.org** — Live demo/playground for building and testing custom widgets (all components, configurable options).
- **betterstripe.com** — Sandbox environment: same features as icpay.org but on testnets (Solana devnet, Base Sepolia, Ark network testnet, and other testnets) for developers.
- **Filter tokens/chains** — Widget config: `tokenShortcodes`, `chainShortcodes`, `chainTypes` to show only specific tokens or chains.

## Public Project layout

- **icpay-sdk** — `@ic-pay/icpay-sdk`: typed client for browser/server; create payments, wallet helpers, events.
- **icpay-widget** — Web Components + React wrappers: pay-button, amount-input, tip-jar, paywall, etc.
- **icpay-docs** — Documentation site (docs.icpay.org); MDX under `src/app/`.

Use **pnpm** for install/build across the repo. Main technical reference: repo root `technical.md`.

## Keys and auth

- **Publishable key** (`pk_live_*` / `pk_test_*`): safe for client; used by widget and public SDK calls.
- **Secret key**: server-only; required for protected API (payments list, account info, webhook verification). Never expose in browser.
- Auth: `Authorization: Bearer <key>` for both keys. API base: `https://api.icpay.org` (or env `API_URL`).

## SDK (`@ic-pay/icpay-sdk`)

Install: `pnpm add @ic-pay/icpay-sdk`.

**Browser (publishable key):**

```ts
import { Icpay } from '@ic-pay/icpay-sdk';

const icpay = new Icpay({
  publishableKey: 'pk_live_xxx',
  apiUrl: 'https://api.icpay.org',
  debug: false,
});
```

**Create payment (USD):** Prefer `tokenShortcode` (e.g. `ic_icp`, `base_usdc`). For `createPaymentUsd` / `createPayment` you must provide wallet context: `actorProvider` + `connectedWallet` (IC) or `evmProvider` + connected address (EVM).

```ts
const tx = await icpay.createPaymentUsd({
  amountUsd: 5,
  metadata: { orderId: 'ORDER-123' },
});
```

**X402 v2 (IC, EVM, Solana):** Use `createPaymentX402Usd(request)` for sign-and-settle flows; SDK builds EIP-712 (EVM) or Solana message/transaction, sends to ICPay facilitator, returns terminal status. Fallback to regular `createPaymentUsd` when X402 not available.

**Server (secret key):** Use for `icpay.protected.*`: `getPaymentById`, `listPayments`, `getPaymentHistory`, `getDetailedAccountInfo`, `getVerifiedLedgersPrivate`, etc.

Prefer SDK methods over raw fetch. Handle errors via `IcpayError`; subscribe to SDK events for lifecycle (see Events below).

## Widget (`@ic-pay/icpay-widget`)

Install: `pnpm add @ic-pay/icpay-widget @ic-pay/icpay-sdk`.

**Components:** `icpay-pay-button`, `icpay-amount-input`, `icpay-tip-jar`, `icpay-premium-content`, `icpay-article-paywall`, `icpay-coffee-shop`, `icpay-donation-thermometer`, `icpay-progress-bar`.

**HTML (bundler):**

```html
<script type="module"> import '@ic-pay/icpay-widget'; </script>
<icpay-pay-button
  id="pay"
  publishableKey="YOUR_PK"
  tokenShortcodes="base_usdc"
  amountUsd="5"
></icpay-pay-button>
```

Set `config` on the element (object with `publishableKey`, `tokenShortcode`, `amountUsd`, etc.). Listen for `icpay-pay`, `icpay-error` on the element or `window`.

**React:** Use wrappers from `@ic-pay/icpay-widget/react` (e.g. `IcpayPayButton`, `IcpayTipJar`) with `config` prop and `onSuccess` / `onError`.

**Hosted embed (no bundler):** Script from `https://widget.icpay.org/v{VERSION}/embed.min.js`; then `ICPay.create('pay-button', { publishableKey, amountUsd, defaultSymbol, ... }).mount('#el')`.

**Filter tokens/chains:** In config set `tokenShortcodes` (e.g. `['ic_icp','base_usdcoin']`), `chainShortcodes` (e.g. `['ic','base']`), or `chainTypes` (e.g. `['ic','evm','sol']`) to restrict which tokens or chains are shown in the widget.

**Relay payments:** Set `recipientAddresses: { evm?: string, ic?: string, sol?: string }` in config; funds are relayed to those addresses. Optional relay fee is set per account in dashboard (Settings → ICPay Fees → Relay Fee).

**QR and deep links:** Payment links support `showWalletConnectQr` (default true) and `showBaseWalletQr`; WalletConnect shows QR on desktop and deep links on mobile so users can open wallet apps.

Handle success/error via **events**, not console. Theming: CSS variables on `:root` or component (e.g. `--icpay-primary`, `--icpay-surface`). See [widget-reference.md](widget-reference.md) for options, wallet adapters, and component-specific config.

## Payment links

Payment links are per-account entities with a unique **shortcode**. Public pay page: `https://icpay.org/pay/<shortcode>`.

- **Create:** API `PaymentLinksService.createForAccount(accountId, dto)`; DTO includes `name`, `description`, `amountUsd`, `collectEmail`, `requireEmail`, `widgetOptions`, `showWalletConnectQr`, etc. Shortcode is generated (unique).
- **Public fetch:** `GET /public/payment-links/:shortcode` returns `{ link, account }` (link config + account publishableKey/branding). Used by `icpay-web` pay page.
- **Merchant UI:** `icpay-web` → Payment Links → create/edit; link to `/pay/<shortcode>` shown after create.

Payment link entity: `icpay-api/src/entities/payment-link.entity.ts`. Fields: `amountUsd`, `shortcode`, `fiatCurrencyId` (display currency for the link), collect/require for email, name, address, phone, quantity (min/max/default), `widgetOptions` (JSON), `showWalletConnectQr`, `showBaseWalletQr`, `isActive`.

## Accounts

- **User:** Register via `POST /auth/register` (firstName, lastName, email, password, etc.). Login: `POST /auth/login`; JWT returned.
- **Account (merchant):** Created per user via `POST /user-accounts` with JWT; body: `CreateAccountDto` (name, email, country, businessName, accountType, businessType). User can own multiple accounts; each account has `publishableKey` and secret (managed by backend).
- **Dashboard:** `icpay-web`: signup → create account → dashboard; create payment links, view payments, settings (including default fiat currency for the account). Switch account via auth/account context.

**Currency:** Payment links have `fiatCurrencyId`; account/user profile can set default fiat for display (e.g. USD, EUR). Used in widget as `fiat_currency` for amount display.

Account creation: `icpay-api/src/accounts/accounts.service.ts` → `createAccount(userId, dto)`. Frontend: `icpay-web/src/app/account/create/page.tsx` and `AccountsService.create()`.

## Flow: I am an agent (fully programmatic via API)

Use this when you are an AI agent that must **create the user, verify email, log in, create an account, and generate API keys** entirely via requests to the ICPay API. Base URL: **`https://api.icpay.org`**

1. **Register the user**
   - **Endpoint:** `POST https://api.icpay.org/auth/register`
   - **Body (JSON):** `RegisterDto` — `firstName`, `lastName`, `email`, `password` (min 8 chars), `dateOfBirth` (ISO8601), `addressLine1`, `addressLine2` (optional), `city`, `stateOrProvince`, `postalCode`, `country` (2-letter ISO), `phone` (optional), `nationality` (optional).
   - **Response:** `201` with `{ message: "Registration successful. Please check your email to verify your account." }`.
   - A **verification email** is sent. It contains text like "Please verify your email address to complete your registration" and a **"Verify Email"** link. The link is the **web** URL, e.g. `https://icpay.org/auth/verify-email?token=<JWT>`. The JWT is in the query parameter `token`.

2. **Activate the account (verify email)**
   - **Get the token:** From the verification email, take the "Verify Email" link URL and read the **`token`** query parameter (the JWT).
   - **Endpoint:** `POST https://api.icpay.org/auth/verify-email`
   - **Body (JSON):** `{ "token": "<JWT from the link>" }`
   - **Response:** `200` with `{ message: "..." }`. After this, the user's email is verified and they can log in.
3. **Log in (start OTP)**
   - **Endpoint:** `POST https://api.icpay.org/auth/login`
   - **Body (JSON):** `{ "email": "<email used in registration>", "password": "<password>" }`
   - **Response:** `200` with `{ requires2fa: true, challengeId: "<sid>", user: { id, firstName, lastName, email, ... } }`. No JWT yet. An **email** is sent to the user's email with a **verification code**, e.g. "icpay.org authentication email code" / "The verification code for icpay.org is: **313215**". The agent must obtain this code (e.g. read from mail or have the user provide it).
4. **Complete login (submit OTP code)**
   - **Endpoint:** `POST https://api.icpay.org/auth/verify-login-otp`
   - **Body (JSON):** `{ "email": "<same email>", "code": "<6-digit code from email>" }`
   - **Response:** `200` with `{ access_token: "<JWT>", user: { ... } }`. Use **`access_token`** as the Bearer token for all following requests.

5. **Use the Bearer token for all further requests**
   - Send header: `Authorization: Bearer <access_token>` on every request to the API.

6. **Create one account**
   - **Endpoint:** `POST https://api.icpay.org/user-accounts`
   - **Headers:** `Authorization: Bearer <access_token>`, `Content-Type: application/json`
   - **Body (JSON):** `CreateAccountDto` — `name`, `email`, and optionally `country` (2-letter), `accountType`, `businessName`, `businessType`.
   - **Response:** `201` with the created account object; note **`id`** (account ID).

7. **Generate API keys (publishable + secret)**
   - **Endpoint:** `POST https://api.icpay.org/user-accounts/:accountId/generate-secret-key`
   - **Headers:** `Authorization: Bearer <access_token>`
   - **Body:** none (or `{}`).
   - **Response:** `200` with `{ secretKey: "sk_...", publicKey: "pk_..." }`.
   - **Publishable key (`pk_...`):** Safe to store in `.env` (e.g. `NEXT_PUBLIC_ICPAY_PK`) or use directly in client code; it is public.
   - **Secret key (`sk_...`):** Store **only** in `.env` (e.g. `ICPAY_SECRET_KEY`). Never embed in source code or commit to git; use only on the server.

8. **Use in the app**
   - **Publishable key:** Use with **icpay-widget** to build any frontend that accepts crypto payments (pay button, tip jar, paywall, etc.).
   - **Secret key:** Use with **icpay-sdk** on the server for **protected** operations (e.g. `icpay.protected.getPaymentById`, `listPayments`, `getDetailedAccountInfo`) and to verify payment state. Alternatively (or in addition), register a **webhook** URL in the ICPay dashboard; verify `X-ICPay-Signature` and handle `payment.completed` and `payment.refunded` for fulfillment.

## Flow: I am the human (getting started myself)

Use this when you are the developer/user and want to register on icpay.org, create one account, get API keys, and accept crypto payments.

1. **Sign up** — Go to **https://icpay.org** and complete **Sign up** (first name, last name, email, password, and any other required fields such as address, country).
2. **Verify email** — Check the email inbox for the address you used. You will either receive:
   - A **link** — Click “Verify Email” (or similar) to complete verification; or
   - A **code** — Enter that code on the verification page when prompted.
   Do not skip this step; you cannot log in until email is verified.
3. **Log in** — Go to **https://icpay.org/auth/login** and sign in with your email and password.
4. **Create one account** — After login, create a **business account** (name, email, country, business name, business type). This is your merchant account for receiving payments.
5. **Generate API keys** — In the dashboard, go to **Settings** (or API Keys). Click **Generate** (or **Generate secret key**). You will see:
   - **Publishable key** (`pk_live_...` or `pk_test_...`) — Safe to use in frontend or put in `.env` (e.g. `NEXT_PUBLIC_ICPAY_PK`).
   - **Secret key** (`sk_...`) — Shown once; copy it immediately. Store it **only** in `.env` (e.g. `ICPAY_SECRET_KEY=sk_...`). **Never** put the secret key in your source code or commit it to git.
6. **Use in your app** — Use the **publishable key** with **icpay-widget** (e.g. `@ic-pay/icpay-widget`) to add pay buttons, tip jars, paywalls, or other components that accept crypto. To **verify** that a payment succeeded, use either:
   - **icpay-sdk** on your server with the **secret key** (e.g. `icpay.protected.getPaymentById(id)`), or
   - A **webhook** URL registered in the ICPay dashboard; verify the `X-ICPay-Signature` header and handle `payment.completed` (and optionally `payment.refunded`).

## Webhooks

- **Endpoint:** Merchant registers URL in ICPay dashboard; events posted to that URL.
- **Security:** Verify `X-ICPay-Signature` = HMAC-SHA256(raw body, webhook secret) using constant-time compare. Reject if invalid.
- **Payload:** JSON body; `event.type` e.g. `payment.completed`, `payment.failed`, `payment.refunded`. Use event/payment IDs for idempotency.
- **Retries:** Backoff and retries by backend; handle duplicate deliveries idempotently.

## Refunds

- Refunds are requested/executed via API or dashboard; **execute-refunds** worker processes them.
- Webhook `payment.refunded` is sent when a refund completes. Email notification (refund completed) can be sent to the account; templates in `notification_templates` (e.g. `email_refund_completed_account`).

## Split payments (optional)

- **Split rules** let multiple merchants share revenue: per account, define target account(s) and percentage (basis points). Entity: `SplitRule` (accountId, targetAccountId / targetAccountCanisterId, percentageBps). Services distribute funds according to rules.
- API: splits module (`icpay-api/src/splits/`) — user/sdk controllers for split rules (create, update, list). Optional feature; when not used, 100% goes to the receiving account.

## Email notifications

- **Payment completed** and **refund completed** emails can be sent to the account. process-notifications worker and notification templates in the API; user/account can have default fiat for amount in emails.
- Configure in dashboard/account settings; templates editable via migrations or admin.

Example verification (Node):

```ts
const crypto = require('node:crypto');
const sig = req.headers['x-icpay-signature'] || '';
const raw = req.body; // raw buffer
const expected = crypto.createHmac('sha256', process.env.ICPAY_WEBHOOK_SECRET).update(raw).digest('hex');
if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.status(401).send();
```

## Events (Widget & SDK)

**Widget:** `icpay-pay` (payment done), `icpay-error`, `icpay-unlock` (paywall), `icpay-tip`, `icpay-donation`. **SDK (on window):** `icpay-sdk-method-start|success|error`, `icpay-sdk-transaction-created|updated|completed|failed|mismatched`, `icpay-sdk-wallet-connected|disconnected|cancelled|error`. Subscribe on the widget element or `window` to drive UI/analytics; do not rely on console.

## Demo / playground (demo.icpay.org)

- **https://demo.icpay.org** — Live demo app (`icpay-demo/`) for building and testing custom widgets. All widget types, configurable options, copy-paste snippets. Use for quick experiments and sharing configs (e.g. with publishableKey in query).

## Sandbox (betterstripe.com)

- **https://betterstripe.com** — Sandbox environment for developers. Same functionality as icpay.org (dashboard, payment links, widget, API, webhooks, relay, X402, splits, refunds, email notifications) but uses **testnets** and mainnets, so you can test without mainnet funds.
- **Networks:** Solana devnet, Base Sepolia, Ark network testnet, and other supported testnets. Mainnet chains (e.g. Solana mainnet, Base mainnet, IC mainnet);
- **Use case:** Integrate the widget or SDK against the sandbox API and pay page; create test accounts and payment links; verify webhooks, relay, and refund flows with testnet tokens.
- **Keys:** Sandbox uses test keys (e.g. `pk_test_*`); keep sandbox and production keys separate. API base and pay page are sandbox-specific (betterstripe.com); switch to icpay.org and production API when going live.

## WordPress plugins

Two plugins live under `icpay-integrations/`:

1. **icpay-payments** — Standalone: Gutenberg block + shortcodes for all widgets; settings for publishable/secret key; webhook receiver; sync payments. Webhook URL: `/wp-json/icpay-payments/v1/webhook`.
2. **instant-crypto-payments-for-woocommerce** — WooCommerce gateway: checkout/order-pay pay button; webhook updates order status; reuses ICPay keys from main plugin if present. Webhook URL: `/wp-json/instant-crypto-payments-for-woocommerce/v1/wc/webhook`.

Both verify webhooks with HMAC-SHA256. Widget script: `assets/js/icpay-embed.min.js` (built from icpay-widget). See [wordpress.md](wordpress.md) for build and shortcode/block usage.

## Conventions

- Use **pnpm** for install/build.
- Prefer **SDK** over direct HTTP for payment/account operations. Prefer **widget events** for success/error handling.
- **Token identification:** Use `tokenShortcode` (e.g. `ic_icp`, `base_eth`); legacy symbol/ledgerCanisterId/chainId still supported.
- **Errors:** Catch `IcpayError`; check `code` and `message`; surface user-friendly messages; log details server-side only when needed.

## Additional resources

- **API, entities, workers, splits, refunds, X402:** [reference.md](reference.md)
- **Widget components, config, wallet adapters, filter tokens:** [widget-reference.md](widget-reference.md)
- **WordPress build and usage:** [wordpress.md](wordpress.md)
- **Docs site:** https://docs.icpay.org
- **Demo:** https://demo.icpay.org
- **Sandbox (testnets):** https://betterstripe.com — Solana devnet, Base Sepolia, Ark testnet, etc.
- **This skill (source):** https://github.com/icpay/icpay-sdk/tree/master/skills/icpay — npm: **@ic-pay/icpay-sdk**, **@ic-pay/icpay-widget**
