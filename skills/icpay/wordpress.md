# WordPress Plugins (ICPay Integrations)

Reference for the two WordPress plugins. Use when configuring, building, or extending the plugins.

## Plugins

1. **icpay-payments** (`icpay-integrations/icpay-payments/`)
   - Standalone: Gutenberg block + shortcodes for all ICPay widgets.
   - Admin settings: Publishable Key, Secret Key.
   - Webhook receiver; syncs payments; admin list with filters and detail.
   - Webhook URL: `/wp-json/icpay-payments/v1/webhook`.

2. **instant-crypto-payments-for-woocommerce** (`icpay-integrations/instant-crypto-payments-for-woocommerce/`)
   - WooCommerce payment gateway: checkout and order-pay pages.
   - Pay button at checkout; order status updated on payment complete/fail (webhooks + verification).
   - Can reuse Publishable/Secret keys from icpay-payments if that plugin is installed; otherwise set in WooCommerce → Settings → Payments → ICPay.
   - Optional: filter allowed tokens (token shortcodes), metadata key/value for widget.
   - Webhook URL: `/wp-json/instant-crypto-payments-for-woocommerce/v1/wc/webhook`.

Both verify webhooks with HMAC-SHA256 on `X-ICPay-Signature` (raw body, secret key). Do not process payload before verifying.

## Widget script

- **Path in plugins:** `assets/js/icpay-embed.min.js` (and optionally `icpay-embed.min.js.map`).
- **WooCommerce only:** `assets/js/wc/index.umd.js` (WalletConnect adapter UMD).

**Source:** Built from **@ic-pay/icpay-widget** ([npm](https://www.npmjs.com/package/@ic-pay/icpay-widget)). The embed script is the IIFE bundle.

## Building the embed script (@ic-pay/icpay-widget)

1. Clone the icpay-widget repo or use a monorepo root: `cd icpay-widget` (or `pnpm --filter @ic-pay/icpay-widget build`).
2. Install: `pnpm install`.
3. Build embed: `pnpm build:embed` (or equivalent script that produces `dist/index.embed.js`).
4. Copy into plugin:
   - `dist/index.embed.js` → `icpay-payments/assets/js/icpay-embed.min.js` (and optionally `.map`).
   - For WooCommerce plugin: same; plus `dist/wc/index.umd.js` → `instant-crypto-payments-for-woocommerce/assets/js/wc/index.umd.js`.

Script `scripts/copy-wc-umd.cjs` in the icpay-widget package may copy the WalletConnect UMD. Check `package.json` scripts in icpay-widget and in each plugin for exact copy steps.

## Installation (end users)

1. **icpay-payments:** Upload to `/wp-content/plugins/` or Add New → Upload; activate. Go to Instant Crypto Payments → Settings; enter Publishable and Secret keys. Add webhook in ICPay dashboard: `https://yoursite.com/wp-json/icpay-payments/v1/webhook`.
2. **WooCommerce:** Same upload/activate. WooCommerce → Settings → Payments → ICPay; enter keys (or rely on icpay-payments if installed). Webhook: `https://yoursite.com/wp-json/instant-crypto-payments-for-woocommerce/v1/wc/webhook`.

## Shortcodes and block (icpay-payments)

- Gutenberg block: "Instant Crypto Payments" (or similar); insert and choose widget type (Pay Button, Amount Input, Tip Jar, Premium Content, Article Paywall, Donation Thermometer, Coffee Shop). Configure amount, token, labels in block settings.
- Shortcodes: Documented in plugin `readme.txt`; typically one shortcode per widget type with attributes for amount, token, key (or use global key from settings).

Exact shortcode names and attributes: see `icpay-integrations/icpay-payments/includes/` (e.g. class-icpay-widget.php, class-icpay-settings.php) and block registration in `assets/js/icpay-block.js` / `includes/class-icpay-wc-blocks.php` for WooCommerce blocks.

## PHP classes (reference)

- **icpay-payments:** `class-icpay-api.php`, `class-icpay-webhook.php`, `class-icpay-settings.php`, `class-icpay-widget.php`, `class-icpay-db.php`, `class-icpay-cron.php`, `class-icpay-loader.php`; admin: `class-icpay-admin.php`, `class-icpay-payments-table.php`; frontend: `class-icpay-frontend.php`.
- **WooCommerce:** Main plugin file `instant-crypto-payments-for-woocommerce.php`; gateway and blocks in `includes/` (e.g. `class-icpay-wc-blocks.php`); assets in `assets/js/`.

## External services (disclosure)

- ICPay API (icpay.org, api.icpay.org): payment creation, status, webhooks. Data: amounts, token, metadata; webhook payloads for status.
- Optional: Identity (identity.ic0.app) when user chooses Internet Identity; No static assets from remote CDNs; plugin serves scripts/styles locally.

Privacy/Terms: https://icpay.org/privacy, https://icpay.org/terms.
