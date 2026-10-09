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
| [10-changelog-release.feature](./10-changelog-release.feature) | `REL` | The changelog drives releases |
| [15-gradle-ecosystem-and-modules.feature](./15-gradle-ecosystem-and-modules.feature) | `GRD` | Gradle as the third ecosystem: repository root, builds, modules, the Gradle that is run |
| [16-gradle-declarations-and-catalogs.feature](./16-gradle-declarations-and-catalogs.feature) | `GRDDEC`, `GRDCAT` | Where a Gradle dependency's version is written, what is offered, and `gradle/libs.versions.toml` |
| [17-gradle-versions-and-repositories.feature](./17-gradle-versions-and-repositories.feature) | `GRDVER` | Gradle's version order, the release channel, the repositories a build uses, internal packages |
| [18-gradle-update-and-verification.feature](./18-gradle-update-and-verification.feature) | `GRDUPD` | Writing a Gradle update, refreshing dependency locks, verifying and rolling back |

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
* "No process is started" means: neither `npm`, `mvn`, `gradle` nor a Maven or
  Gradle Wrapper is spawned. Tests prove it by replacing the process boundary
  (`src/adapters/shared/process.ts`, `runMaven` or `runGradle`) with a test
  double.
* Unit tests (`test/unit`) run offline, without Maven, without Gradle and
  without a registry. Scenarios tagged `@integration` need real tools and live
  in `test/integration`.
* The Gradle features (15 to 18) say "Gradle itself is replaced by a test
  double …". The double is `FakeGradle` in `test/gradle-fake.ts`, next to
  `test/maven-fake.ts`. It replaces `runGradle` and does three things: it
  answers a describe run with the document of "The probe protocol", built from
  the steps "Gradle describes the build …" and "Gradle reports for … …"; it
  answers a lookup run with the versions given by "the repositories hold the
  versions …" and the failures given by "the lookup of … fails with …"; and it
  records every run (arguments, working directory, timeout, and the content of
  the scratch directory while the run is active). Files of the tree that the
  code under test reads itself (build scripts, `gradle.properties`,
  `gradle/libs.versions.toml`, lock files) are real files in the temporary
  directory; only Gradle's answer is made up. A step that gives a table of
  projects describes the Gradle build in the tree's top directory unless it
  names another directory.
* The `@integration` scenarios of the Gradle features need a real Gradle and a
  JDK it supports (the facts were checked with 7.6.6 on JDK 17 and with 8.14.3
  and 9.8.1 on JDK 21; 7.6.6 does not run on JDK 21, fact 30). Gradle is found
  as `gradlew` of the fixture or as `gradle` on the PATH. The scenarios need
  no network: fixtures use core plugins only, and repositories that are local
  directories or a loopback HTTP server started by the test. They are skipped
  with `it.skipIf` when `gradle` cannot be started.
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
| `GRD` | `test/unit/gradle-ecosystem.test.ts`; `GRD-48` in `test/integration/gradle.test.ts` |
| `GRDDEC` | `test/unit/gradle-declarations.test.ts` |
| `GRDCAT` | `test/unit/gradle-catalogs.test.ts`; `GRDCAT-18` in `test/integration/gradle.test.ts` |
| `GRDVER` | `test/unit/gradle-versions.test.ts`; `GRDVER-04` and `GRDVER-51` to `GRDVER-55` in `test/integration/gradle.test.ts` |
| `GRDUPD` | `test/unit/gradle-update.test.ts`; `GRDUPD-14` and `GRDUPD-45` to `GRDUPD-48` in `test/integration/gradle.test.ts` |

`GRD-01` to `GRD-07`, `GRD-49` to `GRD-53` and `GRDUPD-38` to `GRDUPD-42` run
the command line, the MCP server and the components through their existing
test helpers (`test/helpers.ts`); the other scenarios call the adapters.

## What the Gradle scenarios rest on

The scenarios 15 to 18 describe a program Elevate does not control: Gradle
runs the build scripts, applies repositories and init scripts, and says what
applies. Each fact below was checked by running the real Gradle on small builds
in a scratch directory outside the repository, on Linux, with **7.6.6** (JDK
17.0.20), **8.14.3** and **9.8.1** (both JDK 21.0.12). 7.6.6 and 9.8.1 are the
last releases of their majors on 2026-10-09; 8.14.3 is the Gradle installed in
the environment (the last 8.x, 8.14.6, was not run). In the column "Checked
with", "all three" means the same result on all three versions; where they
differ, or where only one was run, the row says so. Repositories were local
directories (`file:`) and loopback HTTP servers that log every request; plugin
lookups used the real Gradle Plugin Portal. If a fact changes with a later
Gradle, the scenarios that depend on it are the ones to revisit. What could not
be checked is in the UNVERIFIED table below the facts; no scenario asserts it.

