# 🪶 Elevate — English Documentation

> **Interactive Polyglot Terminal Dashboard (TUI) for safe, selective, and transparent dependency management across monorepos and multi-project repositories.**  
> *Developed and maintained by **Dennis Répa**.*

---

## 🌟 Overview

**Elevate** is an interactive terminal dashboard (TUI) for safe, selective, and transparent dependency management across **polyglot monorepos** (Node/npm & Java/Maven) and single-package projects.

* **Feather Identity (`🪶`) & Orange Brand (`#FF8800`):** Clean, modern, and readable in any terminal.
* **Polyglot Architecture:** Seamlessly manages frontend workspaces (`package.json` with npm workspaces) and backend modules (`pom.xml` with Maven).
* **Release Channels:** Filters out pre-releases (Alpha, Beta, RC, Milestone, Snapshot) by default, suggesting only battle-tested production releases.
* **Animated Companion ("Pip" 🐣):** A delightful chicken mascot that reacts to actions and keeps you company in the terminal.
* **Bilingual i18n:** Toggle on the fly between English and German with the **`[L]`** key.

---

## ✨ Features & Highlights

1. **🌐 Polyglot Monorepo Support (npm & Maven):**
   * **Node / npm:** Discovers root and workspace packages, calculates SemVer diffs, updates `package.json`, and runs `npm install`.
   * **Java / Maven:** Scans the project tree for all `pom.xml` files (Spring Boot services, libraries, etc.), queries Maven Central, and verifies source code with `mvn test-compile`.
   * **Runtime Switch:** Press **`[E]`** anytime to switch between frontend and backend modules.

2. **🔍 Pick a Specific Version (`[V]`):**
   * You aren't restricted to upgrading only to `latest`: pressing **`[V]`** opens an interactive modal to browse and select any published version for the focused package.
   * Fetches the entire version history directly from the npm or Maven registry.
   * Real-time search/filtering as you type (e.g. `3.2` or `25`), arrow key navigation, and instant selection via `Enter`.
   * Manually chosen versions are marked with a `[MANUAL]` badge in the dashboard.

3. **🚦 Release Channels (`stable` vs. `all`):**
   * **`channel: "stable"` (Default):** Prevents accidental upgrades to pre-releases (`-alpha`, `-beta`, `-rc`, `-m1`, `-snapshot`).
   * **`channel: "all"`:** Displays all versions and highlights pre-releases with prominent magenta badges (`[BETA]`, `[RC]`, `[ALPHA]`).

4. **🛡️ Monorepo Symlink & Internal Scope Protection:**
   * Protects internal packages (e.g. `@my-org/*`, `com.mycompany.*`) from being overwritten by public registries.

5. **🐣 Animated Mascot ("Pip"):**
   * Positioned neatly in the bottom right corner of the dashboard.
   * State-reactive behavior:
     * *Idle:* Blinks gently or sips coffee in Java mode (`*sipping coffee* ☕`).
     * *Scanning:* Inspects dependencies with a magnifying glass (`( ˘ө˘ )🔍`).
     * *Building:* Rolls up its sleeves (`(ง •ө• )ง`).
     * *Success:* Celebrates with confetti (`\( ᵔөᵔ )/ 🎉`).

6. **🚀 Initial Splash Screen:**
   * A stylish intro screen with an animated progress bar (~3.2 seconds).
   * Can be skipped immediately at any time by pressing `[Space]` or `[Enter]`.

---

## 🏗️ Domain-Driven Clean Architecture

Elevate follows **Domain-Driven Design (DDD)** and **Hexagonal Architecture (Ports & Adapters)**. The UI and hooks never depend directly on a package manager:

