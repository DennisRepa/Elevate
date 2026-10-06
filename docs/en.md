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
   * **Node / npm:** Resolves workspaces exactly like npm (glob patterns such as `packages/**` included), calculates SemVer diffs, updates `package.json` (`dependencies`, `devDependencies`, `optionalDependencies`), runs `npm install` and checks the lockfile. Repositories managed by pnpm, Yarn or Bun are refused.
   * **Java / Maven:** Finds every `pom.xml` (including the root POM), lets Maven compute the effective POM, looks up newer versions through the build's own repositories (mirrors, Nexus/Artifactory, credentials from `settings.xml`) and verifies the affected modules with `mvn test-compile`.
   * **Runtime Switch:** Press **`[E]`** anytime to switch between frontend and backend modules.

2. **🔍 Pick a Specific Version (`[V]`):**
   * You aren't restricted to upgrading only to `latest`: pressing **`[V]`** opens an interactive modal to browse and select any published version for the focused package.
   * Fetches the entire version history directly from the npm or Maven registry.
   * Real-time search/filtering as you type (e.g. `3.2` or `25`), arrow key navigation, and instant selection via `Enter`.
   * Manually chosen versions are marked with a `[MANUAL]` badge in the dashboard.

3. **🚦 Release Channels (`stable` vs. `all`):**
   * **`channel: "stable"` (Default):** Prevents accidental upgrades to pre-releases (`-alpha`, `-beta`, `-rc`, `-m1`, `-snapshot`).
   * **`channel: "all"`:** Displays all versions and highlights pre-releases with prominent magenta badges (`[BETA]`, `[RC]`, `[ALPHA]`).

