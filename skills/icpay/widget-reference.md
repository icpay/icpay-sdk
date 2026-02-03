# Widget Reference

Web Components, config types, wallet adapters, and options. Use when embedding or customizing ICPay widgets.

## Filter tokens and chains

Restrict which tokens or chains the widget shows:

- **tokenShortcodes** — Array of token shortcodes (e.g. `['ic_icp','base_usdc','sol_usdc']`). Only those tokens appear in the token selector.
- **chainShortcodes** — Array of chain shortcodes (e.g. `['ic','base','sol']`). Only those chains are offered for token selector.
- **chainTypes** — Array of `'ic' | 'evm' | 'sol'`. Restricts wallet list to those chain types.

Use these when you want to limit payment options (e.g. only USDC on Base).

## Wallet adapters

Built-in adapters (configurable via `config.adapters.<id>.enabled` and wallet-select config):

- **IC:** Plug, Internet Identity (II), Oisy, NFID.
- **EVM:** MetaMask, Coinbase Wallet, Brave Wallet, Rabby, OKX, WalletConnect (requires existing projectId; disabled by default).
- **Solana:** Phantom, Backpack (and compatible `window.solana` providers).

WalletConnect: enable with `adapters.walletconnect.enabled: true` and `adapters.walletconnect.config.projectId`. Shows QR on desktop and deep links on mobile for wallet-app payment flow.

## Components (tag names)

| Tag | Purpose |
|-----|--------|
| `icpay-pay-button` | One-click pay with fixed or configurable amount |
| `icpay-amount-input` | Enter USD amount, then pay |
| `icpay-tip-jar` | Preset amounts (e.g. 1, 5, 10 USD) for tips |
| `icpay-premium-content` | Gated content unlock (paywall) |
| `icpay-article-paywall` | Article paywall with preview and unlock |
| `icpay-coffee-shop` | Simple store with preset items (name + priceUsd) |
| `icpay-donation-thermometer` | Donation progress toward goal |
| `icpay-progress-bar` | Transaction progress indicator (used internally) |

React wrappers: `@ic-pay/icpay-widget/react` — e.g. `IcpayPayButton`, `IcpayTipJar`, `IcpayAmountInput`, `IcpayPremiumContent`, `IcpayArticlePaywall`, `IcpayCoffeeShop`, `IcpayDonationThermometer`. Pass `config` and `onSuccess` / `onError`.

## Common config (CommonConfig)

All components accept:

- **publishableKey** (required) — Client key.
- **apiUrl**, **icHost** — Override API / IC host.
- **evmProvider** — EVM provider (e.g. `window.ethereum`) for EVM flows.
- **tokenShortcodes**, **chainShortcodes**, **chainTypes** — Filter which tokens or chains are shown (see “Filter tokens and chains” above).
- **fiat_currency** — Fiat code for display (e.g. USD, EUR).
- **metadata** — Object merged into payment intent metadata.
- **theme** — `'light' | 'dark'` or `ThemeConfig` (primaryColor, surfaceColor, borderColor, fontFamily, etc.).
- **debug** — Enable SDK/widget debug logs.
- **progressBar** — `{ enabled?: boolean }`; default true.
- **disableAfterSuccess** — Disable button after successful payment.
- **recipientAddresses** — `{ evm?, ic?, sol? }` for **relay payments**: per-chain recipient address; funds are relayed to that address; widget filters wallets to matching chains.
- **recipientAddress** — Legacy single EVM recipient; prefer recipientAddresses for multi-chain.
- **actorProvider**, **connectedWallet** — For IC; required when creating payment from IC wallet. **useOwnWallet** — If true, widget does not manage wallet connection.

Source: @ic-pay/icpay-widget `src/types.ts` (CommonConfig).

## Component-specific config

- **PayButton:** `amountUsd?`, `buttonLabel?`, `onSuccess?(tx)`.
- **AmountInput:** `placeholder?`, `defaultAmountUsd?`, `minUsd?` (default 0.5), `maxUsd?`, `stepUsd?` (default 0.5), `buttonLabel?`, `onSuccess?(tx)` (tx includes `amountUsd`).
- **TipJar:** `amountsUsd?` (e.g. [1,5,10]), `defaultAmountUsd?`, `buttonLabel?`, `onSuccess?(tx)`.
- **PremiumContent:** `priceUsd`, `imageUrl?`, `buttonLabel?`, `onSuccess?(tx)`.
- **ArticlePaywall:** `priceUsd`, `title?`, `preview?`, `lockedContent?`, `buttonLabel?`, `onSuccess?(tx)`.
- **CoffeeShop:** `items: Array<{ name, priceUsd }>`, `defaultItemIndex?`, `buttonLabel?`, `onSuccess?(tx)` (tx includes `item`).
- **DonationThermometer:** `goalUsd`, `defaultAmountUsd?`, `amountsUsd?`, `buttonLabel?`, `onSuccess?(tx)` (tx includes `raised`).

Button labels support template variables: `{amount}`, `{symbol}`.

## Events

- **icpay-pay** — Payment completed; detail has payment/transaction info.
- **icpay-error** — Error; detail has message/context.
- **icpay-unlock** — Premium content unlocked.
- **icpay-tip**, **icpay-donation** — Component-specific success.

Listen on the custom element or `window`. Prefer events over console for success/error handling.

## Theming (CSS variables)

Apply on `:root` or the component:

- `--icpay-primary`, `--icpay-secondary`, `--icpay-accent`
- `--icpay-text`, `--icpay-muted-text`
- `--icpay-surface`, `--icpay-surface-alt`, `--icpay-border`
- `--icpay-font-family`
- Error/processing/warning: `--icpay-error-bg`, `--icpay-error-border`, `--icpay-error-text`; `--icpay-processing-*`; `--icpay-warning-*`

Optional Tailwind build: `dist/tailwind.css` in @ic-pay/icpay-widget.

## Build and embed

- **Library build:** In @ic-pay/icpay-widget repo: `pnpm build`. Produces ESM and UMD; React wrappers in `react/`.
- **Embed bundle:** IIFE for script tag; versioned: `pnpm run create <version>` (or see scripts in icpay-widget). Output: `dist/index.embed.js` → copy to plugin as `icpay-embed.min.js`.
- **Hosted:** `https://widget.icpay.org/v{VERSION}/embed.min.js`; then `ICPay.create('pay-button', config).mount('#el')`.

## QR code and deep links (mobile)

- **showWalletConnectQr** (payment link / config): When true (default), WalletConnect shows a QR code on desktop and deep links on mobile so users can open their wallet app to pay.
- **showBaseWalletQr**: Optional; show base wallet QR when enabled.
- Mobile detection: widget uses user-agent to offer deep links (e.g. `https://...`) so mobile browsers can open Phantom, MetaMask, etc.

## Pay page (icpay-web)

Public pay page: `icpay-web/src/app/pay/[shortcode]/page.tsx`. Fetches `GET /public/payment-links/:shortcode`; builds widget config from `link.widgetOptions`, `link.fiatCurrency`, `account.publishableKey`, and collected fields (email, name, address, quantity). Metadata includes `icpayPaymentLink: { id, shortcode, quantity, email, name, businessName, phone, billingAddress, shippingAddress }`. Widget type can be pay-button, amount-input, tip-jar, etc., from link config. Currency for display comes from link’s fiatCurrency or account default.

## Demo (demo.icpay.org)

**https://demo.icpay.org** — Live playground (`icpay-demo/`) to build and test custom widgets. All component types, configurable options, copy-paste snippets. Use for quick experiments; optional `?publishableKey=...` to test with your key.
