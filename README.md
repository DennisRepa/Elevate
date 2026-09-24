# 🪶 Elevate

> **Interactive Polyglot Terminal Dashboard (TUI) for safe, selective, and transparent dependency management across monorepos and multi-project repositories.**  
> *Developed and maintained by **Dennis Répa**.*  
> [![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20Dennis%20R%C3%A9pa-F16061?logo=ko-fi&logoColor=white)](https://ko-fi.com/dennisrepa)

---

## 📖 Documentation

Comprehensive documentation is available in the [`docs/`](./docs/) directory:

* 🇬🇧 **[Comprehensive Documentation in English](./docs/en.md)** — Architecture, release channels, safety mechanisms, headless CLI, MCP server, and configuration.
* 🇩🇪 **[Ausführliche Dokumentation auf Deutsch](./docs/de.md)** — Vollständige Anleitung, Architektur, Release Channels, Monorepo-Schutz und Konfiguration.

---

## ⚡ Highlights at a Glance

* **🪶 Brand Identity:** Modern orange terminal styling (`#FF8800`) with feather symbolism.
* **🌐 Polyglot Monorepo Support:** Seamlessly manages frontend workspaces (Node/npm `package.json`) and backend services (Java/Maven `pom.xml`) in a single tool.
* **🔍 Search & Pick Specific Versions:** Press **`[V]`** to open an interactive search modal for all versions ever published for the focused package.
* **⌨️ Runtime Ecosystem Switching:** Press **`[E]`** anytime to switch between npm and Maven modules on the fly.
* **🚦 Release Channels:** Default is `stable` (filters out alpha, beta, rc, milestone, and snapshot builds) — toggleable to `all` with visual badges.
* **🐣 Animated Mascot ("Pip"):** Blinks, inspects packages with a magnifying glass, rolls up its sleeves, and celebrates clean builds.
* **🌍 Bilingual i18n:** Press **`[L]`** anytime to switch between English and German.
* **🛡️ Monorepo Scope Protection:** Internal packages (`@my-org/*`, `com.mycompany.*`) and symlinks are protected from public registry overrides.
* **🤖 Agentic & CI/CD Ready:** Full headless CLI (`--json`) and native Model Context Protocol (MCP) server for autonomous AI coding agents.
* **🏗️ Clean & Domain-Driven Architecture:** Decoupled hexagonal ports & adapters, strategy, and factory patterns.

---

## 📦 Installation & Quick Start

Elevate provides several flexible options to fit any workflow, developer setup, or CI/CD environment:

### 1. ⚡ Zero-Install Instant Run via `npx` (Recommended)
Run Elevate immediately without cloning or installing anything:
```bash
npx @dennisrepa/elevate
```
> **For Autonomous AI Agents (Claude Code, Cursor, Antigravity):**  
> Register Elevate directly in your agent's MCP settings:
> ```json
> {
>   "mcpServers": {
>     "elevate": {
>       "command": "npx",
>       "args": ["-y", "@dennisrepa/elevate", "mcp"]
>     }
>   }
> }
> ```

---

### 2. 🪟 Standalone Executable (Zero Node.js Required)
For Java/Backend developers, system administrators, or CI environments without Node.js:
1. Download `elevate.exe` (Windows) or `elevate-linux` from the **[GitHub Releases](https://github.com/dennisrepa/elevate/releases)**.
2. Run directly in your terminal:
   ```powershell
   .\elevate.exe
   ```
   *(Or double-click `elevate.exe` in Windows Explorer).*

---

### 3. 🌍 Global System Installation
Install Elevate globally to have the `elevate` command available in every terminal:
```bash
npm install -g @dennisrepa/elevate
```
Then launch anywhere:
```bash
elevate
```

---

### 4. 🏢 Monorepo & Project Integration
Add Elevate as a devDependency to your project or monorepo:
```bash
npm install -D @dennisrepa/elevate
```
Add an `elevate` script to your root `package.json`:
```json
{
  "scripts": {
    "elevate": "elevate"
  }
}
```
Now every team member can launch the dashboard using:
```bash
npm run elevate
```

---

### 5. 🛠️ Local Development & Contributing (Inside this Repo)
If you are developing or customizing Elevate locally:
```bash
# Navigate to the tool directory
cd tools/updater/elevate

# Build the production bundle
npm run build

# Link globally for local testing
npm link
```
Run directly from repo root:
```powershell
.\elevate.exe
# or
node tools/updater/elevate/dist/cli.js
```

---

## ⌨️ Key Shortcuts (Interactive TUI)

| Key | Action |
| :--- | :--- |
| **`E`** | **Switch Ecosystem (`📦 npm` ⇄ `☕ Maven`)** |
| **`W`** | Open Module / Workspace Selector |
| **`V`** | **Pick Specific Version (Interactive search & filter modal)** |
| **`L`** | Toggle Language (`English` ⇄ `Deutsch`) |
| **`↑` / `↓`** *(or `k`/`j`)* | Navigate item list |
| **`Space`** | Toggle selection of focused package |
| **`A`** | Toggle all visible items in the active tab |
| **`Tab`** *(or `1`, `2`, `3`)* | Switch between tabs |
| **`U`** | Start update for selected packages |
| **`R`** | Re-scan current module |
| **`Q`** | Quit Elevate |

---

## 🤖 Agentic & CI/CD Usage (Headless CLI & MCP)

Elevate is built from the ground up for autonomous AI Agents (Claude Code, Antigravity, Cursor, Copilot) and automated CI/CD runners.

### 1. Headless CLI Subcommands (`--json`)

Execute non-interactive commands directly from shell scripts or pipelines:

```bash
# Discover all modules in the monorepo
node tools/updater/elevate/index.mjs modules --json

# Scan dependencies for available updates (exits with code 1 if updates found)
node tools/updater/elevate/index.mjs scan --ecosystem=npm --channel=stable --json

# Query complete published version history for a package
node tools/updater/elevate/index.mjs versions chalk --json

# Simulate updates without modifying files (--dry-run)
node tools/updater/elevate/index.mjs update --module=apps/e2e-cockpit --packages=chalk@5.6.2 --dry-run --json

# Apply major updates (explicit safety approval required)
node tools/updater/elevate/index.mjs update --module=apps/e2e-cockpit --packages=pinia@4.0.3 --allow-major --json
```

### 2. Model Context Protocol (MCP) Server

Start Elevate as a standard stdio MCP Server:
```bash
node tools/updater/elevate/index.mjs mcp
```

Add to your MCP configuration (e.g. `claude_desktop_config.json` or Antigravity MCP settings):
```json
{
  "mcpServers": {
    "elevate": {
      "command": "npx",
      "args": ["-y", "@dennisrepa/elevate", "mcp"]
    }
  }
}
```

#### Available MCP Tools for LLMs:
* `elevate_discover_modules`: Discovers repository modules and workspaces.
* `elevate_scan`: Scans dependencies for outdated packages against registries.
* `elevate_get_versions`: Fetches complete version history from registry.
* `elevate_apply_updates`: Applies targeted updates with verification & major guardrails.
* `elevate_verify`: Runs module-specific build and test verification checks.

---

## ⚙️ Configuration

Elevate works out of the box with zero configuration. You can customize settings via an optional `elevate.config.json` in your repository root:

```json
{
  "author": "Dennis Répa",
  "channel": "stable",
  "locale": "en",
  "excludeScopes": ["@my-org", "com.mycompany"],
  "postUpdateScript": "npm test",
  "postUpdateLabel": "Run test suite"
}
```

*For detailed explanations of all configuration options, refer to [`docs/en.md`](./docs/en.md) or [`docs/de.md`](./docs/de.md).*

---

## ☕ Support & Funding

Elevate is free, open-source software maintained to make dependency updates safe, fast, and transparent across multi-language monorepos. If Elevate saves you or your team valuable development time, you can support its creator and future feature development:

[![Support Dennis Répa on Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20Dennis%20R%C3%A9pa-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/dennisrepa)

* ☕ **[Buy Dennis a coffee on Ko-fi](https://ko-fi.com/dennisrepa)**
* 💻 Or run: `npm fund @dennisrepa/elevate`

