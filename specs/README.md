# Elevate — Behaviour Specifications

These `.feature` files specify behaviour in Gherkin. They are the contract for
the implementation and are written for people who run Elevate on repositories
its authors have never seen.

| File | Prefix | Subject |
| :--- | :--- | :--- |
| [01-repository-root.feature](./01-repository-root.feature) | `ROOT` | Which directory Elevate treats as the repository root |
| [02-package-manager-guard.feature](./02-package-manager-guard.feature) | `PM` | Recognising the package manager; refusing Yarn and Bun repositories |
| [03-maven-module-discovery.feature](./03-maven-module-discovery.feature) | `DISC` | Which `pom.xml` files are modules |
| [04-maven-reactor-alignment.feature](./04-maven-reactor-alignment.feature) | `ALIGN` | When a Maven dependency is aligned to a local module |
| [05-dependency-coverage.feature](./05-dependency-coverage.feature) | `COV` | Which npm dependency sections are scanned and written |
| [06-windows-paths.feature](./06-windows-paths.feature) | `WIN` | Special characters in paths on Windows |
| [07-maven-plugin-versions.feature](./07-maven-plugin-versions.feature) | `PLUG` | Versions of the Maven plugins Elevate runs |
| [08-npm-audit-status.feature](./08-npm-audit-status.feature) | `AUDIT` | Reading npm's vulnerability summary |
| [09-configuration-errors.feature](./09-configuration-errors.feature) | `CONF` | A broken `elevate.config.json` stops Elevate |
| [10-changelog-release.feature](./10-changelog-release.feature) | `REL` | The changelog drives releases |
| [11-pnpm-workspaces.feature](./11-pnpm-workspaces.feature) | `PWS` | Modules and repository root of a pnpm workspace |
| [12-pnpm-internal-dependencies.feature](./12-pnpm-internal-dependencies.feature) | `PLINK` | Linking, aligning and verifying workspace modules under pnpm |
| [13-pnpm-install-and-verification.feature](./13-pnpm-install-and-verification.feature) | `PINST` | The pnpm commands Elevate runs and what it makes of them |
| [14-pnpm-catalogs.feature](./14-pnpm-catalogs.feature) | `CAT` | `catalog:` dependencies and the catalogs of `pnpm-workspace.yaml` |

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
* "No process is started" means: neither `npm`, `pnpm`, `mvn` nor a Maven
  Wrapper is spawned. Tests prove it by replacing the process boundary
  (`src/adapters/shared/process.ts` or `runMaven`) with a test double. A
  statement such as "the only process started is `pnpm --version`" or "no
  process named `npm` is started" is checked against the same recording.
* Unit tests (`test/unit`) run offline, without Maven, pnpm and a registry.
  Scenarios tagged `@integration` need real tools (Maven, npm, pnpm) and live
  in `test/integration`; they are skipped when the tool is missing.
* "The pnpm repository" and "the root module" in `13-pnpm-install-and-verification.feature`
  are defined at the top of that file.
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
| `REL` | `test/unit/changelog-release.test.ts` (`REL-11` and `REL-12` are checked by the commands below) |
| `CONF` | `test/unit/config-errors.test.ts` (`CONF-07` is checked by running the command line) |
| `PWS` | `test/unit/pnpm-workspaces.test.ts` (`PWS-14` and `PWS-15` are checked by running the command line, `PWS-16` through the MCP server) |
| `PLINK` | `test/unit/pnpm-links.test.ts` |
| `PINST` | `test/unit/pnpm-install.test.ts`; the `@integration` scenarios in `test/integration/pnpm.test.ts` |
| `CAT` | `test/unit/pnpm-catalogs.test.ts`; `CAT-15` in `test/integration/pnpm.test.ts` |

`PM-16` and `PM-17` are new in `test/unit/package-manager.test.ts`; `PM-05` to
`PM-08`, `PM-11`, `PM-12` and `PM-13` change there (Yarn tree instead of pnpm tree).

## What the pnpm scenarios rest on

The scenarios 11 to 14 describe a program Elevate does not control. Each fact
below was checked by running the real pnpm in **9.15.9, 10.34.6, 11.28.5 and
12.10.1** (the current releases of the four majors on 2026-10-09) against small
workspaces and a real registry. Where the four versions differ, the row says
so. If a fact changes with a later pnpm, the scenarios that depend on it are
the ones to revisit. pnpm 8 and older (lockfile version 6) were not checked
and are not supported; neither were Windows, per-package lockfiles
(`shared-workspace-lockfile=false`) or the `link-workspace-packages` setting.

