# Elevate — Behaviour Specifications

These `.feature` files specify behaviour in Gherkin. They are the contract for
the implementation and are written for people who run Elevate on repositories
its authors have never seen.

| File | Prefix | Subject |
| :--- | :--- | :--- |
| [01-repository-root.feature](./01-repository-root.feature) | `ROOT` | Which directory Elevate treats as the repository root |
| [02-package-manager-guard.feature](./02-package-manager-guard.feature) | `PM` | Refusing to act as npm in pnpm, Yarn or Bun repositories |
| [03-maven-module-discovery.feature](./03-maven-module-discovery.feature) | `DISC` | Which `pom.xml` files are modules |
| [04-maven-reactor-alignment.feature](./04-maven-reactor-alignment.feature) | `ALIGN` | When a Maven dependency is aligned to a local module |
| [05-dependency-coverage.feature](./05-dependency-coverage.feature) | `COV` | Which npm dependency sections are scanned and written |
| [06-windows-paths.feature](./06-windows-paths.feature) | `WIN` | Special characters in paths on Windows |
| [07-maven-plugin-versions.feature](./07-maven-plugin-versions.feature) | `PLUG` | Versions of the Maven plugins Elevate runs |
| [08-npm-audit-status.feature](./08-npm-audit-status.feature) | `AUDIT` | Reading npm's vulnerability summary |
| [09-configuration-errors.feature](./09-configuration-errors.feature) | `CONF` | A broken `elevate.config.json` stops Elevate |

## Conventions

* Every scenario has an ID (`ROOT-04`). The automated test that proves it
  carries the same ID at the start of its title: `it('ROOT-04 …', …)`.
  A `Scenario Outline` is proven by one test per example row or one
  `it.each`; the ID still starts the title.
* The feature files are not executed by a Gherkin runner. Tests are plain
  Vitest tests; the ID is the link.
* Directory trees in doc strings are relative to a temporary directory called
  *the tree*. A line ending in `/` is a directory; indented text after a file
  name is its content or a description of it.
* "No process is started" means: neither `npm`, `mvn` nor a Maven Wrapper is
  spawned. Tests prove it by replacing the process boundary
  (`src/adapters/shared/process.ts` or `runMaven`) with a test double.
* Unit tests (`test/unit`) run offline, without Maven and without a registry.
  Scenarios tagged `@integration` need real tools and live in
  `test/integration`.
* Scenarios tagged `@windows` only apply on Windows, `@posix` only elsewhere;
  their tests are skipped on the other platform with `it.skipIf`.

## Test files

| Prefix | Test file |
| :--- | :--- |
| `ROOT` | `test/unit/repository-root.test.ts` |
| `PM` | `test/unit/package-manager.test.ts` |
| `DISC` | `test/unit/maven-discovery.test.ts` |
| `ALIGN` | `test/unit/maven-alignment.test.ts` |
| `COV` | `test/unit/dependency-coverage.test.ts` |
| `WIN` | `test/unit/windows-paths.test.ts`, `WIN-03` in `test/integration/windows-paths.test.ts` |
| `PLUG` | `test/unit/maven-plugins.test.ts` |
| `AUDIT` | `test/unit/npm-audit.test.ts` |
| `CONF` | `test/unit/config-errors.test.ts` (`CONF-07` is checked by running the command line) |

## Implementation contract

The feature files say *what* must hold. This section fixes the names and
places the scenarios refer to, so tests and code meet.

### ROOT

* `src/config.ts` exports `findRepositoryRoot(startDir: string): string` and
  `loadConfig(startDir: string = process.cwd()): ElevateConfig`.
* `ModuleDiscoveryPort` gains the optional method
  `findRoot?(startDir: string, boundaryDir: string | undefined): string | undefined`.
  The npm adapter returns the nearest directory whose `package.json` declares
  `workspaces`; the Maven adapter returns the top of the connected POM chain.
  Both only look at `startDir` and its ancestors up to and including
  `boundaryDir`. `findRepositoryRoot` asks every ecosystem of
  `EcosystemFactory.getAvailableEcosystems()` and never contains npm- or
  Maven-specific logic itself.
* The Maven climb reuses `readPom` and `parentPomFile` from `maven-pom.ts`.

### PM

* New file `src/adapters/npm/npm-package-manager.ts` exporting
  `detectPackageManager(rootDir: string): { name: 'npm' | 'pnpm' | 'yarn' | 'bun'; evidence: string }`,
  `class UnsupportedPackageManagerError extends Error` (its `name` is
  `'UnsupportedPackageManagerError'`) and
  `assertNpmManaged(rootDir: string): void`, which throws that error.
* The guard is called in `NpmDependencyAdapter.scan`,
  `NpmUpdaterAdapter.applyUpdates` (rethrown as `InstallError` with the same
  message), `NpmUpdaterAdapter.resync` (returns silently instead of throwing)
  and `NpmVerificationAdapter.verify` (default verification only).

### DISC and ALIGN

* Both change `src/adapters/maven/maven-project.ts` and
  `src/adapters/maven/maven-scanner.ts` only; `classifyOrigin` in
  `src/domain/origin.ts` keeps its signature and its behaviour for npm.

### COV

* `declaredDependencies` in `npm-scanner.ts` and the write loop in
  `npm-updater.ts` are the only places that enumerate dependency sections.

### WIN

* `src/adapters/maven/maven-command.ts` exports
  `relativeToCwd(cwd: string, file: string): string`.
* `UnsafeArgumentError` keeps its name and constructor signature.

### PLUG

* `ElevateConfig` gains `mavenPlugins: { help: string; versions: string }`
  (always filled, defaults applied) and `warnings: string[]`.
* `src/adapters/maven/maven-resolution.ts` exports
  `DEFAULT_MAVEN_PLUGINS = { help: '3.5.2', versions: '2.22.0' }`, the type
  `MavenPluginVersions` and
  `class MavenPluginUnavailableError extends MavenCommandError`. The constants
  `HELP_PLUGIN` and `VERSIONS_PLUGIN` are removed; `readEffectivePoms` and
  `queryNewerVersions` take the plugin versions as a parameter.
* `EcosystemFactory.configure(settings: { mavenPlugins?: MavenPluginVersions }): void`
  stores the settings and clears the cached strategies, so strategies created
  afterwards use them. Without a call the defaults apply.
  `src/index.tsx` calls it once, right after `loadConfig()`, and prints
  `config.warnings` to stderr exactly like `config.deprecations`.

### AUDIT

* `src/adapters/npm/npm-updater.ts` exports
  `parseAuditSummary(output: string): { message: string; severity: 'clean' | 'warn' }`.

## Not specified as scenarios

These belong to the same change and are checked by review:

1. `README.md` gets a section **Scope and known limits** stating: npm only
   (pnpm, Yarn and Bun repositories are refused); `dependencies`,
   `devDependencies` and `optionalDependencies` are covered, `peerDependencies`
   and `overrides` are never changed; Maven plugin versions and declarations
   inside `<profiles>` are not offered; dependencies whose version is declared
   outside the repository are listed as not offered.
2. `docs/en.md` and `docs/de.md` describe root detection, the package-manager
   guard, reactor-scoped alignment, `optionalDependencies`, the `mavenPlugins`
   setting and the relaxed Windows path limitation. The sentence about pinned
   plugin versions in "Requirements for Maven" is updated.
3. `CHANGELOG.md` lists every behaviour change under `## Unreleased`.
4. The licence link in `README.md` points to `./LICENSE`.
5. `.github/workflows/ci.yml` runs `npm run typecheck`, `npm test` and
   `npm run build` on `ubuntu-latest` and `windows-latest`.
