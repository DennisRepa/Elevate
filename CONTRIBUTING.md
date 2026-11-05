# Contributing to 🪶 Elevate

Thank you for your interest in contributing to Elevate! We welcome bug reports, feature suggestions, documentation improvements, and pull requests.

---

## 🛠️ Development Setup

### Prerequisites
* **Node.js**: `>= 20.0.0` (Node 22 recommended)
* **npm**: `>= 10.0.0`

### Setup Instructions
1. Clone the repository:
   ```bash
   git clone https://github.com/dennisrepa/elevate.git
   cd elevate
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development dashboard:
   ```bash
   npm run dev
   ```

---

## 🏗️ Building & Verification

* **Type checking**:
  ```bash
  npx tsc --noEmit
  ```
* **Build production bundle**:
  ```bash
  npm run build
  ```
* **Test the compiled CLI**:
  ```bash
  node dist/cli.js --help
  node dist/cli.js modules --json
  ```
* **Link globally for local testing**:
  ```bash
  npm link
  ```

---

## 📐 Architecture & Principles

Elevate is built upon **Domain-Driven Design (DDD)** and **Hexagonal Architecture (Ports & Adapters)**:

* **`src/domain/`**: Pure domain logic, models, ports, and ecosystem strategies. Zero external dependencies or direct I/O.
* **`src/adapters/`**: Infrastructure implementations for npm and Maven (discovery, registry, scanning, updating, verification).
* **`src/hooks/`**: React/Ink state management and application orchestrators.
* **`src/components/`**: Presentational TUI components styled with the `#FF8800` brand theme.
* **`src/cli/`**: Zero-dependency headless CLI subcommands (`modules`, `scan`, `versions`, `update`).
* **`src/mcp/`**: Model Context Protocol (MCP) server for autonomous AI coding agents.
* **`src/i18n/`**: Bilingual dictionary (German & English).

When contributing code, please ensure all new domain logic resides within domain models/ports, keeping adapters isolated.

---

## 📋 Pull Request Guidelines

1. Ensure TypeScript compiles without errors: `npx tsc --noEmit`.
2. Build the bundle and verify CLI commands work cleanly: `npm run build`.
3. Use a [Conventional Commit](https://www.conventionalcommits.org) title for your pull request (see below). It is checked automatically.
4. If adding new user-facing options or strings, update both `src/i18n/locales/en.ts` and `src/i18n/locales/de.ts`.

---

## 🚀 Commits & Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please). Pull requests are **squash-merged**, so the **PR title** becomes the commit message and decides the next version ([SemVer](https://semver.org)):

| Title | Version bump |
| :--- | :--- |
| `fix: …` | patch (1.3.0 → 1.3.1) |
| `feat: …` | minor (1.3.0 → 1.4.0) |
| `feat!: …` or a `BREAKING CHANGE:` footer | major (1.3.0 → 2.0.0) |
| `docs:`, `refactor:`, `perf:`, `build:`, `ci:`, `test:`, `chore:` | no release on their own |

Add the upgrade hint for users to the commit body, e.g. `BREAKING CHANGE: excludeScopes is now internalScopes`; it appears in the changelog.

**How a release happens:** release-please keeps a pull request `chore(main): release X.Y.Z` up to date with the new version and the generated `CHANGELOG.md`. Merging that pull request creates the tag, the GitHub release with its notes, and attaches the binaries. Do not edit `CHANGELOG.md` or the version in `package.json` by hand.

---

## 📜 License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE).