4. **🏢 Internal Dependencies (Workspace Modules & Private Registries):**
   * Workspace modules that depend on each other are kept in line with their local versions (`[Align]`).
   * Internal packages (`internalScopes`, e.g. `@my-org/*`, `com.mycompany.*`) are looked up only in private registries — never on a public one.
   * See [Internal Dependencies & Safety](#-internal-dependencies--safety) below.

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

## 🏢 Internal Dependencies & Safety

Every dependency is classified by **origin** before any registry is contacted:

| Origin | Recognised by | Version source | Action |
| :--- | :--- | :--- | :--- |
| `workspace` | A module discovered in this repository | The module's **local** version | `align` |
| `private` | `internalScopes`, or an explicit `@scope:registry` mapping in `.npmrc` | The private registry configured for it | `update` |
| `public` | Everything else | The configured registry | `update` |

The registry URL alone is deliberately **not** used to decide the origin: in most companies every request — public packages included — goes through one Artifactory or Nexus proxy.

### Aligning workspace modules

* **npm:** If a dependency's range does not include the local version of a workspace package, npm does **not** link the workspace — it installs a package with the same name from the registry. Elevate offers to align the range (e.g. `^1.0.0` ➔ `^2.0.0`). After `npm install` it checks `package-lock.json`: every aligned dependency must be `"link": true`, otherwise the update is rolled back. Ranges that npm always links (`*`, `file:`, `workspace:`) are left alone.
* **Maven:** If a module depends on a module of the *same reactor* with a different version (e.g. `1.0.0` while the module is at `1.1.0-SNAPSHOT`), Elevate offers to align it. `${project.version}` references need no alignment.
* The release channel does not apply to alignment: the local version — including `-SNAPSHOT` — is the target, because modules of one repository are built and tested together.

### Private registries & dependency confusion

* Internal packages are never looked up on a public registry. If the registry for an internal npm package resolves to `registry.npmjs.org`, it is listed as *not offered* with the reason, instead of being queried — asking a public registry about an internal name is exactly what a dependency-confusion attack exploits.
* npm lookups use your npm configuration (`npm config`), Maven lookups use Maven itself — mirrors, private repositories and credentials apply without any Elevate-specific configuration, and Elevate never handles credentials.

### Where Maven versions are written

Maven's effective POM tells which version applies, not where it is written. Elevate locates the declaring literal — a dependency `<version>`, a `<dependencyManagement>` entry, a property (possibly in a parent POM) or an external `<parent>` — and edits exactly that text, preserving formatting and comments. Before editing, the literal is cross-checked against the effective version; if they differ (active profiles, command-line properties) or the version comes from an external parent/BOM, the dependency is listed as *not offered* with the reason. Artifacts sharing one version property are marked, and conflicting targets for a shared property are rejected.

### Rollback

Every update runs as one workflow: **snapshot ➔ write & install ➔ integrity check ➔ verification**. If installation, the integrity check or verification fails, every touched file (manifests, lockfile, parent POMs) is restored and `node_modules` is reinstalled. `--keep-on-failure` (CLI) or `keepOnFailure` (MCP) keeps the changes of a failed *verification* for investigation. Verification also runs once *before* the update: if it already fails there, a failure afterwards is reported as pre-existing and the update is kept instead of rolled back. A crashing verifier counts as a failed verification.

### Verification

* **npm:** `npm ls` at the repository root (missing, invalid or unmet dependencies across all workspaces), unless `postUpdateScript` is set.
* **Maven:** `mvn test-compile -pl <changed modules> -amd` in the reactor — the changed modules *and every module depending on them*. A change to the aggregator POM rebuilds the whole reactor.

### Requirements for Maven

Elevate uses the project's Maven Wrapper (`mvnw` / `mvnw.cmd`) when present, otherwise `mvn` on the `PATH`. Without either, Maven scans fail with a clear message instead of guessing. Plugin versions are pinned for reproducible results (`maven-help-plugin` 3.5.2, `versions-maven-plugin` 2.22.0) and can be replaced per repository with `mavenPlugins` in `elevate.config.json` (see [Maven plugin versions](#maven-plugin-versions)). Scans write temporary files only to `target/.elevate-*` and remove them afterwards.

### Repository root

Elevate works the same wherever in the repository it is started. The root is found as follows:

1. The nearest directory (from the start directory upwards) with an `elevate.config.json` is the root.
2. Otherwise npm proposes the nearest directory whose `package.json` declares `workspaces`, and Maven proposes the top of the connected POM chain (a `<parent>` found through `<relativePath>` and any aggregator that lists the project in `<modules>`). The outermost proposal wins.
3. Without any marker the start directory is the root.

The search never leaves the version-control checkout: it stops at the nearest directory that contains a `.git` entry, so a stray `package.json` or `pom.xml` somewhere above the repository is never mistaken for its root. Manifests that cannot be parsed are skipped.

### Package manager guard (npm)

Elevate's Node.js support drives npm. In a repository managed by pnpm, Yarn or Bun it refuses to scan or change the npm modules, because `npm install` would create a second lockfile and a `node_modules` layout the project does not use. The package manager is recognised from the repository root, in this order: the `packageManager` field of `package.json` (`npm@`, `pnpm@`, `yarn@`, `bun@`), then `package-lock.json` / `npm-shrinkwrap.json`, `pnpm-lock.yaml` / `pnpm-workspace.yaml`, `yarn.lock` / `.yarnrc.yml`, `bun.lock` / `bun.lockb`; without any of them the repository is treated as npm. If Elevate is started inside a workspace package, the search continues in the parent directories up to the checkout (the nearest directory with a `.git` entry); without a checkout only the directory itself is examined. The refusal names the manager and the file that decided. Maven modules in the same repository, read-only version queries (`elevate versions`) and a custom `postUpdateScript` are not affected.

### Dependency sections (npm)

| Section | Scanned | Written |
| :--- | :---: | :---: |
| `dependencies`, `devDependencies`, `optionalDependencies` | yes | yes |
| `peerDependencies`, `overrides`, `bundleDependencies` | no | never |

A peer range tells consumers which versions a package works with; raising it because a newer version exists would be a breaking change nobody decided. A name declared in several scanned sections receives the new range in every one of them; for display, `optionalDependencies` take precedence over `dependencies` (as in npm), and a name that is also a development dependency is shown as one.

### Reactor-scoped alignment (Maven)

A dependency on another module is aligned to that module's local version only when both modules are built by the same outermost aggregator (the same reactor). Outside a reactor Maven resolves the dependency from a repository like any other artifact, even if a project with the same coordinates lies somewhere in the checkout (a sample, a fixture, an old copy), so such a dependency is looked up and offered as an ordinary update — `private` when it matches `internalScopes`, otherwise `public`. POM files below a project's `src` directory (test fixtures, `maven-invoker-plugin` projects, archetype templates) and below `node_modules`, `target`, `build`, `dist`, `out` or hidden directories are not modules, unless a `<modules>` section names them.

### Maven plugin versions

Elevate runs two Maven plugins: `maven-help-plugin` (reads the effective POM, default `3.5.2`) and `versions-maven-plugin` (looks up newer versions, default `2.22.0`). If your repository manager does not offer these versions, set others with `mavenPlugins` in `elevate.config.json`. A value must start with a digit and contain only letters, digits, `.` and `-` (at most 64 characters); anything else is replaced by the default and reported as a warning. When Maven cannot download a plugin, Elevate says so, names the plugin and the setting that replaces its version, and appends Maven's own error lines.

### Windows paths

On Windows `npm`, `mvn` and the Maven Wrapper are batch files that run through `cmd.exe`, which interprets `" % ! ^ & | < >` even inside quotes; Elevate refuses to put an argument containing one of them on a command line. The directory the repository lives in is handed to the process as its working directory and project files are named relative to it, so a path such as `C:\R&D\shop` works. Names *inside* the repository that end up on a command line (for example a module directory passed to `-pl`) must still avoid these characters; the error message names the argument and how to fix it.

---

## 🏗️ Domain-Driven Clean Architecture

Elevate follows **Domain-Driven Design (DDD)** and **Hexagonal Architecture (Ports & Adapters)**. The UI and hooks never depend directly on a package manager:

```text
src/
├── domain/                      # 🧠 DOMAIN CORE (Pure domain logic, zero I/O)
│   ├── models.ts                #   Entities & Value Objects (ProjectModule, UpdateCandidate, DependencyOrigin, …)
│   ├── origin.ts                #   Origin classification (workspace / private / public)
│   ├── versions.ts              #   Pre-release detection & version helpers
│   ├── ports.ts                 #   Domain Ports (ModuleDiscoveryPort, RegistryPort, etc.)
│   ├── ecosystem-strategy.ts    #   Strategy Pattern: Platform-agnostic interface
│   └── ecosystem-factory.ts     #   Factory Pattern: Resolves npm or Maven strategy
│
├── adapters/                    # 🔌 ADAPTERS (Concrete port implementations)
│   ├── shared/                  #   🧰 XML (position-aware), processes, snapshots, pooling
│   │
│   ├── npm/                     #   📦 Node / npm Adapters
│   │   ├── npm-config.ts        #     Effective npm config (registries per scope)
│   │   ├── npm-discovery.ts     #     Workspaces via @npmcli/map-workspaces
│   │   ├── npm-registry.ts      #     npm view queries & dist-tags
│   │   ├── npm-scanner.ts       #     Origins, alignment, SemVer diffs
│   │   ├── npm-lockfile.ts      #     Workspace link check in package-lock.json
│   │   ├── npm-package-manager.ts #   Package manager detection & guard
│   │   ├── npm-updater.ts       #     Updates package.json & runs npm install
│   │   ├── npm-verifier.ts      #     npm ls / custom verification
│   │   └── npm-strategy.ts      #     NpmEcosystemStrategy
│   │
│   └── maven/                   #   ☕ Java / Maven Adapters
│       ├── maven-command.ts     #     Maven Wrapper / mvn invocation
│       ├── maven-pom.ts         #     Raw POM model with editable element ranges
│       ├── maven-project.ts     #     All POMs of the repo, parent chains, reactors
│       ├── maven-discovery.ts   #     Modules incl. root POM, versions, aggregator
│       ├── maven-resolution.ts  #     Effective POM & versions-maven-plugin report
│       ├── maven-locator.ts     #     Finds where a version is declared
│       ├── maven-scanner.ts     #     Origins, alignment, update candidates
│       ├── maven-registry.ts    #     `elevate versions` via Maven (any Nexus/Artifactory)
│       ├── maven-updater.ts     #     Formatting-preserving POM edits
│       ├── maven-verifier.ts    #     mvn test-compile -pl … -amd
│       └── maven-strategy.ts    #     MavenEcosystemStrategy
│
├── application/                 # 🧭 USE CASES shared by TUI, CLI and MCP
│   ├── scan.ts                  #     Scan context, module lookup, JSON output
│   ├── update-selection.ts      #     Guardrails for requested updates
│   ├── update-workflow.ts       #     Snapshot ➔ install ➔ integrity ➔ verify ➔ rollback
│   └── version-lookup.ts        #     Version history without public lookups of internal names
│
├── hooks/                       # 🎣 APPLICATION HOOKS (Consume only domain ports)
│   ├── use-workspaces.ts        #     Module management via ModuleDiscoveryPort
│   ├── use-packages.ts          #     Scanning & filtering via DependencyReaderPort
│   └── use-updater.ts           #     Runs the shared update workflow
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

# Scan dependencies across all modules
# (exit code 0 = up to date, 1 = updates available, 3 = a module could not be scanned)
node tools/updater/elevate/index.mjs scan --channel=stable --all-modules --json

# Query complete version history for a package
node tools/updater/elevate/index.mjs versions chalk --json

# Apply updates with safety guardrails (simulation via --dry-run)
node tools/updater/elevate/index.mjs update --module=apps/e2e-cockpit --packages=chalk@5.6.2 --dry-run --json

# Apply major updates (explicit permission required)
node tools/updater/elevate/index.mjs update --module=apps/e2e-cockpit --packages=pinia@4.0.3 --allow-major --json

# Keep the changes if verification fails (default: roll back)
node tools/updater/elevate/index.mjs update --module=apps/web --all --keep-on-failure
```

`scan --json` lists, per module, the `updates` (with `action`, `origin` and — for Maven — `declaredIn`) and the `skipped` dependencies with their `reason`. `update` exits with `2` when the update failed and was rolled back.

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
| `elevate_scan` | Scans a module (or all modules) for updates and internal dependencies to align; lists skipped dependencies with reasons |
| `elevate_get_versions` | Fetches complete published version history from registry (refuses public lookups of internal packages) |
| `elevate_apply_updates` | Applies targeted updates with verification, major guardrails and rollback (`keepOnFailure` optional) |
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
  "internalScopes": ["@my-org", "com.mycompany"],
  "mavenPlugins": { "help": "3.5.2", "versions": "2.22.0" },
  "postUpdateScript": "npm test",
  "postUpdateLabel": "Run test suite"
}
```

* **`author`:** Optional name displayed in the top-right header.
* **`channel`:** `"stable"` (default, excludes betas/RCs) or `"all"` (includes pre-releases).
* **`locale`:** `"en"` (English), `"de"` (German), or `"auto"` (system detection).
* **`internalScopes`:** Internal npm scopes and Maven groupId prefixes. `@my-org` matches `@my-org/*`; `com.mycompany` matches `com.mycompany` and `com.mycompany.*` (not `com.mycompanyx`). Matching packages are looked up only in private registries. *Formerly `excludeScopes`, which is still read and reported as deprecated.*
* **`mavenPlugins`:** Optional versions of the Maven plugins Elevate runs: `help` (`maven-help-plugin`, default `3.5.2`) and `versions` (`versions-maven-plugin`, default `2.22.0`). Use it when your repository manager does not offer the defaults. Invalid values fall back to the default with a warning.
* **`postUpdateScript`:** Optional command that replaces the default verification (`npm ls` / `mvn test-compile`). Runs in the repository root (npm) or the module directory (Maven).

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

