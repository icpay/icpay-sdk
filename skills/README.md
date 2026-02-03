# ICPay Skills

This folder contains **Cursor Agent Skills** for the ICPay project: instruction manuals so AI models can work effectively with this codebase.

**Repository:** [https://github.com/icpay/icpay-sdk](https://github.com/icpay/icpay-sdk). **npm:** [@ic-pay/icpay-sdk](https://www.npmjs.com/package/@ic-pay/icpay-sdk) (SDK), [@ic-pay/icpay-widget](https://www.npmjs.com/package/@ic-pay/icpay-widget) (widget). Anyone who clones this repo gets the skill; `git pull` keeps it updated.

---

## IDE / agent setup (copy-paste)

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

**Full skill folder** (with `reference.md`, `widget-reference.md`, etc.): Cursor, Claude Code, Antigravity. **Single file** (`SKILL.md`): Continue, Copilot, Kiro, Trae, Windsurf. **Kiro:** reference `file://.kiro/prompts/icpay.md` in your agent’s prompt config.
---

## Where Cursor looks for skills

Cursor does **not** read from `skills/` by default. It only loads skills from:

| Type    | Path                          | Scope                          |
|---------|-------------------------------|--------------------------------|
| Project | **`.cursor/skills/skill-name/`** (inside this repo) | Everyone using the repository  |
| Personal| **`~/.cursor/skills/skill-name/`**                  | All your projects on this machine |

To have Cursor use the icpay skill:

1. **Symlink (recommended)** — keeps the skill updated when you `git pull` in icpay-sdk:
   ```bash
   git clone https://github.com/icpay/icpay-sdk
   cd icpay-sdk
   mkdir -p ~/.cursor/skills
   ln -s $(pwd)/skills/icpay ~/.cursor/skills/icpay
   ```
   From another project: `mkdir -p .cursor/skills && ln -s /path/to/icpay-sdk/skills/icpay .cursor/skills/icpay`
2. **Copy** (if you can't symlink):
   ```bash
   mkdir -p ~/.cursor/skills
   cp -r skills/icpay ~/.cursor/skills/icpay
   ```
   From another project: `mkdir -p .cursor/skills && cp -r /path/to/icpay-sdk/skills/icpay .cursor/skills/icpay`

**Do not** put skills in `~/.cursor/skills-cursor/` — that directory is reserved for Cursor's built-in skills.

---

## How AI agents use skills

1. **Discovery** — Cursor has access to each skill’s **description** (the YAML `description` in `SKILL.md`). It uses those descriptions to decide **when** a skill is relevant (e.g. user asks about “payment links” or “icpay-widget”).
2. **Application** — When a skill is considered relevant, Cursor loads that skill’s **content**: the main `SKILL.md` (and optionally linked files like `reference.md`) and adds it to the context the model sees. The model then follows the instructions and conventions in that content.
3. **Learning** — The agent doesn’t “remember” the skill between sessions; it **uses** the skill each time the description matches the current task. So the skill acts as an always-available instruction manual in context.

So: **good descriptions with clear trigger terms** (e.g. “relay payments”, “X402”, “demo.icpay.org”) make the skill get applied in the right conversations; **concise, actionable SKILL.md and references** make the agent behave correctly when the skill is applied.

---

## How skills get updated (GitHub and Cursor)

**Agents do not monitor GitHub.** Cursor (and similar tools) load skills only from **local paths** (`.cursor/skills/` or `~/.cursor/skills/`). They do not fetch, poll, or sync from a remote URL.

**How updates work:**

1. You change the skill in this repo (icpay-sdk) and push to GitHub.
2. Users update their local copy:
   - **Symlink from icpay-sdk:** Run `git pull` in the icpay-sdk repo — the skill updates automatically (Cursor reads the symlinked folder).
   - **Copy into `~/.cursor/skills/icpay`:** Re-copy after pulling (e.g. `cd icpay-sdk && git pull && cp -r skills/icpay ~/.cursor/skills/icpay`).
3. Cursor always reads from the **local path**; there is no automatic "check for updates" from GitHub.

**Canonical source:** The `source` field in `icpay/SKILL.md` points to `https://github.com/icpay/icpay-sdk/tree/master/skills/icpay`. npm: **@ic-pay/icpay-sdk**, **@ic-pay/icpay-widget**.

---

## Skills in this folder

### icpay

**Path:** `icpay/`
**When to use:** Working with @ic-pay/icpay-sdk, @ic-pay/icpay-widget, payment links, relay payments, X402, refunds, splits, webhooks, demo.icpay.org, WordPress plugins, or any ICPay-related code.

**Contents:**

- **SKILL.md** — Main instructions: project layout, keys, SDK, widget, payment links, accounts, webhooks, relay, X402, refunds, splits, email notifications, demo, conventions.
- **reference.md** — API surface, entities, workers, relay, X402, splits, refunds.
- **widget-reference.md** — Web Components, wallet adapters, filter tokens/chains, options, events, theming, QR/deep links, demo.
- **wordpress.md** — WordPress plugins: setup, webhook URLs, building embed script, shortcodes/blocks, PHP classes.
