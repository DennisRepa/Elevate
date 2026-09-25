# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/bcoe/standard-version) for commit guidelines.

## [1.2.0](https://github.com/DennisRepa/Elevate/compare/v1.1.1...v1.2.0) (2026-09-25)


### Features

* initial commit for Elevate v1.0.0 ([7018ce4](https://github.com/DennisRepa/Elevate/commit/7018ce407c7c598d545d6d479955ba75904a88c6))


### Bug Fixes

* **ci:** configure automated GitHub release workflow and bump version to v1.1.1 ([cc8f9b4](https://github.com/DennisRepa/Elevate/commit/cc8f9b4956ade29405dceb4ffff293dc8cb07931))

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