| # | Fact | Checked with | Used by |
| :-- | :--- | :--- | :--- |
| 1 | Gradle lists the versions of a module only to answer a dynamic selector. A detached configuration with the dependency `g:a:+` and `resolutionStrategy.componentSelection.all { record candidate.version; reject }` makes Gradle offer every version of every repository to the rule, newest first within a repository, and end with the failure `Could not find any version that matches g:a:+.` (module unknown: `Could not find any matches for g:a:+ as no versions of g:a are available.`). The same works for the marker of a plugin (`<id>:<id>.gradle.plugin`), against the real Plugin Portal (`org.gradle.test-retry`: 40 versions). | all three | GRDVER-33, 34, 39, 40, 45, 46, 51 |
| 2 | The "not found" end is a `ModuleVersionNotFoundException`; a repository error (HTTP 401 without or with wrong credentials, 500, connection refused) is a `ModuleVersionResolveException` whose chain of messages is `Could not resolve g:a:+.` > `Failed to list versions for g:a.` > `Unable to load Maven meta-data from <url>.` > `Could not GET '<url>'. Received status code 401 from server: Unauthorized`. Right credentials turn the 401 into the success shape. Versions seen before the error are partial (a good repository first: 12 versions, then the failure). After the first repository error Gradle disables that repository for the rest of the run: later lookups fail with `Repository <name> is disabled due to earlier error below:` (8.14.3, 9.8.1) or `Skipped due to earlier error` (7.6.6). A build without repositories ends in the success class (`Cannot resolve external dependency g:a:+ because no repositories are defined.`), so Elevate checks for repositories itself. The verb in the message (HEAD or GET) and the wording of a refused connection (`Connect to … failed: Connection refused` on 7.6.6, `Got socket exception during request.` on 8.14.3 and 9.8.1) differ; the status text does not. | all three | GRDVER-38, 40 to 42, 48, 53 |
| 3 | With a dynamic selector Gradle consults the repositories one after another, and the rule sees their lists back to back: each newest first, a version in several repositories repeated, the whole not sorted (`10.1 … 1.0` from the first repository, `99.0, 1.0` from the second). In a real resolution `g:a:+` picks the highest version over all repositories: with `[internal, public]` and 99.0 only in `public`, the result is 99.0 (dependency confusion); with the group excluded on `public` (fact 4) it is the highest of `internal`. | all three | GRDVER-19, 21, 39, 52 |
| 4 | `repo.content { excludeGroupByRegex(p) }` on a public repository (settings-level at `settingsEvaluated`, project-level at `projectsEvaluated`) stops every request for a matching group: no HTTP request for it reaches that repository, other groups still do. Repositories declared in the settings are not in `project.repositories` and cannot be changed after the settings are evaluated (`Mutation of repositories declared in settings is only allowed during settings evaluation`), so a content filter is the way to protect them. | all three | GRDVER-19 to 22, 52 |
| 5 | The same filter on the `pluginManagement` repositories makes the build's own `plugins { id 'x' version 'v' }` fail for a matching id (`Plugin [id: 'x', version: 'v'] was not found in any of the following sources`). For the lookup of an internal plugin id Elevate instead takes the public repositories out of the project's `buildscript.repositories` and puts them back afterwards: the build's configuration stays intact, no request for the internal id is made, and a public plugin id is still listed (64 versions). | all three | GRDVER-23, 24, 46 |
| 6 | With the default dynamic-version cache (24 hours) Gradle first offers the cached listing to the rule and, because the rule rejects every candidate, fetches the listing again and offers that as well: after 1.2 was published the rule saw `1.1, 1.0, 1.2, 1.1, 1.0`. `resolutionStrategy.cacheDynamicVersionsFor(0, 'seconds')` gives one fresh pass, `1.2, 1.1, 1.0`. | all three | GRDVER-39, 54 |
| 7 | With `org.gradle.configuration-cache=true` (7.x: `org.gradle.unsafe.configuration-cache=true`) the second run reuses the cache and the hooks of an init script do not run: the run succeeds and writes nothing. `--no-configuration-cache` is accepted by all three and forces the hooks. Configure-on-demand does not matter: an init script that touches `allprojects` configures every project. With `-q -m` the standard output still holds `:help SKIPPED`, so the answer is read from a file, never from the console. | all three | GRD-39, 47; GRDVER-34, 55; GRDUPD-06 |
| 8 | After evaluation an init script sees, per configuration, the external module dependencies with `group`, `name`, `version`, `versionConstraint` (`requiredVersion`, `strictVersion`, `preferredVersion`, `rejectedVersions`), artifacts (classifier, extension) and, for platforms, the attribute `org.gradle.category` (`platform` or `enforced-platform`); the entries of `dependencies { constraints { } }` are in `dependencyConstraints`; `project(…)` and `files(…)` are other classes. A dependency without a version has `version` null; `prefer '1.0'` alone gives `version` 1.0 with an empty `requiredVersion`; `reject` alone gives null; `strictly` and `'1.0!!'` give `strictVersion`; dynamic selectors (`1.+`, `latest.release`, `[2.0,2.10)`) are reported as the version text unchanged. The only difference between the versions: `enforcedPlatform` has an empty `strictVersion` on 7.6.6. | all three | GRDDEC-01 to 12, 28 to 30; GRDCAT-04 |
| 9 | `build.gradle.kts` and `settings.gradle.kts` expose the same API (checked with string and named-argument notation, `$v` interpolation, backtick plugin ids and `alias(libs.plugins.x)`). | all three | GRDDEC-02, 15, 23, 24; GRDUPD-48 |
| 10 | Each `plugins { id 'x' version 'v' }` appears as the dependency `x:x.gradle.plugin:v` in `buildscript.configurations.classpath` of the project, also when the version comes from a catalog alias or from `pluginManagement { plugins { } }`; explicit `buildscript { dependencies { classpath … } }` entries are in the same configuration. A plugin applied in the `plugins` block of the settings file is in `settings.buildscript.configurations.classpath` and in no project's. | all three | GRDDEC-11, 23 to 27; GRDCAT-15 |
| 11 | A run with an init script instantiates one Gradle build per build of the composite: the root build (`gradle.parent` is null), every included build and `buildSrc`. The root project of `buildSrc` has the coordinates `:buildSrc:unspecified`; the default group is empty and the default version `unspecified`. Included builds and `buildSrc` are configured before the projects of the root build, and `help` configures every project, including intermediate ones without a build script (`:libs`) and projects a settings file computes (`file('plugins').eachDir { include … }`). | structure: all three; order and computed includes: 8.14.3 | GRD-24 to 31 |
| 12 | Gradle's version order is the algorithm of GRDVER (five steps). It was checked against 24 919 pairs of version strings, 20 503 from a corpus of 203 strings (below), 3 240 from the 81 strings of the tables of GRDVER-01 and 02, and 1 176 from 49 edge strings (empty parts, signs, non-ASCII digits, numbers above 2^63, mixed case): the reference implementation and Gradle disagree in 0 pairs on each version. Ties exist (`1.0-1` and `1.0.1` are different versions that compare equal); only ASCII digits are digits; a number above 9223372036854775807 is a string; special words are case-insensitive (`dev < rc < snapshot < final < ga < release < sp`) and a pair of equal meaning but different case ends the comparison as equal. | all three | GRDVER-01 to 04 |
| 13 | Gradle 9 refuses to resolve a configuration from a `gradle.projectsEvaluated` hook directly on `rootProject` (`Resolution of the configuration ':detachedConfiguration1' was attempted without an exclusive lock. This is unsafe and not allowed.`). Resolving inside `rootProject.allprojects { }`, in `afterEvaluate` or in a task action works. | refusal: 9.8.1; the working places: all three | the probe protocol |
| 14 | Gradle uses the nearest `settings.gradle(.kts)` at or above the working directory. A directory below it that it does not include fails (`Project directory '<dir>' is not part of the build defined by settings file '<file>'. If this is an unrelated build, it must have its own settings file.`, exit 1); a nested directory with its own settings file is its own build. A directory with a build script and no settings file anywhere above is a one-project build (root project named like the directory), without a deprecation warning in `-q` output. From a subproject directory Gradle selects that project (`Project ':inc'`). | all three | GRD-08 to 15, 18 to 20 |
| 15 | An included build substitutes dependencies by group and name, whatever version is requested: `com.acme.logic:build-logic:9.9` is resolved to `project :build-logic` (reason `composite build substitution`), also for a non-root project of the included build (`com.acme.sub:sub:9.9` to `project :inc:sub`), for an included build outside the repository directory, and for an explicit `dependencySubstitution { substitute module('org.explicit:wanted') using project(':') }`. An included build whose root project has no group (coordinates `:shared-lib:3.1.4`) is not substituted for `shared-lib:shared-lib:1.0`. A project of the same build is not substituted: `com.acme:core:1.0.0` equal to the project `:libs:core` stays external, also for older, newer and dynamic versions; it merges with the project only if that is also a direct dependency through `project(':libs:core')` (8.14.3). | all three; the merge: 8.14.3 | GRDVER-25 to 32 |
| 16 | A dependency that comes from a version catalog is a `MinimalExternalModuleDependency` (also inside `platform()` and `enforcedPlatform()`, and as a member of a bundle); a literal is not. | all three | GRDCAT-01 to 18; GRDDEC-04 |
| 17 | A coordinate that is declared twice is reported twice: as a literal and as a catalog entry in the same configuration, and as a dependency and as an entry of `constraints`. | all three | GRDDEC-07, 08, 10; GRDCAT-10 |
| 18 | `:libs:testClasses` for a project without the `java` plugin fails (`Cannot locate tasks that match ':libs:testClasses' as task 'testClasses' not found in project ':libs'.`, exit 1). The selector `:build-logic:testClasses` addresses a project of an included build from the root build; the tasks of `buildSrc` cannot be addressed. | all three | GRDUPD-15 to 18 |
| 19 | `gradle wrapper` writes `gradlew`, `gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar` and `gradle-wrapper.properties` (`distributionUrl`, `networkTimeout`; `validateDistributionUrl` from 8.2 on). `sh gradlew`, `sh ./gradlew`, `./gradlew` and, from a subproject directory, `sh ../gradlew` all run the build of the enclosing settings file (`:app:help` is selected from `app/`). The first run downloads the distribution (about 9 s); `-q` hides the download progress. | the forms: all three (7.6.6 and 9.8.1 from a local archive); the download: 8.14.3 | GRD-35, 36, 39 |
| 20 | Without a JDK, `gradle`, `gradlew` and `bin/gradle` print on the standard error `ERROR: JAVA_HOME is set to an invalid directory: <dir>` or `ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.`, followed by `Please set the JAVA_HOME variable in your environment to match the location of your Java installation.`, and exit with 1. | all three | GRD-38, 43 |
| 21 | After a declared version changed, a build with `gradle/verification-metadata.xml` fails (exit 1) in the first task that resolves the new artifacts: `Dependency verification failed for configuration ':app:compileClasspath'`, `2 artifacts failed verification:` (the jar and the pom, `(com.acme:lib:1.1) from repository acme`) and `If the artifacts are trustworthy, you will need to update the gradle/verification-metadata.xml file.`; a report is written below `build/reports/dependency-verification/`. | all three | GRDUPD-27, 47 |
| 22 | With `dependencyLocking { lockAllConfigurations() }` every project directory holds a `gradle.lockfile` (three comment lines, `g:a:v=config,…`, `empty=…`). `gradle dependencies --write-locks` at the root writes only the root project's file. After a declared version changed without a refresh, the first task that resolves fails (`Could not resolve com.acme:lib:1.1.` … `Constraint path … 'com.acme:lib:{strictly 1.0}' because of the following reason: Dependency version enforced by Dependency Locking`). The same holds for the `buildscript` classpath (`buildscript-gradle.lockfile`), but there every Gradle run fails, `help` included, because it happens while the build is configured (`A problem occurred configuring root project …`); `help --update-locks <g:a>` repairs it. | all three | GRDUPD-04, 06 to 14, 21 |
| 23 | `repositoriesMode` in `dependencyResolutionManagement`: `PREFER_PROJECT` (default) uses the project's repositories when it declares any and the settings' otherwise; `PREFER_SETTINGS` uses the settings' and ignores the project's; `FAIL_ON_PROJECT_REPOS` fails the build (exit 1) when a project declares repositories. Settings repositories are not in `project.repositories`. | all three | GRDVER-14 |
| 24 | The repositories of `pluginManagement` appear in `buildscript.repositories` of a project only as wrappers named `__plugin_repository__<name>` without a URL (class `org.gradle.plugin.use.internal.PluginArtifactRepository`); their URLs are in `settings.pluginManagement.repositories`. Without any, the repository is `Gradle Central Plugin Repository`, `https://plugins.gradle.org/m2`. | all three | GRDVER-15, 16, 24 |
| 25 | A failing build prints everything on the standard error (with `-q` the standard output is empty) and exits with 1: `FAILURE: Build failed with an exception.`, `* What went wrong:`, `* Try:`. Compiler diagnostics precede `FAILURE:` on 7.6.6 and the block only says `see the compiler error output for details`; 8.14.3 and 9.8.1 repeat them inside the block. Configuration errors have `* Where:` with `Build file '<file>' line: <n>`. 9.8.1 appends `(registered by plugin class '…')` to task descriptions. | all three | GRD-42; GRDUPD-10, 21, 25, 27 |
| 26 | Every JVM start prints `Picked up JAVA_TOOL_OPTIONS: …` on the standard error when that variable is set (also for `gradle --version`, the wrapper and failing builds); it is not part of Gradle's error report. | all three | GRD-42 |
| 27 | Under the Gradle daemon a relative path in a `-D` property resolves against the daemon JVM's own working directory (`<GRADLE_USER_HOME>/daemon/<version>`), not against the directory Gradle was started in (`System.getProperty('user.dir')` reports the build directory, `new File('rel')` does not). `gradle.startParameter.currentDir` is the client's directory. `-I <relative path>` is resolved by the client and works. | all three | GRD-39, 40; GRDVER-34 |
| 28 | A scan with a cold daemon takes several seconds (7.4 s on 8.14.3 for a small build with plugin-portal plugins) and every further run with the warm daemon about a second (1.1 and 1.2 s; 0.8 to 1.2 s on 7.6.6 and 9.8.1); `--no-daemon` costs 7 s each time. `gradle --status` lists the idle daemon afterwards; one JVM per Gradle version stays resident. | 8.14.3; warm runs also on 7.6.6 and 9.8.1 | GRD (introduction) |
| 29 | A directory `.gradle/elevate-<id>/` with a script and an answer file below the build's own `.gradle` directory is left alone by Gradle while it runs, next to Gradle's own entries (`7.6.6`, `buildOutputCleanup`, `vcs-1`). | all three | GRD-40 |
| 30 | Gradle 7.6.6 on JDK 21: `gradle --version` works (exit 0), every build fails with exit 1: `Could not open settings generic class cache for settings file '<file>'` > `BUG! exception in phase 'semantic analysis' in source unit '_BuildScript_' Unsupported class file major version 65`. 8.14.3 and 9.8.1 run on JDK 21. | 7.6.6 on JDK 21; 8.14.3 and 9.8.1 on JDK 21 | GRD-44 |
| 31 | A wrapper that cannot fetch its distribution ends with exit 1 and a Java stack trace on the standard error: `Exception in thread "main" java.io.IOException: Unable to tunnel through proxy. Proxy returns "HTTP/1.1 403 Forbidden"` followed by frames of `org.gradle.wrapper.Install.forceFetch` (checked against the blocked `downloads.gradle.org`). | 8.14.3 | GRD-45 |
| 32 | Gradle 7.6.6 does not apply an init script to `buildSrc` (no `settingsEvaluated` and no `projectsLoaded` there); 8.14.3 and 9.8.1 do. Included builds get the script in all three. | all three | GRD-31, 48 |
| 33 | `gradle.properties` in the build's root directory applies to all its projects; `app/gradle.properties` applies to `:app` only and overrides the root value there. The `gradle.properties` of `GRADLE_USER_HOME`, `-P<name>=<value>` and `ORG_GRADLE_PROJECT_<name>` override both (checked with one property: `root`, `app`, then `user`, `cli`, `env`). | all three | GRDDEC-13, 14, 21 |
| 34 | `--update-locks g:a` on `:app:dependencies :core:dependencies` rewrites only that module in the lock files of the named projects and adds the transitive modules its new version brings (`lib` 1.2 brought `extra:1.0` into `gradle.lockfile`). | all three | GRDUPD-06, 07, 14 |
| 35 | A stale lock does not always fail: when the declared version is lower than the locked one Gradle resolves to the locked version, and a transitive request for a higher version is silently resolved down to the locked one (`com.acme:util:1.2` to `1.0`). The task `dependencies` exits with 0 even when the lock state is stale; only tasks that resolve artifacts fail. | all three | GRDUPD-06, 10 |
| 36 | The `dependencies` task of the root project reports only the root project; it must be named per project (`:app:dependencies`). | all three | GRDUPD-06, 09 |
| 37 | `gradle.includedBuilds` is not available in `settingsEvaluated` (`Included builds are not yet available for this build.`), but in `projectsLoaded`. `Settings` has no property for the settings file, only `settingsDir`, so the protocol reports directories. | 8.14.3 | the probe protocol |
| 38 | From the environment the facts were checked in, `downloads.gradle.org` is blocked by organisation policy (HTTP 403 on CONNECT; not retried or routed around), `services.gradle.org` redirects to GitHub releases and works, `plugins.gradle.org` works, and Maven Central answers 429 to parallel downloads now and then (a build that resolved the transitive dependencies of a settings plugin failed once with a resolution error and passed on retry). The integration fixtures therefore use local repositories only. | the environment | GRD-45; the `@integration` scenarios |

