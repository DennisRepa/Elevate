# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

## 1.3.0 (2026-10-06)

Elevate now understands how the modules of a repository depend on each other. Internal dependencies are aligned instead of hidden and are never looked up on public registries, Elevate works from any directory of a repository, and it refuses to act where it would do harm.

### Upgrade notes

* **config:** an unreadable `elevate.config.json` (invalid JSON, not an object, or `internalScopes` that is not a list of strings) now stops Elevate with a message and exit code `1`. It used to be ignored, which silently switched off the protection of internal packages. Fix or remove the file.
* **config:** `excludeScopes` is now called `internalScopes`. The old key is still read and reported as deprecated.
* **npm:** repositories managed by pnpm, Yarn or Bun are refused for scans, updates and the default verification, because Elevate drives npm and would create a second lockfile there. Maven modules, version queries and a custom `postUpdateScript` are not affected.
* **npm:** the default verification is `npm ls` (it was `npm run check:versions`, which most repositories do not have).
* **cli:** `scan` exits with `3` when a module could not be scanned, and `update` exits with `2` when it was rolled back.
* **maven:** `elevate versions` and the MCP tool `elevate_get_versions` ask Maven instead of Maven Central, so artifacts that exist only in a private Nexus or Artifactory are found.

### Features

* **internal dependencies:** every dependency is classified as `workspace`, `private` or `public`. Workspace modules are aligned to their local version (`[Align]`) instead of being hidden, and internal packages are never looked up on a public registry (scans, version picker, `versions` and MCP).
* **npm:** a workspace dependency whose range excludes the local version is offered for alignment, and `package-lock.json` is checked afterwards that npm linked it instead of installing a copy from a registry.
* **npm:** workspaces are resolved with `@npmcli/map-workspaces`, so glob patterns and negations behave as in npm.
* **npm:** `optionalDependencies` are scanned and updated, and a name declared in several sections receives the new range in all of them. `peerDependencies`, `overrides` and `bundleDependencies` are never offered or changed.
* **npm:** pnpm, Yarn and Bun are recognised from `packageManager`, lockfiles and workspace files, also when Elevate is started inside a workspace package.
* **maven:** versions come from Maven's effective POM, and newer versions are looked up with the versions-maven-plugin through the build's own repositories, mirrors and credentials.
* **maven:** a dependency on a module of the same reactor is aligned to that module's version. A project outside the reactor is treated like any other artifact, so a stray POM with the coordinates of a public artifact cannot cause a downgrade offer.
* **maven:** updates are written where the version is declared (dependency, dependency management, property or external parent, also in parent POMs), preserving formatting and comments.
* **maven:** the Maven Wrapper is preferred, and verification builds the changed modules and their dependents (`-pl … -amd`).
* **maven:** the plugin versions can be set with `mavenPlugins` in `elevate.config.json`. Invalid values fall back to the defaults with a warning, and a plugin Maven cannot download is reported with its name and the setting to change.
* **config:** the repository root is the same wherever Elevate is started. The nearest `elevate.config.json` wins; otherwise npm workspaces and the Maven POM chain propose a root and the outermost one is used. The search never leaves the `.git` checkout.
* **safety:** a failed install, integrity check or verification rolls back every touched file. Verification runs before and after the update, so a failure that already existed does not cause a rollback; `--keep-on-failure` / `keepOnFailure` keeps the changes of a failed verification.
* **transparency:** dependencies that could not be offered are listed with a reason (`skipped`) instead of silently disappearing, and scan errors are shown instead of "up to date".
* **windows:** a repository below a path such as `C:\R&D\shop` works with Maven, because project files are passed relative to the working directory. The error for unsafe arguments names the argument, the characters and a remedy.

### Fixes

* **npm:** the vulnerability summary of `npm install` is read line by line. `found 0 vulnerabilities` is no longer reported as a warning, and the wording of npm 7 and later (`1 high severity vulnerability`, `5 vulnerabilities (…)`, `info` severity) is recognised.
* **npm:** package names are validated before they are passed to `npm`, and commands no longer run through a shell on POSIX.
* **maven:** the root `pom.xml` is discovered as a module.
* **maven:** POM files below a project's `src` directory (test fixtures, invoker projects, archetype templates) are no longer taken for modules. Modules named in `<modules>` are still found.
* **maven:** commented-out dependencies are no longer matched or edited.
* **versions:** pre-release detection no longer misreads words such as `android` or `jre`.

## 1.2.0 (2026-09-28)

### Features

* **core:** initial release of Elevate
* **tui:** interactive terminal dashboard for monorepo dependency management
* **ecosystems:** native support for npm and Maven ecosystems
* **cli:** headless subcommands (`modules`, `scan`, `versions`, `update`) with machine-readable JSON output
* **mcp:** Model Context Protocol server for AI coding agents
* **binaries:** standalone executable builds for Windows, Linux, and macOS