| # | Fact | Used by |
| :-- | :--- | :--- |
| 1 | `pnpm-lock.yaml` has `lockfileVersion: '9.0'` in all four versions. `importers` is keyed by the project's directory (`.` for the root); each dependency has `specifier` and `version`; a linked workspace package has `version: link:<relative path>`, also when `dependenciesMeta.injected` is set. | PLINK-09 to 13 |
| 2 | A plain range (`^1.0.0`) on a workspace package is never linked. pnpm asks the registry, even when the local version satisfies the range. A workspace package named `left-pad` at 1.0.0 with the dependency `"left-pad": "^1.0.0"` was resolved to the registry's `1.3.0`. | PLINK-06, 07 |
| 3 | `workspace:^2.0.0` on a package at 1.0.0: pnpm 9 and 12 fail (`No matching version found … inside the workspace`), pnpm 10 and 11 link it. `workspace:*`, `workspace:^` and `workspace:~` link in all four. | PLINK-01, 02 |
| 4 | `pnpm-workspace.yaml`: `*` is one level, `**` any depth, `!` excludes, the root is always a project, `node_modules` directories are never projects. Without `packages`, pnpm 9 fails and pnpm 10 to 12 use the root alone. | PWS-01 to 06 |
| 5 | With `CI` set, `pnpm install` is implicitly `--frozen-lockfile`. After a dependency edit it then exits with 1 in all four versions (`ERR_PNPM_OUTDATED_LOCKFILE`); after a catalog edit it exits with 1 in pnpm 10 to 12 (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`), while pnpm 9 does not notice the edit and leaves the lockfile stale. Without `CI` all of these installs succeed. `--no-frozen-lockfile` is accepted by all four, overrides `CI`, and brings the lockfile (including its `catalogs` section) up to date. | PINST-06, 07, 08, CAT-10 |
| 6 | `pnpm ls` exits with 0 for a missing dependency and without `node_modules`. `pnpm install --frozen-lockfile --lockfile-only` exits with 0 for a consistent lockfile and with 1 (`ERR_PNPM_OUTDATED_LOCKFILE`) for a stale one. | PINST-17 to 21 |
| 7 | `pnpm install` prints no vulnerability summary. `pnpm audit --json` prints `{"advisories": …, "metadata": {"vulnerabilities": {"info","low","moderate","high","critical"}}}` and exits with 1 when it found vulnerabilities. With an unreachable registry pnpm 9 and 10 exit with 1 and print `{"error": {"code", "message"}}`; pnpm 11 and 12 print nothing for more than 40 seconds. | PINST-22 to 26 |
| 8 | Errors of `pnpm install` are on the standard output in pnpm 9 to 11 and on the standard error in pnpm 12. | PINST-12 |
| 9 | `pnpm view <name> <field> --json` and `pnpm config list --json` work in all four versions without `npm` on the PATH. The registry keys of `pnpm config list --json` match those of `npm config list --json` for the same `.npmrc`; pnpm 10 to 12 add `@jsr:registry = https://npm.jsr.io/` by default. | PINST-27, 28 |
| 10 | Catalogs: the lockfile records them under `catalogs`; `catalog:` and `catalog:default` name the default catalog; a missing entry fails with `ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC`; defining both `catalog` and `catalogs.default` fails. `pnpm install` does not rewrite `pnpm-workspace.yaml`. | CAT-01 to 14 |
| 11 | `minimumReleaseAge` in `pnpm-workspace.yaml` makes `pnpm install` fail with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` (exit 1) in pnpm 10 to 12. | PINST-13 |
| 12 | Aligning a `workspace:` range and installing it with `CI` set works in all four versions and ends with `link:` in the lockfile. Before the update, `--frozen-lockfile --lockfile-only` already fails in pnpm 11 (the workflow treats that as a pre-existing failure). | PINST-31 |
| 13 | pnpm 11 and 12 exit with 1 (`ERR_PNPM_IGNORED_BUILDS`) when a dependency has a build script that is not approved (checked with `core-js`); pnpm 9 and 10 exit with 0. This also affects the restore after a rollback, which is the same command. | PINST-13, 16 |
| 14 | `pnpm install` prints no funding hint. `install`, `install --frozen-lockfile`, `install --frozen-lockfile --lockfile-only`, `audit --json`, `config list --json` and `view` all run with `npm` absent from the PATH. | PINST-11 |

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

* `src/adapters/npm/npm-package-manager.ts` exports
  `detectPackageManager(rootDir: string): { name: 'npm' | 'pnpm' | 'yarn' | 'bun'; evidence: string }`
  and `class UnsupportedPackageManagerError extends Error` (its `name` is
  `'UnsupportedPackageManagerError'`). **Changed with pnpm support:**
  `assertNpmManaged` is replaced by
  `assertSupportedPackageManager(rootDir: string): 'npm' | 'pnpm'`, which
  throws `UnsupportedPackageManagerError` for Yarn and Bun only; the message
  is the one in `02-package-manager-guard.feature`.
* The guard is called in `NpmDependencyAdapter.scan`,
  `NpmUpdaterAdapter.applyUpdates` (rethrown as `InstallError` with the same
  message), `NpmUpdaterAdapter.resync` (returns silently instead of throwing
  for Yarn and Bun) and `NpmVerificationAdapter.verify` (default verification
  only). Its result decides which package manager the adapter drives.

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

### PWS

* The ecosystem stays `'npm'`; `Ecosystem` and `EcosystemFactory` do not gain
  a value. pnpm is a package manager of that ecosystem, chosen per repository
  by `detectPackageManager`.
* New file `src/adapters/npm/pnpm-workspace.ts` exports
  `readPnpmWorkspace(rootDir: string): PnpmWorkspace | undefined`, which is
  `undefined` when `pnpm-workspace.yaml` is absent or not valid YAML, and the
  type

  ```ts
  interface PnpmWorkspace {
    file: string;                                               // absolute path
    packages: string[];                                         // [] when missing or empty
    catalogs: ReadonlyMap<string, ReadonlyMap<string, string>>; // by catalog name; the default catalog is 'default'
    ambiguousDefaultCatalog: boolean;                           // `catalog` and `catalogs.default` both defined
  }
  ```

  YAML is read with the `yaml` package, a new entry in `dependencies`. It is
  chosen because its document API keeps comments and quoting, which CAT needs.
* `NpmModuleDiscoveryAdapter.discover` asks `detectPackageManager(rootDir)`.
  For pnpm it passes `{ workspaces: packages }` to `@npmcli/map-workspaces`
  instead of the package.json field, so patterns, negation and the treatment
  of `node_modules` come from the engine npm uses; for any other manager it is
  unchanged. `findRoot` also returns the nearest directory whose
  `readPnpmWorkspace` is defined.
* `EcosystemStrategy` gains the optional `displayNameFor?(rootDir: string): string`;
  the npm strategy returns `'Node / pnpm'` for a pnpm repository and
  `'Node / npm'` otherwise. The `modules` command, the MCP tool
  `elevate_discover_modules` and the dashboard header use it, and both
  machine-readable outputs add `packageManager` for the npm ecosystem.

### PLINK

* New file `src/adapters/npm/npm-protocols.ts` exports
  `splitRangeProtocol(range: string): { protocol: 'workspace' | 'catalog' | undefined; rest: string }`
  where `rest` is what follows `workspace:` or `catalog:`. Only the scanner and
  updater of a pnpm repository call it; in an npm repository such ranges stay
  non-SemVer and are ignored as before.
* `alignmentCandidate` in `npm-scanner.ts` keeps its signature and gains the
  `workspace:` handling: it aligns `rest` and writes `workspace:` + prefix +
  local version. A plain range on a workspace module in a pnpm repository
  yields `{ skipped: { identifier, origin: 'workspace', reason: 'not-linked', detail: range } }`
  instead of a candidate. `SkippedDependency.origin` is a
  `DependencyOriginKind`, which already contains `'workspace'`.
* `SkipReason` gains `'not-linked'` and `'catalog-unresolved'`. `describeSkip`
  (English) and `Translations.list.skipReason` (German and English) cover both;
  the exhaustive switches make the compiler enforce it.
* New file `src/adapters/npm/pnpm-lockfile.ts` exports
  `readPnpmLockfile(rootDir: string)`, returning
  `{ kind: 'ok'; importers: Record<string, Record<string, Record<string, { specifier: string; version: string }>>> } | { kind: 'missing' } | { kind: 'unreadable' } | { kind: 'unsupported'; lockfileVersion: string }`
  (`lockfileVersion` 9.x is supported), and
  `findUnlinkedPnpmDependencies(lockfile, moduleRelPath: string, names: readonly string[]): string[]`
  which maps `''` to the importer `.` and returns the messages of PLINK.
  `verifyAlignedLinks` in `npm-updater.ts` picks this function or
  `findUnlinkedWorkspaceDependencies` by package manager.

### PINST

* `src/adapters/npm/npm-package-manager.ts` additionally exports
  `class PackageManagerNotFoundError extends Error` (its `name` is
  `'PackageManagerNotFoundError'`) and
  `ensurePnpmRunnable(rootDir: string, detected: DetectedPackageManager): Promise<void>`,
  which starts `pnpm --version` with a 15 second timeout, throws that error
  with the message of PINST-01, and remembers a success per resolved root.
  The scanner, `applyUpdates` (rethrown as `InstallError`) and the default
  verification call it first, for pnpm repositories only.
* New file `src/adapters/npm/npm-commands.ts` is the only place that knows the
  executable and arguments per package manager: `install`, `restore`,
  `verify`, `view(name, field)` and `config`. The table at the top of
  `13-pnpm-install-and-verification.feature` is exactly this file. The
  scanner, updater, verifier, `NpmRegistryAdapter` and `NpmConfigReader` use
  it; the registry adapter and the config reader choose by
  `detectPackageManager(cwd)` for the directory they are given.
* New file `src/adapters/npm/pnpm-audit.ts` exports
  `parsePnpmAudit(output: string): { message: string; severity: 'clean' | 'warn' }`,
  including the "unavailable" results, and `AUDIT_TIMEOUT_MS = 60_000`.
  `NpmUpdaterAdapter.applyUpdates` runs `pnpm audit --json` after a successful
  install and link check; a timeout is turned into the message of PINST-26 by
  the updater, not by the parser.
* For pnpm, the details of a failed install or verification are the last 15
  lines of stdout followed by stderr (`tail(stdout + '\n' + stderr)`), not
  `stderr || stdout` as for npm.
* `NpmUpdaterAdapter.affectedFiles` returns, for a pnpm repository, the
  module's `package.json`, the root's `package.json`, `pnpm-lock.yaml` and
  `pnpm-workspace.yaml`; for npm it is unchanged. `fundingMessage` is
  `undefined` for pnpm.
* `isPublicNpmRegistry` counts `npm.jsr.io` as public.
* New fixture `test/fixtures/pnpm-workspaces/` with a root (`mono`, private),
  `pnpm-workspace.yaml` (`packages: ["packages/*"]`, a default catalog with
  `left-pad: ^1.1.0`), `packages/lib` (`@acme/lib` at 1.0.0) and
  `packages/app` (`@acme/app` at 1.0.0 depending on `@acme/lib` as
  `workspace:^1.0.0`). Scenarios that need more write it into their copy.

### CAT

* `VersionDeclaration.kind` gains `'catalog'` and the interface gains
  `catalogName?: string`; `candidateToJson` writes `declaredIn.catalog` from
  it. The doc comment of `UpdateCandidate.sharedWith` is widened: for a
  catalog entry it lists the ids of the *modules* that use the entry (for
  Maven it still lists dependencies).
* `src/adapters/npm/pnpm-workspace.ts` additionally exports
  `setCatalogRange(source: string, catalog: string, name: string, newRange: string): string`,
  which returns `source` with only that entry's range replaced (quotes,
  comments, block or flow notation, key order and line endings untouched) and
  throws when the entry does not exist.
* The scanner resolves `catalog:` ranges through `readPnpmWorkspace(rootDir)`
  and attaches the declaration; the updater writes candidates whose
  `declaration.kind` is `'catalog'` with `setCatalogRange` into
  `declaration.file` and rewrites a module's package.json only when at least
  one of its candidates is not a catalog candidate.

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

### pnpm support

These belong to the change that implements features 11 to 14 and are checked
by review. Item 1 above (the sentence "npm only … pnpm … are refused") is
replaced by item 1 below.

1. `README.md`: the table "Supported Package Managers" gets a pnpm row and
   `pnpm` leaves the "Planned" sentence. **Scope and known limits** says: npm
   and pnpm for Node.js (pnpm 9 to 12); Yarn and Bun repositories are refused;
   `catalog:` entries are updated where they are declared; a plain range on a
   workspace module in a pnpm repository is listed as not linked and never
   rewritten to `workspace:`; Elevate does not read pnpm settings such as
   `minimumReleaseAge` or the approval of build scripts, so pnpm may refuse an
   offered version and the update is rolled back with pnpm's message.
2. `docs/en.md` and `docs/de.md`: the Node feature bullet; "Aligning workspace
   modules" gets the pnpm paragraph (the `workspace:` protocol, the
   lockfile check on `link:`); "Package manager guard" is renamed and now
   names Yarn and Bun; new sections for the pnpm workspace file, catalogs, the
   commands Elevate runs (table of `13-…`), the vulnerability summary via
   `pnpm audit` and the lockfile consistency check that replaces `npm ls`.
   The architecture tree lists the new files of the contract.
3. `CHANGELOG.md` lists every behaviour change under `## Unreleased`: pnpm is
   supported (with an upgrade note that pnpm repositories are no longer
   refused), the guard message changed, `catalog:` support, and the new skip
   reasons `not-linked` and `catalog-unresolved`.
4. `src/i18n/locales/de.ts` and `en.ts`: the two skip reasons, and the
   dashboard's ecosystem label showing the package manager.
5. `package.json`: `yaml` in `dependencies`; keyword `pnpm`.
6. Optional: a CI job that installs pnpm (9 and the latest) and runs
   `npm run test:integration`, so that the `@integration` scenarios of 12 to 14
   run on every change. The facts above should be re-checked when a new pnpm
   major appears.
