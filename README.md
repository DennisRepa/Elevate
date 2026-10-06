# Elevate

> **Interactive Polyglot Terminal Dashboard (TUI) and MCP Server for safe, selective, and transparent dependency management across monorepos and multi-project repositories.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@dennisrepa/elevate.svg)](https://www.npmjs.com/package/@dennisrepa/elevate)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-F16061?logo=ko-fi&logoColor=white)](https://ko-fi.com/dennisrepa)

---

## 📖 Documentation

* 🇬🇧 **[English Documentation](./docs/en.md)** — Architecture, release channels, safety mechanisms, headless CLI, MCP server, and configuration.
* 🇩🇪 **[Deutsche Dokumentation](./docs/de.md)** — Vollständige Anleitung, Architektur, Release Channels, Monorepo-Schutz und Konfiguration.

---

## ✨ Key Features

* **Polyglot Monorepo Support:** Manages frontend workspaces (`package.json`) and backend services (`pom.xml`) in a single tool.
* **Targeted Version Selection:** Interactive modal to search, filter, and pick any published version (`[V]`), not just `latest`.
* **Runtime Ecosystem Switching:** Switch instantly between Node.js and Maven modules (`[E]`).
* **Release Channels:** Configurable channels (`stable` vs. `all`) with automatic filtering of pre-releases (alpha, beta, rc, snapshot).
* **Internal Dependencies:** Aligns workspace modules to their local versions and looks up internal packages (`@my-org/*`, `com.mycompany.*`) only in private registries — never on a public one.
* **Rollback on Failure:** If installation, the workspace link check or verification fails, every touched file is restored.
* **Safety Guardrails & Verification:** Automatic post-update verification (`npm install`, `mvn test-compile`) with rollback safety and major-version warnings.
* **Agentic & CI/CD Ready:** Full headless CLI (`--json`) and native Model Context Protocol (MCP) server for integration with autonomous AI coding agents.
* **Bilingual Interface:** Instant language toggle between English and German (`[L]`).
* **Modular Architecture:** Decoupled domain core and ports/adapters (hexagonal architecture).

---

## 📦 Supported Package Managers

| Ecosystem | Package Manager | Manifest File | Primary Registry | Monorepo Support | Verification Method | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **Node.js** (JS / TS) | `npm` | `package.json` | Configured npm registry (`.npmrc`) | Root & npm Workspaces (glob patterns) | `npm install` + `npm ls` | ✅ Supported |
| **Java** (JVM) | `Maven` (`mvnw` / `mvn`) | `pom.xml` | Repositories & mirrors from Maven's own settings | Root POM, reactor & parent POMs | `mvn test-compile -amd` | ✅ Supported |

> **Planned:** Support for Python (`pip`, `poetry`, `uv`), `pnpm`, `yarn`, and `Gradle` is on the roadmap.

---

## 🚀 Installation & Quick Start

### 1. Instant Run via `npx` (No Installation Required)
```bash
npx @dennisrepa/elevate
```

> **For AI Agents (Claude Code, Cursor, Antigravity):**  
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

### 2. Standalone Binary (Zero Node.js Dependency)
For environments without a Node.js runtime:
1. Download `elevate.exe` (Windows) or `elevate-linux` from [GitHub Releases](https://github.com/DennisRepa/Elevate/releases).
2. Execute directly:
   ```powershell
   .\elevate.exe
   ```

---

### 3. Global Installation
```bash
npm install -g @dennisrepa/elevate
elevate
```

---

### 4. Project Integration
Add as a development dependency:
```bash
npm install -D @dennisrepa/elevate
```

Add an entry to `package.json`:
```json
{
  "scripts": {
    "elevate": "elevate"
  }
}
```

Run via:
```bash
npm run elevate
```

---

### 5. Local Development
```bash
npm install
npm run build
npm link
```

Run locally:
```bash
elevate
# or
node dist/cli.js
```

---

## ⌨️ Keyboard Shortcuts (Interactive TUI)

| Key | Action |
| :--- | :--- |
| **`E`** | Switch Ecosystem (`npm` ⇄ `Maven`) |
| **`W`** | Open Module / Workspace Selector |
| **`V`** | Pick Specific Version (Interactive search & filter modal) |
| **`L`** | Toggle Language (`English` ⇄ `Deutsch`) |
| **`↑` / `↓`** *(or `k`/`j`)* | Navigate package list |
| **`Space`** | Toggle selection of focused package |
| **`A`** | Toggle selection of all visible packages in the active tab |
| **`Tab`** *(or `1`, `2`, `3`)* | Switch between tabs |
| **`U`** | Execute update for selected packages |
| **`R`** | Re-scan current module |
| **`Q`** | Quit Elevate |

---

## 🤖 Headless CLI & MCP Server

### 1. Headless CLI (`--json`)

Run non-interactive commands for scripting and CI/CD pipelines:

```bash
# Discover all modules in the repository
elevate modules --json

# Scan dependencies for available updates (exits with code 1 if updates found)
elevate scan --ecosystem=npm --channel=stable --json

# Query complete published version history for a package
elevate versions chalk --json

# Dry-run update simulation without modifying files
elevate update --module=apps/web --packages=chalk@5.6.2 --dry-run --json

# Apply updates with explicit major-version approval
elevate update --module=apps/web --packages=pinia@4.0.3 --allow-major --json
```

### 2. Model Context Protocol (MCP) Server

Start Elevate as an MCP server via stdio:
```bash
elevate mcp
```

MCP Configuration (e.g. `claude_desktop_config.json`):
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

#### Available MCP Tools:
* `elevate_discover_modules`: Discovers repository modules and workspaces.
* `elevate_scan`: Scans dependencies for outdated packages against registries.
* `elevate_get_versions`: Fetches published version history from registry.
* `elevate_apply_updates`: Applies targeted updates with verification and guardrails.
* `elevate_verify`: Runs module-specific build and test verification checks.

---

## ⚙️ Configuration

Elevate operates with zero configuration by default. Optional settings can be defined in `elevate.config.json` in the repository root:

```json
{
  "channel": "stable",
  "locale": "en",
  "internalScopes": ["@my-org", "com.mycompany"],
  "mavenPlugins": { "help": "3.5.2", "versions": "2.22.0" },
  "postUpdateScript": "npm test",
  "postUpdateLabel": "Run test suite"
}
```

Detailed parameter references are available in [`docs/en.md`](./docs/en.md) and [`docs/de.md`](./docs/de.md).

---

## 🧭 Scope and known limits

* **npm only for Node.js.** Elevate drives npm. Repositories managed by pnpm, Yarn or Bun are refused (scans and updates say why and change nothing); Maven modules in the same repository still work.
* **Broken configuration stops Elevate.** An `elevate.config.json` that is not valid JSON, not an object, or whose `internalScopes` is not a list of strings is reported and Elevate exits with code `1`, because ignoring it would switch off the protection of internal packages. Without any configuration file Elevate works with defaults.
* **Dependency sections.** `dependencies`, `devDependencies` and `optionalDependencies` are covered. `peerDependencies` and `overrides` are never changed.
* **Maven.** Maven plugin versions and declarations inside `<profiles>` are not offered. Dependencies whose version is declared outside the repository (an external parent or BOM) are listed as *not offered* with the reason.

---

## 📄 License & Sponsorship

Elevate is open-source software licensed under the [MIT License](./LICENSE).

* **Ko-fi:** [Support on Ko-fi](https://ko-fi.com/dennisrepa)
* **npm:** `npm fund @dennisrepa/elevate`

