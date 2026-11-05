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

* **Polyglot Monorepo Support:** Manages frontend workspaces (`package.json`) and backend services (`pom.xml`, `build.gradle`, `Cargo.toml`) in a single tool.
* **Targeted Version Selection:** Interactive modal to search, filter, and pick any published version (`[V]`), not just `latest`.
* **Runtime Ecosystem Switching:** Switch instantly between Node.js, Maven, Cargo and Gradle modules (`[E]`).
* **Release Channels:** Configurable channels (`stable` vs. `all`) with automatic filtering of pre-releases (alpha, beta, rc, snapshot).
* **Internal Dependencies:** Aligns workspace modules to their local versions and looks up internal packages (`@my-org/*`, `com.mycompany.*`) only in private registries — never on a public one.
* **Rollback on Failure:** If installation, the workspace link check or verification fails, every touched file is restored.
* **Safety Guardrails & Verification:** Automatic post-update verification (`npm install`, `mvn test-compile`, `gradle testClasses`) with rollback safety and major-version warnings.
* **Agentic & CI/CD Ready:** Full headless CLI (`--json`) and native Model Context Protocol (MCP) server for integration with autonomous AI coding agents.
* **Bilingual Interface:** Instant language toggle between English and German (`[L]`).
* **Modular Architecture:** Decoupled domain core and ports/adapters (hexagonal architecture).

---

## 📦 Supported Package Managers

| Ecosystem | Package Manager | Manifest File | Primary Registry | Monorepo Support | Verification Method | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **Node.js** (JS / TS) | `npm` | `package.json` | Configured npm registry (`.npmrc`) | Root & npm Workspaces (glob patterns) | `npm install` + `npm ls` | ✅ Supported |
| **Node.js** (JS / TS) | `pnpm` (9 – 12) | `package.json` | Registry configured for pnpm (`.npmrc`) | Root & `pnpm-workspace.yaml` (patterns, catalogs) | `pnpm install` + `pnpm install --frozen-lockfile --lockfile-only` | ✅ Supported |
| **Java** (JVM) | `Maven` (`mvnw` / `mvn`) | `pom.xml` | Repositories & mirrors from Maven's own settings | Root POM, reactor & parent POMs | `mvn test-compile -amd` | ✅ Supported |
| **Rust** | `Cargo` | `Cargo.toml` | Registry of the project's Cargo configuration (sparse index, mirrors via source replacement) | Workspaces, path dependencies, `workspace = true` inheritance | `cargo check --all-targets` | ✅ Supported |
| **Java** (JVM) | `Gradle` (`gradlew` / `gradle`) | `build.gradle`, `build.gradle.kts`, `settings.gradle(.kts)`, `gradle/libs.versions.toml` | Repositories the build itself declares, with its mirrors and credentials | Projects of the settings, included builds & `buildSrc` | `gradle testClasses` of the affected projects | ✅ Supported |

> **Planned:** Support for Python (`pip`, `poetry`, `uv`) and `yarn` is on the roadmap.

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
| **`E`** | Switch Ecosystem (`npm` → `Maven` → `Cargo` → `Gradle`) |
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
elevate versions org.slf4j:slf4j-api --ecosystem=gradle --json

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

* **npm and pnpm for Node.js.** Elevate drives npm and pnpm (pnpm 9 to 12, `lockfileVersion` 9). Repositories managed by Yarn or Bun are refused (scans and updates say why and change nothing); Maven modules in the same repository still work.
* **pnpm specifics.** `catalog:` entries are updated where they are declared, in `pnpm-workspace.yaml`. A plain range on a workspace module (`^1.0.0`) is listed as *not linked* and never rewritten to `workspace:`, because pnpm resolves it from the registry. Elevate does not read pnpm settings such as `minimumReleaseAge` or the approval of build scripts, so pnpm may refuse an offered version; the update is then rolled back with pnpm's message. pnpm 8 and older, Windows and `shared-workspace-lockfile=false` are not covered.
* **Broken configuration stops Elevate.** An `elevate.config.json` that is not valid JSON, not an object, or whose `internalScopes` is not a list of strings is reported and Elevate exits with code `1`, because ignoring it would switch off the protection of internal packages. Without any configuration file Elevate works with defaults.
* **Dependency sections.** `dependencies`, `devDependencies` and `optionalDependencies` are covered. `peerDependencies` and `overrides` are never changed.
* **Cargo.** Requirements are raised keeping their precision, so a loose `"1"` only shows breaking updates; wildcard and compound requirements (`*`, `>=1.2, <2`), git and external path dependencies are left alone. Lock-file-only updates (`[Lock]`) are offered for direct dependencies when `Cargo.lock` is behind a requirement that already allows a newer release; transitive crates are not, and a crate with a pending manifest update shows only that candidate. Registries that need authentication and `[patch]` sections are not covered; a vendored or local-registry source replacement is refused rather than bypassed.
* **Maven.** Maven plugin versions and declarations inside `<profiles>` are not offered. Dependencies whose version is declared outside the repository (an external parent or BOM) are listed as *not offered* with the reason.
* **Gradle.** Gradle 7.6 and newer, Groovy and Kotlin DSL, run with the build's own wrapper or `gradle` on the `PATH` (a JDK is needed). A version is changed where its text is found: literals in the build scripts, `gradle.properties`, `ext` and local variables, `gradle/libs.versions.toml` and the `plugins` block. Dynamic and rich versions (`1.+`, `[1.0,2.0)`, `strictly`, `reject`, `prefer`), computed versions and versions that only a convention plugin in `buildSrc` or an included build, an `apply from:` script or another catalog defines are listed as *not offered*. The Gradle Wrapper itself is never updated. `gradle/verification-metadata.xml` is never regenerated, so a build that uses it rolls such an update back. Dependency locks are refreshed for the root build only; an update in an included build or `buildSrc` that has lock files is refused. Android and Kotlin Multiplatform builds are not verified. Windows is not verified.

---

## 📄 License & Sponsorship

Elevate is open-source software licensed under the [MIT License](./LICENSE).

* **Ko-fi:** [Support on Ko-fi](https://ko-fi.com/dennisrepa)
* **npm:** `npm fund @dennisrepa/elevate`