```text
src/
├── domain/                      # 🧠 DOMAIN CORE (Pure domain logic, zero I/O)
│   ├── models.ts                #   Entities & Value Objects (ProjectModule, UpdateCandidate, etc.)
│   ├── ports.ts                 #   Domain Ports (ModuleDiscoveryPort, RegistryPort, etc.)
│   ├── ecosystem-strategy.ts    #   Strategy Pattern: Platform-agnostic interface
│   └── ecosystem-factory.ts     #   Factory Pattern: Resolves npm or Maven strategy
│
├── adapters/                    # 🔌 ADAPTERS (Concrete port implementations)
│   ├── npm/                     #   📦 Node / npm Adapters
│   │   ├── npm-discovery.ts     #     Reads workspaces from root package.json
│   │   ├── npm-registry.ts      #     npm registry queries & dist-tags
│   │   ├── npm-scanner.ts       #     Parses dependencies & SemVer diffs
│   │   ├── npm-updater.ts       #     Updates package.json & runs npm install
│   │   ├── npm-verifier.ts      #     Workspace check & test verification
│   │   └── npm-strategy.ts      #     NpmEcosystemStrategy
│   │
│   └── maven/                   #   ☕ Java / Maven Adapters
│       ├── maven-discovery.ts   #     Finds all pom.xml files in the repo tree
│       ├── maven-registry.ts    #     Maven Central metadata & release filters
│       ├── maven-scanner.ts     #     Parses dependencies, deduplication & properties
│       ├── maven-updater.ts     #     Updates pom.xml & runs mvn dependency:resolve
│       ├── maven-verifier.ts    #     mvn test-compile code verification
│       └── maven-strategy.ts    #     MavenEcosystemStrategy
│
├── hooks/                       # 🎣 APPLICATION HOOKS (Consume only domain ports)
│   ├── use-workspaces.ts        #     Module management via ModuleDiscoveryPort
│   ├── use-packages.ts          #     Scanning & filtering via DependencyReaderPort
│   └── use-updater.ts           #     Updating & verification via updater/verifier ports
│
├── components/                  # 🎨 PRESENTATIONAL UI (Pure rendering with Ink)
│   ├── header.tsx               #     Ecosystem [E], Channel [stable], Language [L], Author
│   ├── workspace-bar.tsx        #     Active module with static protection notice
│   ├── mascot.tsx               #     🐣 Animated companion ("Pip")
│   ├── status-bar.tsx           #     Rock-solid status bar with counts & mascot
│   ├── tab-bar.tsx              #     Ecosystem-specific tabs
│   ├── package-list.tsx         #     Scrollable list with orange accents
│   ├── package-row.tsx          #     Row with badges ([Patch], [Minor], [MAJOR], [BETA])
│   ├── controls-bar.tsx         #     Keyboard shortcuts
│   ├── workspace-modal.tsx      #     Modal selector for modules
│   ├── version-modal.tsx        #     🔍 Modal version search & picker
│   ├── splash-screen.tsx        #     Initial startup screen
│   ├── updating-view.tsx        #     Update progress display
│   └── summary-view.tsx         #     Final report summary
│
├── cli/                         # 💻 HEADLESS CLI SUBCOMMANDS (for CI/CD & Shell-Agents)
│   ├── parser.ts                #     Zero-dependency CLI argument parser
│   ├── command-modules.ts       #     `elevate modules`
│   ├── command-scan.ts          #     `elevate scan`
│   ├── command-versions.ts      #     `elevate versions`
│   └── command-update.ts        #     `elevate update`
│
├── mcp/                         # 🤖 MODEL CONTEXT PROTOCOL (MCP Server)
│   └── mcp-server.ts            #     Standard stdio MCP server exposing 5 tools
│
├── i18n/                        # 🌍 Localization dictionaries (de.ts / en.ts)
├── config.ts                    # ⚙️ Configuration loader
├── theme.ts                     # 🎨 Color tokens & icons
├── app.tsx                      # 📱 App Shell (Container)
└── index.tsx                    # 🏁 Universal entry point (TUI / CLI / MCP)
```

---

