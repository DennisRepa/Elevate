# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/bcoe/standard-version) for commit guidelines.

## 1.1.1 (2026-09-25)

### Bug Fixes

* **ci:** configure `NODE_AUTH_TOKEN` secret for npm publication in GitHub Actions release workflow
* **ci:** enable parallel standalone binary builds and dynamic GitHub release asset tagging
* **ci:** add ad-hoc codesigning for macOS standalone executables
* **npm:** align package registry version and deprecate unaligned initial npm release

## 1.0.0 (2026-09-25)

### Features

* **core:** initial release of Elevate v1.0.0
* **tui:** interactive terminal dashboard for monorepo dependency management
* **ecosystems:** native support for npm and Maven ecosystems
* **cli:** headless subcommands (`modules`, `scan`, `versions`, `update`) with machine-readable JSON output
* **mcp:** Model Context Protocol server for AI coding agents
* **binaries:** standalone executable builds for Windows, Linux, and macOS
