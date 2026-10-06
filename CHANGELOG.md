# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Features

* **config:** the repository root is the same wherever Elevate is started: the nearest `elevate.config.json` wins, otherwise npm workspaces and the Maven POM chain (parent and aggregator) propose a root and the outermost proposal is used; the search never leaves the `.git` checkout, and unreadable manifests are skipped
* **npm:** repositories managed by pnpm, Yarn or Bun (from `packageManager`, lockfiles or workspace files) are refused for scans, updates and the default verification, with an explanation; Maven modules, version queries and a custom `postUpdateScript` are not affected
* **npm:** `optionalDependencies` are scanned and updated; a name in several sections receives the new range in all of them; `peerDependencies`, `overrides` and `bundleDependencies` are never offered or changed
* **maven:** the versions of `maven-help-plugin` and `versions-maven-plugin` can be set with `mavenPlugins` in `elevate.config.json` (invalid values fall back to the defaults with a warning); a plugin Maven cannot download is reported as such, naming the plugin and the setting
* **windows:** project files are passed to Maven relative to the working directory, so a repository below a path such as `C:\R&D\shop` works; the unsafe-argument error now names the argument, the characters and a remedy
* **internal dependencies:** every dependency is classified as `workspace`, `private` or `public`; workspace modules are aligned to their local version (`[Align]`) instead of being hidden
* **npm:** workspace dependencies whose range excludes the local version are offered for alignment, and `package-lock.json` is checked afterwards that they are linked
* **npm:** workspaces are resolved with `@npmcli/map-workspaces`, so glob patterns behave as in npm
* **maven:** versions come from Maven's effective POM; newer versions are looked up with the versions-maven-plugin through the build's own repositories, mirrors and credentials
* **maven:** updates are written where the version is declared — dependency, dependency management, property or external parent, also in parent POMs — preserving formatting
* **maven:** the Maven Wrapper is preferred; verification builds the changed modules and their dependents (`-pl … -amd`)
* **safety:** failed installs, integrity checks and verifications roll back every touched file; `--keep-on-failure` / `keepOnFailure` keeps failed verifications; verification runs before and after the update, so failures that already existed do not cause a rollback
* **safety:** internal packages are never looked up on a public registry (scan, version picker, `versions`, MCP)
* **maven:** `elevate versions` and MCP `elevate_get_versions` query through Maven as well (were fixed to Maven Central), so artifacts that exist only in a private Nexus or Artifactory are found
* **transparency:** dependencies that could not be offered are reported with a reason (`skipped`) instead of silently disappearing; scan errors are shown instead of "up to date"

### Changes

* **maven:** a dependency is aligned to a local module only inside the same reactor (same outermost aggregator); otherwise it is looked up like any other artifact, so a stray POM with the coordinates of a public artifact no longer causes a downgrade offer
* **maven:** module discovery no longer treats POM files below a project's `src` directory (test fixtures, invoker projects, archetype templates) as modules; modules named in `<modules>` are still found
* **maven:** `HELP_PLUGIN` and `VERSIONS_PLUGIN` are replaced by `DEFAULT_MAVEN_PLUGINS`; the plugin versions are passed to `readEffectivePoms` and `queryNewerVersions`
* **config:** `excludeScopes` is renamed to `internalScopes`; the old key is still read and reported as deprecated
* **npm:** default verification is `npm ls` (was `npm run check:versions`, which most repositories do not have)
* **cli:** `scan` exits with `3` when a module could not be scanned; `update` exits with `2` when it was rolled back

### Fixes

* **config:** an unreadable `elevate.config.json` (invalid JSON, not an object, or `internalScopes` that is not a list of strings) now stops Elevate with a message and exit code `1`; it used to be ignored, which silently switched off the protection of internal packages. A byte order mark is accepted
* **npm:** the package manager guard also applies when Elevate is started inside a pnpm or Yarn workspace package: the search for lockfiles continues up to the checkout
* **npm:** `N info severity vulnerabilities` is reported as a warning
* **npm:** the vulnerability summary of `npm install` is read line by line: `found 0 vulnerabilities` is no longer reported as a warning, and npm 7+ wording (`1 high severity vulnerability`, `5 vulnerabilities (…)`) is recognised
* **maven:** the root `pom.xml` is discovered as a module
* **maven:** commented-out dependencies are no longer matched or edited
* **versions:** pre-release detection no longer misreads words such as `android` or `jre`
* **npm:** package names are validated before being passed to `npm`, and commands no longer run through a shell on POSIX

## 1.2.0 (2026-09-28)

### Features

* **core:** initial release of Elevate
* **tui:** interactive terminal dashboard for monorepo dependency management
* **ecosystems:** native support for npm and Maven ecosystems
* **cli:** headless subcommands (`modules`, `scan`, `versions`, `update`) with machine-readable JSON output
* **mcp:** Model Context Protocol server for AI coding agents
* **binaries:** standalone executable builds for Windows, Linux, and macOS
