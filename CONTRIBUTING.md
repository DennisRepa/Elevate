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
3. Keep commit messages clear and descriptive.
4. If adding new user-facing options or strings, update both `src/i18n/locales/en.ts` and `src/i18n/locales/de.ts`.

---

## 📜 License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE).
