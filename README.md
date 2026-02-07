# ICPay SDK

Official SDK for integrating **ICPay** — multi-chain crypto payments on **EVM (e.g. Base)**, **Solana**, and **Internet Computer**. Use one API for payment intents, USD or token amounts, wallet connection, balances, and advanced flows (X402, ATXP) across all supported chains.

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
  // Optional: pass wallet providers for browser flows
  evmProvider: (globalThis as any)?.ethereum,
  solanaProvider: (globalThis as any)?.solana,
  debug: false,
});

// Create a USD payment (amount in USD; token/chain by shortcode, e.g. base_usdc, sol_usdc, ic_icp)
const tx = await sdk.createPaymentUsd({
  tokenShortcode: 'base_usdc',
  usdAmount: 5,
  metadata: { orderId: 'ORDER-123' },
});

console.log('Payment status:', tx.status);
```

## Supported chains

- **EVM** — Base (and other EVM chains): native and ERC‑20; automatic chain switching/addition hints.
- **Solana** — SOL and SPL tokens; Phantom, Backpack, and other Solana wallets.
- **Internet Computer** — ICP and ICRC tokens; Plug, Internet Identity, NFID, etc.

Use `tokenShortcode` (e.g. `base_usdc`, `sol_usdc`, `ic_icp`) or `ledgerCanisterId` to target a specific chain/token. Full list: `getVerifiedLedgers()` or [docs.icpay.org](https://docs.icpay.org).

## Features

- **Keys** — Publishable key (browser-safe) and secret key (server-only) support.
- **Payments** — Create payment intents in USD or token amounts; relay to your EVM/IC/Solana addresses.
- **Multi-chain** — Single SDK for EVM (Base, etc.), Solana, and Internet Computer.
- **Wallet helpers** — Show connection modal, connect by provider, get providers, account address; WalletConnect QR and deep links.
- **Balances & prices** — External wallet balances, single-ledger balance, verified ledgers, all ledgers with prices.
- **Chain/ledger metadata** — `getChains()`, ledger info (decimals, prices, logos), token/chain filtering.
- **Events** — Lifecycle events: start/success/error and transaction events (e.g. `icpay-sdk-transaction-completed`).
- **Advanced flows** — **X402**: HTTP 402 sign-and-settle for IC, EVM, and Solana; **ATXP**: quote/pay/execute.
- **Onramp** — Optional fiat-to-crypto via Transak (configurable per account).

## Documentation

Full usage, configuration, API reference, and examples: **[https://docs.icpay.org](https://docs.icpay.org)**
Sandbox (testnets): **[betterstripe.com](https://betterstripe.com)** — Base Sepolia, Solana Devnet, and other test networks.

## AI agents

Using Cursor, Claude Code, Antigravity, Windsurf, Continue, GitHub Copilot, Kiro, or Trae with ICPay? Add the **ICPay skill** so the agent follows SDK, widget, payment links, and integration conventions.

### If the SDK is already in node_modules

If your project already has `@ic-pay/icpay-sdk` in `node_modules` (e.g. you linked the repo with `pnpm link` / `npm link`, or the package ships the skill folder), you can symlink or copy from there — no need to clone:

- **Symlink** (project): `mkdir -p .cursor/skills && ln -s $(pwd)/node_modules/@ic-pay/icpay-sdk/skills/icpay .cursor/skills/icpay`
- **Symlink** (personal): `mkdir -p ~/.cursor/skills && ln -s /path/to/your-project/node_modules/@ic-pay/icpay-sdk/skills/icpay ~/.cursor/skills/icpay`
- **Copy**: `mkdir -p .cursor/skills && cp -r node_modules/@ic-pay/icpay-sdk/skills/icpay .cursor/skills/`

Use the same pattern for other IDEs (`.claude/skills/`, `.agent/skills/`, etc.). Note: the published npm package may not include the `skills` folder; it is present when you use the repo (clone or link).

### Or clone the repo

Run the **copy** commands below from the **icpay-sdk repo root** (after `git clone https://github.com/icpay/icpay-sdk && cd icpay-sdk`). If you can use symlinks, prefer symlinking so the skill stays updated on `git pull`; see "Where Cursor looks for skills" below.

| IDE / Agent | Where the skill goes | Copy command |
|-------------|----------------------|--------------|
| **Cursor** (project) | `.cursor/skills/icpay/` | `mkdir -p .cursor/skills && cp -r skills/icpay .cursor/skills/` |
| **Cursor** (personal) | `~/.cursor/skills/icpay/` | `mkdir -p ~/.cursor/skills && cp -r skills/icpay ~/.cursor/skills/` |
| **Claude Code** (project) | `.claude/skills/icpay/` | `mkdir -p .claude/skills && cp -r skills/icpay .claude/skills/` |
| **Claude Code** (personal) | `~/.claude/skills/icpay/` | `mkdir -p ~/.claude/skills && cp -r skills/icpay ~/.claude/skills/` |
| **Google Antigravity** (project) | `.agent/skills/icpay/` | `mkdir -p .agent/skills && cp -r skills/icpay .agent/skills/` |
| **Google Antigravity** (global) | `~/.gemini/antigravity/global_skills/icpay/` | `mkdir -p ~/.gemini/antigravity/global_skills && cp -r skills/icpay ~/.gemini/antigravity/global_skills/` |
| **Continue** | `.continue/rules/` | `mkdir -p .continue/rules && cp skills/icpay/SKILL.md .continue/rules/icpay.md` |
| **GitHub Copilot** | `.github/copilot-instructions.md` | `mkdir -p .github && cp skills/icpay/SKILL.md .github/copilot-instructions.md` |
| **Kiro (AWS)** | `.kiro/prompts/` (reference in agent config) | `mkdir -p .kiro/prompts && cp skills/icpay/SKILL.md .kiro/prompts/icpay.md` |
| **Trae** | `.trae/project_rules.md` | `mkdir -p .trae && cp skills/icpay/SKILL.md .trae/project_rules.md` |
| **Windsurf** | `.windsurfrules` (project root) | `cp skills/icpay/SKILL.md .windsurfrules` |

Cursor, Claude Code, and Antigravity use the full skill folder; the others use `SKILL.md` only. Full instructions: [skills/README.md](skills/README.md).

## TypeScript

- Fully typed with bundled `.d.ts`
- Named exports include `IcpayError`, `IcpayWallet`, events, and types