## 🤖 Agentic & CI/CD Support (Headless CLI & MCP)

Elevate is built from the ground up for agentic execution by AI coding assistants (Claude Code, Antigravity, Cursor, Copilot CLI) and automated CI/CD runners.

### 1. Headless CLI Subcommands (`--json`)

Any command line agent or pipeline can run Elevate without starting the interactive TUI:

```bash
# Discover modules in monorepo
node tools/updater/elevate/index.mjs modules --json

# Scan dependencies across all modules (exit code 1 if updates found)
node tools/updater/elevate/index.mjs scan --channel=stable --all-modules --json

# Query complete version history for a package
node tools/updater/elevate/index.mjs versions chalk --json

# Apply updates with safety guardrails (simulation via --dry-run)
node tools/updater/elevate/index.mjs update --module=apps/e2e-cockpit --packages=chalk@5.6.2 --dry-run --json

# Apply major updates (explicit permission required)
node tools/updater/elevate/index.mjs update --module=apps/e2e-cockpit --packages=pinia@4.0.3 --allow-major --json
```

### 2. Model Context Protocol (MCP) Server

Elevate provides a native, stdio-based MCP Server:
```bash
node tools/updater/elevate/index.mjs mcp
```

Register it in your agent's MCP settings (e.g., `claude_desktop_config.json` or Antigravity MCP config):
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
| Tool | Purpose |
| :--- | :--- |
| `elevate_discover_modules` | Discovers all repository modules and workspaces for npm or Maven |
| `elevate_scan` | Scans a module (or all modules) for available dependency updates |
| `elevate_get_versions` | Fetches complete published version history from registry |
| `elevate_apply_updates` | Applies targeted updates with verification & major guardrails |
| `elevate_verify` | Runs module-specific build and test verification checks |

---

## ⌨️ Keyboard Shortcuts (Interactive TUI)

| Key | Action |
| :--- | :--- |
| **`E`** | **Switch Ecosystem (📦 Node/npm ⇄ ☕ Java/Maven)** |
| **`W`** | Open module / workspace selector |
| **`V`** | **Pick specific version (Interactive search & filter modal)** |
| **`L`** | Toggle language (English ⇄ German) |
| **`↑` / `↓`** *(or `k`/`j`)* | Navigate list items |
| **`Space`** | Toggle selection of focused item |
| **`A`** | Toggle all visible items in the active tab |
| **`Tab`** *(or `1`, `2`, `3`)* | Switch between tabs |
| **`U`** | Start update for all selected items |
| **`R`** | Re-scan the active module |
| **`Q`** | Quit Elevate |

---

## ⚙️ Configuration (`elevate.config.json`)

You can place an optional `elevate.config.json` file in your repository root:

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

* **`author`:** Optional name displayed in the top-right header.
* **`channel`:** `"stable"` (default, excludes betas/RCs) or `"all"` (includes pre-releases).
* **`locale`:** `"en"` (English), `"de"` (German), or `"auto"` (system detection).
* **`excludeScopes`:** List of internal package prefixes protected from external registry lookups.
* **`postUpdateScript`:** Optional script executed after an npm update.

---

## 📦 Installation & Setup

Elevate offers multiple flexible options for any developer workflow or environment:

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
cd tools/updater/elevate
npm run build
npm link
```
Run directly from repo root:
```powershell
.\elevate.exe
# or
node tools/updater/elevate/dist/cli.js
```

---

## ☕ Support & Funding

Elevate is free, open-source software maintained to make dependency updates safe, fast, and transparent across multi-language monorepos. If Elevate saves you or your team valuable development time, you can support its creator and future feature development:

[![Support Dennis Répa on Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20Dennis%20R%C3%A9pa-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/dennisrepa)

* ☕ **[Buy Dennis a coffee on Ko-fi](https://ko-fi.com/dennisrepa)**
* 💻 Or run: `npm fund @dennisrepa/elevate`