**UNVERIFIED** is what could not be checked. No scenario asserts any of it; the
last column says what the specification does instead.

| Topic | Why it is not verified | In the specification |
| :--- | :--- | :--- |
| Windows (`gradlew.bat`, the quoting of arguments such as `:a&b:dependencies`) | no Windows available | GRD-35 and GRDUPD-44 rely on the quoting that `runCommand` already has for Maven; the `@windows` scenarios are unit tests with the double, never run against Gradle |
| Gradle 7.0 to 7.5, 8.0 to 8.14.2, 8.14.4 to 8.14.6, 9.0 to 9.7 | only the three versions above were run | "Gradle 7.6 or newer" is a decision, not a measured boundary (7.6 is the last minor of the 7 line, and 7.6.6 is the oldest version that was run); GRD-33 refuses older ones, newer ones are not refused |
| Gradle 6 and older | not run | refused (GRD-33) |
| Private repositories of a company (Artifactory, Nexus, GitHub Packages, AWS CodeArtifact), `credentials { }` in an init script of the user | no such server; only HTTP basic authentication on loopback was run (401 without or with wrong credentials, success with the right ones) | Elevate never reads or forwards credentials; Gradle applies them (GRDVER-41, 53) |
| Android Gradle Plugin and Kotlin Multiplatform builds | no Android SDK | the word rule for test configurations (GRDDEC-04) and the `assemble` fallback (GRDUPD-15) are decisions; Android and KMP are non-goals |
| Third-party plugins that change dependencies or repositories while a build is configured (dependency-management, Nebula, Shadow, Develocity) | not run; only core plugins and the markers of `org.gradle.test-retry`, `com.github.ben-manes.versions` and the foojay resolver were seen | the describe run reports what Gradle reports; a version a plugin computes is listed as not offered |
| `settings-gradle.lockfile` (locking of the settings' own classpath) | not run | treated like the `buildscript` lock (GRDUPD introduction), expected but not measured |
| Catalogs declared in the settings (`versionCatalogs { create(…) { from(…) } }`), published catalogs, a renamed `libs` | not run | not read; the dependency is listed as not offered (GRDCAT-12) |
| Daemon JVM criteria and toolchain auto-provisioning (`gradle-daemon-jvm.properties`, foojay) | not run | no scenario; they act inside Gradle |
| Proxies that intercept TLS, Gradle's own `systemProp.https.*` settings | not run | Gradle applies them to its own requests; Elevate adds none |
| Explicit `dependencySubstitution` rules | Gradle honours them (fact 15), but their content is not in the objects the probe reads | not read; such a dependency is an ordinary one (the text before GRDVER-19) |

### The version corpus

The 203 strings of the oracle check of GRDVER-04 (fact 12), one per line in
`test/fixtures/gradle-versions/versions-corpus.txt`. They are given here as
one list; none contains a blank, `|` or a non-ASCII character.

<details>
<summary>The 203 strings</summary>

```text
0 0.0 0.1 0.1.0 0.9 0.10 1 1.0 1.0.0 1.0.0.0 1.0.1 1.0.10 1.0.2 1.0.9 1.1 1.1.0
1.2 1.2.0 1.10 1.10.0 1.9 1.9.0 2 2.0 2.0.0 2.0.0.RELEASE 2.0.0.Final 2.0.0.GA
2.0.0.CR1 2.0.0.M1 2.0.0.M2 2.0.0.M10 2.0.0.RC1 2.0.0.RC2 2.0.0-SNAPSHOT
2.0.0-SP1 2.0.0-SP2 2.0.0-alpha 2.0.0-alpha1 2.0.0-alpha.1 2.0.0-alpha.2
2.0.0-alpha01 2.0.0-beta 2.0.0-beta1 2.0.0-beta.2 2.0.0-Beta2 2.0.0-BETA3
2.0.0-rc 2.0.0-rc1 2.0.0-rc.1 2.0.0-rc01 2.0.0-RC1 2.0.0-RC10 2.0.0-dev
2.0.0-dev-5 2.0.0-dev.5 2.0.0-DEV 2.0.0-milestone-1 2.0.0-preview
2.0.0-preview1 2.0.0-ea 2.0.0-ea.5 2.0.0-pre 2.0.0-b05 2.0.0-B05 2.0.0-a1
2.0.0-m1 2.0.0-x 2.0.0-jre 2.0.0-android 2.0.0-final 2.0.0-ga 2.0.0-release
2.0.0-sp 2.0.0-snapshot 2.0.0-1 2.0.0-2 2.0.0-10 2.0.0.1 2.0.0_1 2.0.0+1
2.0.0+build.5 2.0.0+build5 2.0.0+20240101 2.0.1 2.1 2.1.0-SNAPSHOT 3.0.0 10.0
9.0 9.9 31.0-jre 31.0-android 31.1-jre 31.1-android 32.0.0-jre 32.0.0-android
33.0.0-jre 1.9.20 1.9.20-Beta 1.9.20-Beta2 1.9.20-RC 1.9.20-RC2 1.9.20-dev-123
1.9.20-eap-5 1.9.20-M1 8.2.0-alpha01 8.2.0-alpha10 8.2.0-beta01 8.2.0-rc01
8.2.0 6.0.0-M1 6.0.0-M10 6.0.0-RC1 6.0.0 5.3.30 5.3.30.RELEASE 4.13 4.13.1
4.13.2 4.13-beta-1 4.13-beta-2 4.13-rc-1 5.10.0-RC1 5.10.0-M1 5.10.0
2024.01.15 2024.1.5 20240101 20231231 r05 r10 v1.2.3 v1.10.0 1.0-1 1.0-2
1.0-10 1.0_01 1.0_02 1.0.0-20240101.123456-1 1.0.0-20240102.123456-2
main-SNAPSHOT master-SNAPSHOT unspecified a b B c alpha beta Beta 1a 1b 1A 1.a
1.b 1.A 1.0a 1.0b 1.0.a 1.0.b 1.0-a 1.0-b 1.0-A 1.0.0.a 1.0.0.b 1.0aa 1.0ab
1.0.final 1.0.Final 1.0.FINAL 1.0.ga 1.0.GA 1.0.release 1.0.RELEASE 1.0.sp1
1.0.SP1 1.0.SP2 1.0.rc1 1.0.RC1 1.0.dev1 1.0.snapshot 1.0.SNAPSHOT 1.0-SNAPSHOT
1.0-snapshot 1.0.0-SNAPSHOT 1.0.1-SNAPSHOT 1.0.0.Beta1 1.0.0.Beta2 1.0.0.CR1
1.0.0.alpha 1.0.0.zzz 1.0.0-zzz 1.0.0-aaa 1.0.0-AAA 1.0.0-ZZZ 1.0.0-a 1.0.0-z
12.0 12.0.0 12 100 99
```

</details>

## The probe protocol

Elevate asks Gradle through one init script that it carries as the string
constant `PROBE_INIT_SCRIPT` (`src/adapters/gradle/gradle-init-script.ts`) and
writes to `.gradle/elevate-<id>/probe.init.gradle` for the time of a run
(GRD-39, GRD-40). The script is Groovy and uses no API that differs between
Gradle 7.6.6, 8.14.3 and 9.8.1 (facts 8, 13, 37). Its interface:

* **Properties.** `-Delevate.mode=describe` or `lookup`; `-Delevate.outDir`
  (always); `-Delevate.plan` (lookup only). Relative paths are resolved
  against `gradle.startParameter.currentDir` (fact 27).
* **Answers.** Every Gradle build of the run (the root build, each included
  build, `buildSrc`; fact 11) writes one file
  `<outDir>/<mode>-<h>.json`, `h` being the first ten hexadecimal digits of the
  SHA-1 of the build's absolute directory. Elevate reads every `<mode>-*.json`
  below `outDir` and nothing else. Standard output carries no answer (fact 7).
  A describe run that exits with 0 but wrote no file is an error (GRD-47). On
  7.6.6 the script does not run for `buildSrc` (fact 32), so its projects are
  not described there. The script writes nowhere but below `outDir`.
* **Describe.** Hooks: `settingsEvaluated` for what the settings declare,
  `projectsEvaluated` for the projects. It resolves no configuration.
* **Lookup.** At `settingsEvaluated` every public settings repository gets
  `content { excludeGroupByRegex(<pattern>) }` for each pattern of the plan; at
  `projectsEvaluated` the same for every public project repository (fact 4).
  The lookups of a build are then resolved inside `rootProject.allprojects`
  (fact 13), one detached configuration per planned lookup of that build, with
  `cacheDynamicVersionsFor(0, 'seconds')` and a rule that records and rejects
  (facts 1, 6). A plugin lookup uses the configurations of
  `project.buildscript`, and for an internal plugin id the public repositories
  are removed from `buildscript.repositories` for that lookup and restored
  afterwards (fact 5). A public repository is one whose URL, without
  credentials and trailing slash, is in `publicRepositoryUrls`.
* **Credentials.** A repository URL is reported without its
  `user:password@` part.

The **describe document** of one build (blank values are `null`):

```json
{
  "protocol": 1,
  "mode": "describe",
  "gradleVersion": "8.14.3",
  "build": {
    "name": "mono",
    "kind": "root",
    "dir": "/abs/mono",
    "repositoriesMode": "PREFER_PROJECT",
    "settingsRepositories": [{ "name": "MavenRepo", "kind": "maven", "url": "https://repo.maven.apache.org/maven2/" }],
    "pluginRepositories": [{ "name": "corp-plugins", "kind": "maven", "url": "https://nexus.acme.example/plugins" }],
    "settingsPlugins": [{ "id": "org.example.settings", "version": "1.0" }]
  },
  "projects": [
    {
      "path": ":app", "name": "app", "dir": "/abs/mono/app",
      "buildFile": "/abs/mono/app/build.gradle",
      "group": "com.acme", "version": "1.0.0",
      "repositories": [{ "name": "acme", "kind": "maven", "url": "https://nexus.acme.example/releases" }],
      "buildscriptRepositories": [{ "name": "__plugin_repository__corp-plugins", "kind": "maven", "url": null }],
      "dependencies": [
        { "configuration": "implementation", "group": "org.example", "name": "lib", "version": "1.0",
          "strictly": null, "preferred": null, "rejected": [], "category": null,
          "fromCatalog": false, "classifier": null, "extension": null }
      ],
      "constraints": [{ "configuration": "implementation", "group": "org.example", "name": "lib", "version": "1.0", "strictly": null }],
      "projectDependencies": [{ "configuration": "implementation", "path": ":core" }],
      "buildscriptDependencies": [{ "group": "org.example.plugin", "name": "org.example.plugin.gradle.plugin", "version": "1.0" }],
      "tasks": ["testClasses", "assemble"],
      "lockfile": true
    }
  ]
}
```

`kind` of the build is `root`, `included` or `buildSrc`; of a repository
`maven`, `ivy`, `flatDir` or `other`. `category` is `platform`,
`enforced-platform` or `null`. `tasks` holds the names `testClasses` and
`assemble` that exist in the project (fact 18). `lockfile` tells whether
`<dir>/gradle.lockfile` exists. `projects` has every project of the build,
the root project first. `gradleVersion` is compared with 7.6 (GRD-33). A
dependency that is not an external module and not a project dependency is not
reported.

The **plan** of a lookup run is shown in GRDVER-33: `protocol`,
`publicRepositoryUrls`, `internalGroupPatterns` and `lookups[]` with `id`,
`buildRoot`, `project`, `kind` (`module` or `plugin`), `group` and `name`;
`buildRoot` is the `build.dir` of the build the project belongs to.

The **lookup document** of one build:

```json
{
  "protocol": 1,
  "mode": "lookup",
  "results": [
    { "id": "L1", "versions": ["1.1", "1.0"], "error": null },
    { "id": "L2", "versions": [], "error": "Could not resolve org.example:b:+. > Could not GET 'https://corp/b'. Received status code 500 from server: Internal Server Error" }
  ]
}
```

`results` is in the order in which Gradle performed the lookups of that
build. `versions` are the versions the rule saw, in that order, duplicates
kept (facts 3, 6). `error` is `null` when Gradle ended with the "not found"
failure (fact 2), whatever it saw, and otherwise the first line of the message
of the failure and of each of its causes, joined with `" > "`; the versions of
such a lookup are not used (GRDVER-42). A lookup that the plan names and no
document answers is a failed lookup (GRDVER-43).

## Gradle: scope and non-goals

What version 1 does: Gradle 7.6 or newer (checked with 7.6.6, 8.14.3, 9.8.1),
Groovy and Kotlin DSL, the dependencies, platforms, constraints and plugins
that Gradle reports for the projects of a build (including included builds and
`buildSrc`), written where the scan found the text; versions in
`gradle.properties`, `ext` and local variables, and in
`gradle/libs.versions.toml`; the lookup of newer versions through the
repositories of the build; the refresh of dependency locks of the root build;
verification by compiling the affected projects. Everything else that Gradle
reports is either listed as not offered, with the reason, or is a non-goal:

| Non-goal | Behaviour | Reason |
| :--- | :--- | :--- |
| Updating the Gradle Wrapper itself (`gradle-wrapper.properties`, `distributionSha256Sum`, the jar) | not offered, not listed | it is not a dependency: it needs `gradle wrapper`, regenerates a binary and has its own checksum; a different safety net |
| Android Gradle Plugin and Kotlin Multiplatform builds | not refused, not promised; the generic rules apply | no Android SDK to verify; variants make configurations and tasks differ from the JVM case (unverified) |
| Regenerating `gradle/verification-metadata.xml` | never; the update is rolled back with Gradle's words | a regenerated file records the checksum of whatever was downloaded and defeats the purpose of the file (GRDUPD-27) |
| Gradle older than 7.6 | refused with a message (GRD-33) | the API the init script uses and the JDK compatibility were not verified for it; 7.6.6 is the oldest version that was run |
| Versions that scripts compute (concatenation, function calls, `versions.lib` maps), `apply from:` scripts, convention plugins in `buildSrc` or an included build, init scripts | listed as not offered, `declaration-mismatch` | the text that carries the version cannot be established with certainty from the files; guessing could change the wrong place (GRDDEC-30, 31) |
| Dynamic and rich versions (`1.+`, `[1.0,2.0)`, `latest.release`, `strictly`, `reject`, `prefer`) | listed as not offered, `version-constraint` | the selector is the declaration, not a version; changing a number would change its meaning (GRDDEC-28, 29) |
| Catalogs other than `gradle/libs.versions.toml` of the build | listed as not offered, `declaration-mismatch` | other catalogs are declared by code in the settings; same reason as computed versions (GRDCAT-12) |
| Locks of `buildSrc`, of included builds, of the `buildscript` classpath and of the settings | the update of a module of an included build with locks is refused (GRDUPD-12); the others fail the verification and are rolled back | refreshing needs a Gradle run per build and per lock kind, and a half-refreshed lock state is worse than none; the facts about `buildscript` locks (fact 22) show how to extend it later |
| Plugins applied in the settings file (`plugins { }` of `settings.gradle`) | not subjects, not listed | they resolve through the settings' own classpath (fact 10), not through project plugin management; rare |
| Explicit `dependencySubstitution` rules | not read; the dependency is an ordinary one | Gradle honours them but the probe does not see them (fact 15); the internal-package guard still applies |
| Alignment between ecosystems (a Gradle project that depends on a module built by Maven in the same repository) | none | the other ecosystem's modules are not in the Gradle workspace index; same as Maven and npm today |
| Elevate-side repository or credential settings for Gradle | none | the repositories are the build's own and Gradle applies mirrors, credentials and proxies; Elevate never contacts a repository |
| `--offline`, `--refresh-dependencies`, `--no-daemon`, `--parallel` | not passed | the lookup must see what a normal build sees, with the project's daemon and settings (fact 28); `cacheDynamicVersionsFor(0)` is set inside the lookup instead (fact 6) |
| Windows | specified (`gradlew.bat`, argument safety), UNVERIFIED | see the UNVERIFIED table above |

`elevate versions` without `--ecosystem` keeps choosing Maven for an
identifier with a colon and npm for any other (GRD-07); Gradle needs the
option.

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

### GRD

* `src/domain/models.ts`: `Ecosystem` becomes `'npm' | 'maven' | 'gradle'`;
  new export `isJvmEcosystem(ecosystem: Ecosystem): boolean`, true for
  `'maven'` and `'gradle'`. Everything that tests `ecosystem === 'maven'` to
  decide how coordinates, scopes and versions are handled uses it instead:
  `matchesInternalScope` in `origin.ts`, `coordinateFromIdentifier` in
  `version-lookup.ts`, `computeDiff` and the branches for a hand-picked version
  and for "no pending update" in `update-selection.ts`, and `use-packages.ts`.
  The word "Maven" in the message of GRDUPD-34 is the build tool's name,
  "Maven" or "Gradle".
* `ProjectModule` gains the optional fields `buildDir`, `buildRoot`
  (absolute paths), `buildKind: 'root' | 'included' | 'buildSrc'` and
  `coordinates` (`group:name`), with the meaning of the table in
  `15-gradle-ecosystem-and-modules.feature`. `aggregatorDir` stays Maven's.
* `buildWorkspaceIndex` in `origin.ts` keys a module by
  `module.coordinates ?? module.id`: npm and Maven modules have no
  `coordinates`, so nothing changes for them. The Gradle scanner takes its
  decision whether a dependency is substituted from its own table (GRDVER
  below), not from `context.workspace`.
* `EcosystemFactory.getAvailableEcosystems()` returns
  `['npm', 'maven', 'gradle']`; the order is the order `findRepositoryRoot`
  asks in and the order the dashboard cycles through. New static
  `EcosystemFactory.next(current: Ecosystem): Ecosystem` (GRD-04); `app.tsx`
  uses it for `nextEcosystem` and `toggleEcosystem`. `getStrategy('gradle')`
  returns a `GradleEcosystemStrategy`. `EcosystemSettings` does not change and
  `elevate.config.json` gets no Gradle key.
* `src/adapters/gradle/gradle-strategy.ts` exports
  `class GradleEcosystemStrategy implements EcosystemStrategy` with
  `ecosystem 'gradle'`, `displayName 'Java / Gradle'`, `icon '🐘'`,
  `manifestFile 'build.gradle'` and `getTabLabels` that returns
  `t.tabs.all(total)`, `t.tabs.main(prodCount)` and
  `t.tabs.testAndPlugins(devCount)`. `src/i18n/types.ts`, `locales/en.ts` and
  `locales/de.ts` gain `tabs.main` (`[2] Main (n)`, `[2] Haupt (n)`) and
  `tabs.testAndPlugins` (`[3] Test & plugins (n)`, `[3] Test & Plugins (n)`).
  The Maven labels are not touched.
* `src/cli/parser.ts`: `CliOptions.ecosystem` is typed `Ecosystem`; the two
  places that accept `npm` and `maven` accept `gradle` as well; the help line
  reads `-e, --ecosystem <npm|maven|gradle>`. `src/mcp/mcp-server.ts`: the
  shared `ecosystem` property gets `enum: ['npm', 'maven', 'gradle']`, the
  cast uses `Ecosystem`, the tool description names Java/Gradle
  (`build.gradle`), and `elevate_discover_modules` adds `buildKind` to Gradle
  modules only. `src/cli/command-modules.ts` prints the strategy's icon and
  name and, in JSON, the module fields that exist (so `buildKind`, `buildDir`,
  `buildRoot` and `coordinates` appear for Gradle only). `mascot.tsx` treats
  `'gradle'` like `'maven'` (GRD-53).
* `src/adapters/shared/process.ts` additionally exports `relativeToCwd`
  (moved from `maven-command.ts`, which re-exports it, so WIN keeps its
  contract); `runGradle` uses it to name the wrapper and the scratch files.
* `src/adapters/gradle/gradle-command.ts` exports
  `class GradleUnavailableError extends Error` (name
  `'GradleUnavailableError'`, message of the first row of GRD-38),
  `class GradleCommandError extends Error` (name `'GradleCommandError'`,
  constructor `(message: string, readonly output: string)`),
  `class GradleVersionError extends Error` (name `'GradleVersionError'`),
  `findGradleWrapper(fromDir: string, rootDir: string): string | undefined`
  (`gradlew`, on Windows `gradlew.bat`; like `findMavenWrapper`),
  `interface GradleRunOptions { cwd: string; rootDir: string; timeoutMs?: number }`,
  `runGradle(args: string[], options: GradleRunOptions): Promise<RunResult>`
  (it adds no arguments: callers pass the full list of the tables in 15 and
  18; the `gradle --version` check runs once per process and is remembered)
  and `gradleErrors(result: Pick<RunResult, 'stdout' | 'stderr'>): string`
  (the details rule of GRD-42). The wrapper download message of GRD-45 reads
  the `distributionUrl` of `gradle/wrapper/gradle-wrapper.properties` (unescape
  `\:`). Timeouts are named `Gradle timed out after <n> minutes while <what>.`
  (GRD-46, GRDVER-44, GRDUPD-11).
* `src/adapters/gradle/gradle-init-script.ts` exports
  `PROBE_INIT_SCRIPT: string`. `src/adapters/gradle/gradle-probe.ts` exports
  the typed documents of "The probe protocol" (`GradleBuildDocument`,
  `GradleProjectDocument`, `GradleRepositoryDocument`, `LookupPlan`,
  `LookupResultDocument`), `runDescribe(buildDir: string, rootDir: string): Promise<GradleBuildDocument[]>`
  and `runLookup(buildDir: string, rootDir: string, plan: LookupPlan): Promise<LookupResultDocument[]>`.
  Both create `.gradle/elevate-<8 hex digits>/` below `buildDir` with the
  random id from `node:crypto`, write the script (and the plan), run, read
  `out/`, and remove exactly that directory in `finally`. `runDescribe`
  refuses a document whose `gradleVersion` is below 7.6 with a
  `GradleVersionError`.
* `src/adapters/gradle/gradle-discovery.ts` exports
  `class GradleModuleDiscoveryAdapter implements ModuleDiscoveryPort`
  (`discover`, `findRoot`) and `findGradleBuildDirs(rootDir: string): string[]`
  (the static walk of GRD-18 to GRD-26; absolute, sorted). `findRoot` reads
  settings files as text and starts no process. Module ids, `relPath`,
  `buildDir`, `buildRoot` and `buildKind` are built here from the documents.
  Scanning, verifying and updating use the described builds of one
  `discover` call only through `ProjectModule`; nothing is cached across scans.
* Fixtures: `test/fixtures/gradle-composite/` (GRD-48: a root build with
  `app`, `libs/core`, an included `build-logic` and a `buildSrc`; core
  plugins only), `test/fixtures/gradle-catalog/` (GRDCAT-18, GRDUPD-48: Kotlin
  DSL, `gradle/libs.versions.toml`, module `:app` using `libs.lib`),
  `test/fixtures/gradle-multi-project/` (GRDUPD-45 to 47: `:app` calling a
  method of `com.acme:lib`, `:core`) and `test/fixtures/gradle-locking/`
  (GRDUPD-14: `lockAllConfigurations()` in two projects). Jars are not
  committed: a helper in `test/helpers.ts`, `writeJarRepository(dir, spec)`,
  compiles tiny classes with the JDK and writes a Maven-layout directory with
  `maven-metadata.xml`, poms and jars into the copy of the fixture.

### GRDDEC

* `VersionDeclaration.kind` gains `'catalog'` and `'plugin'`; the interface
  gains `catalogName?: string` and `entry?: string`. `UpdateCandidate` gains
  `declarations?: VersionDeclaration[]`: every place the version is written,
  `declaration` being the first. `candidateToJson` writes `declaredIn` with
  `file`, `kind`, `property`, `catalog` (from `catalogName`) and `entry`
  (GRDDEC-37), and `alsoDeclaredIn` with the others when there are several
  (GRDDEC-38). `sharedWith` lists the identifiers of the other dependencies
  that use the same property or catalog version.
* `SkipReason` gains `'version-constraint'`. `describeSkip` in
  `src/application/describe.ts` and `Translations.list.skipReason` in
  `locales/de.ts` and `en.ts` cover it with the texts of GRDDEC-40.
* `src/adapters/gradle/gradle-text.ts` exports
  `findStringLiterals(source: string, dsl: 'groovy' | 'kotlin'): StringLiteral[]`
  with `StringLiteral { value: string; start: number; end: number; quote: string }`
  (comments are skipped, offsets refer to `source`, the value is the text
  between the quotes), `GradleTextEdit { start: number; end: number; expected: string; replacement: string }`
  and `applyGradleEdits(source: string, edits: readonly GradleTextEdit[]): string`,
  which throws `StaleEditError` (from `shared/xml.ts`) with the message
  `'<found>' found where '<expected>' was expected. The file changed since it was scanned.`
  for an edit whose range no longer holds `expected`, and for overlapping edits.
  Every file is read with `utf8` and written with `utf8`, so a byte order mark
  and line endings survive (GRDDEC-34).
* `src/adapters/gradle/gradle-locator.ts` exports
  `locateDeclarations(request: LocateRequest): LocateResult`, a pure function
  of the module's directory, the build's root directory, the dependency as
  Gradle reported it and the files (read through an injected `read(file)`), that
  returns the `VersionDeclaration`s with their text ranges or a reason
  (`declaration-mismatch` with the detail of GRDDEC-20 to 22, 30, 31 and
  GRDCAT-11, 12). The scanner calls it once per reported dependency of the
  module; it never decides anything the text does not show: a location counts
  only if the text at the range is exactly the version Gradle reported.
* `src/adapters/gradle/gradle-updater.ts` exports
  `class GradleUpdaterAdapter implements DependencyUpdaterPort`. It re-reads
  every file named by a declaration, computes all edits for all files, writes
  only afterwards (GRDDEC-36), and for edits that fall on the same range
  requires the same target (GRDDEC-19: `InstallError` with the message shown
  there). Its `ApplyOutcome` for GRDUPD-01: `updatedCount` is the number of
  candidates, `auditMessage` is
  `Updated <n> version declaration(s) in <m> file(s).` where `n` is the number
  of candidates and `m` the number of files written, followed by
  ` Refreshed <k> dependency lock file(s).` when locks were refreshed;
  `integrityViolations` is `[]`; there is no `fundingMessage`.

### GRDCAT

* New dependency `smol-toml` in `package.json` reads
  `gradle/libs.versions.toml` (TOML 1.0, dotted keys, inline tables). It was
  checked in version 1.9.1 (BSD-3-Clause, no dependencies): it parses every
  entry form of GRDCAT-01 to 05, a file with CRLF line endings and one with a
  byte order mark, and throws a `TomlError` for a broken file. It gives
  values, not positions: `src/adapters/gradle/gradle-catalog.ts` exports
  `readCatalog(file: string): GradleCatalog | undefined` (values, with the
  entry ids `versions.<key>`, `libraries.<key>`, `plugins.<key>`) and
  `catalogVersionRange(source: string, entry: string): { start: number; end: number } | undefined`,
  a small scanner of the three tables that finds the characters of one version
  string and nothing else. It is exercised by GRDCAT-16 with comments, odd
  spacing, CRLF and a byte order mark. An unparsable file is `undefined`; the
  dependencies that come from the catalog are then listed as
  `declaration-mismatch` with the detail of GRDCAT-12.
* The catalog is always the file `gradle/libs.versions.toml` in the build
  directory of the module (`buildRoot`); the catalog name written into
  `VersionDeclaration.catalogName` is `libs`.

### GRDVER

* `src/adapters/gradle/gradle-versions.ts` exports
  `compareGradleVersions(a: string, b: string): number` (positive when `a` is
  newer; 0 for ties), `sortGradleVersions(versions: readonly string[]): string[]`
  (newest first, equal versions in their given order, duplicates removed) and
  `isNewerGradleVersion(candidate: string, current: string): boolean`. The
  reference implementation is the five steps of GRDVER and was used for the
  oracle of fact 12; it does not use `semver`. The latest version is chosen
  like `pickLatest` of the Maven adapter, with this comparator in place of the
  Maven one and `isPreReleaseVersion` for the channel.
* `src/adapters/gradle/gradle-repositories.ts` exports
  `effectiveRepositories(build: GradleBuildDocument, project: GradleProjectDocument, kind: 'module' | 'plugin'): GradleRepositoryDocument[]`
  (GRDVER-14 to 16),
  `isPublicRepositoryUrl(url: string | null): boolean` (GRDVER-17; the host list
  of that scenario),
  `normalizeRepositoryUrl(url: string): string` (no `user:password@`, no
  trailing slash; GRDVER-18, 21),
  `internalGroupPatterns(internalScopes: readonly string[]): string[]`
  (GRDVER-19) and
  `buildLookupPlan(requests: readonly LookupRequest[], internalScopes: readonly string[]): LookupPlan`
  (GRDVER-33), where one request is `{ buildRoot; project; kind; group; name }`
  and identical requests of projects with the same repositories are written
  once (GRDVER-35, 36).
* `src/adapters/gradle/gradle-registry.ts` exports
  `class GradleRegistryAdapter implements RegistryPort`. `resolveEndpoint`
  answers from the repositories of the root project of the first described
  build (the build in the repository root): the first non-public repository, or
  the first public one when there is no other (then `isPublic` is true and
  `lookupVersions` of `version-lookup.ts` refuses an internal package, GRDVER-47).
  `getLatestVersion` and `getAllVersions` run one lookup run for the plugin or
  module (GRDVER-45, 46); a failed lookup throws an `Error` whose message is the
  detail (GRDVER-48). `src/index.tsx` and the CLI create one registry per
  strategy as for Maven.
* `src/adapters/gradle/gradle-scanner.ts` exports
  `class GradleDependencyAdapter implements DependencyReaderPort` with `scan`
  and `scanMany`. One describe run per build directory and one lookup run per
  build directory serve all modules of a call (GRDVER-35); the substitution
  table (fact 15) is built from all described builds of `kind 'included'`,
  with every project that has a group, including builds outside the repository
  (GRDVER-30) and excluding the builds the scanned module belongs to; the
  `UpdateCandidate.origin` is `workspace` for a substituted dependency, with
  `action: 'align'`, `availableVersions: [<local version>]` and no lookup;
  a substituted dependency whose version already equals the local one is
  neither offered nor listed (GRDVER-26).
* `lookup-failed` has the detail of the last message of the failure chain with
  credentials stripped; for a failure that only says "disabled due to earlier
  error" or "Skipped due to earlier error" the detail of the first failed
  lookup of the run (GRDVER-41). A project without repositories gets
  `lookup-failed` with the detail `the build declares no repository for <path>`
  and starts no lookup (GRDVER-38).
* Corpus check: `test/fixtures/gradle-versions/versions-corpus.txt` holds the
  203 strings above, one per line. GRDVER-04 writes the module `ord:t` with
  those versions, in a scrambled order, to a file repository, lets the lookup
  run list it, and compares neighbours with `compareGradleVersions`.

### GRDUPD

* `src/adapters/gradle/gradle-locks.ts` exports
  `findLockFiles(buildDir: string): string[]` (absolute, sorted; walks as
  described in GRDUPD, skipping `node_modules`, `build`, `target`, `dist`,
  `out` and dot directories) and
  `refreshLocks(module: ProjectModule, rootDir: string, coordinates: readonly string[]): Promise<number>`,
  which describes the build, names `:dependencies` for each project with
  `lockfile: true` in path order, runs the refresh command of 15 and returns
  the number of lock files that exist afterwards. A failure throws
  `InstallError('Refreshing the Gradle dependency locks failed\n<gradleErrors>')`
  or, for a timeout, `Refreshing the Gradle dependency locks timed out after 10 minutes.`
  With a Windows shell a task name that cannot be passed safely
  (`UnsafeArgumentError`) is rethrown as `InstallError` with its message
  (GRDUPD-44).
* `GradleUpdaterAdapter.affectedFiles` returns the files of the declarations,
  in candidate order and without repeats, followed by `findLockFiles` of the
  build directory (GRDUPD-04); `applyUpdates` refuses the update of a module of
  an included build or `buildSrc` whose build has lock files, with the message
  of GRDUPD-12, before it changes anything; `resync` does nothing.
* `src/adapters/gradle/gradle-verifier.ts` exports
  `class GradleVerificationAdapter implements VerificationPort` and
  `planGradleBuild(module: ProjectModule, build: GradleBuildDocument[], changedFiles: readonly string[]): { tasks: string[]; label: string }`
  (GRDUPD-15 to 18: a pure function of the described build; tested without a
  process). `verify` describes the build, plans, runs `<gradle> -q
  --console=plain <tasks>` in `module.buildDir` with a 30 minute timeout, and
  maps the result as GRDUPD-20 to 25 say; a custom script runs through
  `runShellScript` in `module.buildDir`.
* `update-selection.ts`: `selectRequested` reads `availableVersions` for
  `isJvmEcosystem` and builds the messages of GRDUPD-33 to 37 (the list of
  available versions is cut after five entries with an ellipsis, as for
  Maven).

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

### Gradle support

These belong to the change that implements features 15 to 18 and are checked
by review. Items 1 and 2 of the list above are extended, not replaced.

1. `README.md`: the table "Supported Package Managers" gets a Gradle row
   (`Gradle` with `gradlew` / `gradle`; `build.gradle`, `build.gradle.kts`,
   `settings.gradle(.kts)` and `gradle/libs.versions.toml`; the repositories
   the build itself declares, with its mirrors and credentials; projects of
   the settings, included builds and `buildSrc`; verification by compiling the
   affected projects) and `Gradle` leaves the "Planned" sentence. **Scope and
   known limits** says: Gradle 7.6 and newer (checked with 7.6.6, 8.14.3 and
   9.8.1), Groovy and Kotlin DSL; a version is changed where its text is found
   (literals, `gradle.properties`, `ext` and local variables, the version
   catalog `gradle/libs.versions.toml`, the `plugins` block); dynamic and rich
   versions, computed versions, versions defined in convention plugins,
   `apply from:` scripts or other catalogs are listed as not offered; the
   Gradle Wrapper is never updated; `verification-metadata.xml` is never
   regenerated, so a build that uses it rolls such an update back; dependency
   locks are refreshed for the root build only; Android and Kotlin
   Multiplatform builds are not verified; Windows is not verified. The
   Keyboard section is unchanged; the `E` key now cycles through three
   ecosystems.
2. `docs/en.md` and `docs/de.md`: the feature bullets and the overview name
   Gradle; "Aligning workspace modules" gets the paragraph on included builds
   (substitution by group and name, never a lookup); "Private registries &
   dependency confusion" explains the content filter (`excludeGroupByRegex`)
   and the public host list; new sections "Where Gradle versions are written"
   (the search order and the table of forms of 16), "Version catalogs", "The
   Gradle runs Elevate makes" (the command table of 15 and 18, the scratch
   directory `.gradle/elevate-<id>/`, the daemon, the wrapper, the init script
   that is carried), "Dependency locking and dependency verification",
   "Requirements for Gradle" (a JDK, Gradle 7.6+, a wrapper or `gradle` on the
   PATH; Gradle 7.6.6 does not run on JDK 21, fact 30, and the JDK range of
   each Gradle version is Gradle's to state, it was not checked here); the
   architecture tree lists the new files of the contract; the MCP section shows
   `gradle` as a value of `ecosystem`; the skip reason `version-constraint`.
3. `CHANGELOG.md` lists every behaviour change under `## Unreleased`: Gradle
   is supported (new ecosystem value `gradle`, the `E` key cycles through
   three ecosystems), the new skip reason `version-constraint`, the new
   `declaredIn` kinds `catalog` and `plugin` and the field `alsoDeclaredIn` in
   JSON output, the new optional module fields `buildKind`, `buildDir`,
   `buildRoot` and `coordinates`.
4. `src/i18n/locales/de.ts` and `en.ts`: `list.skipReason['version-constraint']`,
   `tabs.main` and `tabs.testAndPlugins` (texts in GRDDEC-40 and GRD-52).
5. `package.json`: `smol-toml` in `dependencies`; keyword `gradle`.
6. `.github/workflows/ci.yml`: a job `Gradle (${{ matrix.gradle }})` on
   `ubuntu-latest` that installs JDK 17 with Gradle 7.6.6, JDK 21 with Gradle
   8.14.3 and JDK 21 with Gradle 9.8.1 (for example with
   `actions/setup-java` and `gradle/actions/setup-gradle` with
   `gradle-version`), and runs `npm run test:integration`, so that the
   `@integration` scenarios of 15 to 18 run on every change. The facts above
   should be re-checked when a new Gradle major appears; Windows can be added
   to the matrix once someone has checked the `@windows` scenarios against a
   real Gradle.
7. Optional: `src/cli/command-init.ts` mentions Gradle where it lists the
   registries it can query; `docs/` shows `elevate versions org.slf4j:slf4j-api --ecosystem=gradle`.
