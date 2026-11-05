# Changelog

All notable changes to this project will be documented in this file.

## [1.8.0](https://github.com/DennisRepa/Elevate/compare/v1.7.0...v1.8.0) (2026-11-05)


### Features

* **gradle:** add Gradle as an ecosystem ([3392130](https://github.com/DennisRepa/Elevate/commit/33921307da928f16f958aba8ea11eb6c47aef086))
* **gradle:** discover Gradle builds and modules ([9b57e66](https://github.com/DennisRepa/Elevate/commit/9b57e664a3174839572e32942c9483d65ba70856))
* **gradle:** locate version declarations in build scripts and catalogs ([516b4cc](https://github.com/DennisRepa/Elevate/commit/516b4cc2f08ba12d2aef5e700e93968306c75a38))
* **gradle:** order versions like Gradle ([0315e98](https://github.com/DennisRepa/Elevate/commit/0315e982fcab18655ad9d674f1a79f4b54ef14dd))
* **gradle:** plan version lookups per repository set ([9afbc33](https://github.com/DennisRepa/Elevate/commit/9afbc334f4aad7119140d55718e32518d77f038a))
* **gradle:** register the Gradle ecosystem for scan, modules and versions ([4eba015](https://github.com/DennisRepa/Elevate/commit/4eba01532fc8a22c27f261706487424b8036d9b0))
* **gradle:** run Gradle and probe a build with an init script ([8685e05](https://github.com/DennisRepa/Elevate/commit/8685e0586eadfc5e548d80ca07a60c8baa68e4f7))
* **gradle:** scan Gradle modules and look up newer versions ([8c8fb40](https://github.com/DennisRepa/Elevate/commit/8c8fb40a15bab85f3e8d4c46bf2b2ccdd011cba3))
* **gradle:** update Gradle builds and verify them with the build itself ([cd477b8](https://github.com/DennisRepa/Elevate/commit/cd477b89d3a6c59dcc82ce21d16c640e29193e04))


### Fixes

* **cli:** show the message of a fatal error instead of its stack trace ([fef77ec](https://github.com/DennisRepa/Elevate/commit/fef77ec6708b9aafbaa423087db444caadbc8e89))


### Refactoring

* **domain:** add the gradle ecosystem ([5baa196](https://github.com/DennisRepa/Elevate/commit/5baa1966da88183a2a8f9a84dead4c4628e29d38))
* **process:** move relativeToCwd into the shared process helper ([32938d5](https://github.com/DennisRepa/Elevate/commit/32938d5b677354725fd1943eadb558c6342188d3))


### Documentation

* document Gradle support ([648c293](https://github.com/DennisRepa/Elevate/commit/648c293e0b64f225673c25170503572567031efc))
* **specs:** specify Gradle support ([0f5c8b0](https://github.com/DennisRepa/Elevate/commit/0f5c8b08a7f4e37ee9ff6031414f4c3fcaf4fc4a))

## [1.7.0](https://github.com/DennisRepa/Elevate/compare/v1.6.0...v1.7.0) (2026-11-05)


### Features

* **cargo:** report a locked release that was yanked ([020cbe6](https://github.com/DennisRepa/Elevate/commit/020cbe687d133e9a5f1aac647f449cba1f137e4e))
* **cargo:** report yanked locked releases, document lock limit, correct Node engines ([2ee5eda](https://github.com/DennisRepa/Elevate/commit/2ee5edaff9f16c28c1b94ac44840783e4bde7d64))


### Fixes

* **deps:** declare the Node versions the dependencies actually need ([b513093](https://github.com/DennisRepa/Elevate/commit/b513093005f6283b88a82b4918ac780df1b5ea12))


### Documentation

* **cargo:** note that a pending manifest update hides the lock update ([7aebd16](https://github.com/DennisRepa/Elevate/commit/7aebd16c2f095f18372835a1bc27650e90242a16))

## [1.6.0](https://github.com/DennisRepa/Elevate/compare/v1.5.0...v1.6.0) (2026-11-05)


### Features

* **cargo:** apply lock-only updates and verify the whole workspace ([025f5b9](https://github.com/DennisRepa/Elevate/commit/025f5b9c1a74e83a778dca770ad23b55a74c44b9))
* **cargo:** offer lock-only updates in the scan ([baec221](https://github.com/DennisRepa/Elevate/commit/baec221aea303c8abb2a478121d6d10635db1559))
* **cargo:** select and show lock-only updates in the CLI, MCP and dashboard ([0d3123d](https://github.com/DennisRepa/Elevate/commit/0d3123d9912e502adbbf07b37879ea3a03a9cc7a))
* **cargo:** update Cargo.lock alone when the requirement already allows a newer release ([f7c57d3](https://github.com/DennisRepa/Elevate/commit/f7c57d3cbaaf5e9b9aabe854b19e7f6f73dc5724))


### Documentation

* **cargo:** document lock-file-only updates ([b13e7e9](https://github.com/DennisRepa/Elevate/commit/b13e7e9632396ec285a39f736c6ceb20be3ab6df))
* **specs:** specify lock-file-only updates for Cargo ([cbcbbec](https://github.com/DennisRepa/Elevate/commit/cbcbbecd7de9a81d3a6d5b0ff5a29395680ae713))

## [1.5.0](https://github.com/DennisRepa/Elevate/compare/v1.4.0...v1.5.0) (2026-11-05)


### Features

* **cargo:** add Rust/Cargo as an ecosystem ([#20](https://github.com/DennisRepa/Elevate/issues/20)) ([9217c25](https://github.com/DennisRepa/Elevate/commit/9217c25d55144a9bdb5d9337b9243e9a19b312e0))
* **cargo:** release Cargo support from develop ([1af7416](https://github.com/DennisRepa/Elevate/commit/1af7416e0e2c14e8c9e14d66f34563de5dd82a9f))

## [1.4.0](https://github.com/DennisRepa/Elevate/compare/v1.3.0...v1.4.0) (2026-11-05)


### Features

* **npm:** release pnpm support from develop ([5417763](https://github.com/DennisRepa/Elevate/commit/5417763180f9a013241d70661a87870f2ad02956))
* **npm:** support pnpm repositories ([0d6208d](https://github.com/DennisRepa/Elevate/commit/0d6208dda1ee14cd6f18a7176372b854c8d0fea9))
* **npm:** support pnpm repositories ([b005c9e](https://github.com/DennisRepa/Elevate/commit/b005c9ee0cdacb62ac2d8b4058bd6aac7be3b673))


### Documentation

* describe pnpm support ([892a914](https://github.com/DennisRepa/Elevate/commit/892a91457b3ecc811d49f1f1d37763b6f5d46635))
* specify pnpm support ([cbe93be](https://github.com/DennisRepa/Elevate/commit/cbe93be69b69a46b1972db40fa84a78a9ae67e8d))

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
