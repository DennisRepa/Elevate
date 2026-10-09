Feature: Updating a Gradle build safely
  Elevate writes the new versions to the files that declare them (specs/16),
  brings the dependency locks of the build up to date when it uses them, and
  lets the build itself judge the result: a failed lock refresh, compile or
  dependency verification restores every touched file. Gradle has no
  installation step and no installed state to repair, so the safety net is the
  snapshot of the files and a Gradle run that resolves and compiles what was
  changed. This page fixes the commands, what they are judged by, and what is
  deliberately left to the user. In the commands below <gradle> is the
  wrapper or `gradle` as in specs/15 and the working directory is the
  directory of the Gradle build of the module (`buildDir`).

    | Step                      | Command                                                                              | Timeout | When                                                       |
    | write the versions        | (no process)                                                                          |         | always                                                     |
    | describe (only for locks) | the describe run of specs/15                                                         | 5 min   | a gradle.lockfile exists in the build                      |
    | refresh the locks         | <gradle> -q --console=plain --no-configuration-cache <path>:dependencies … --update-locks <group:name,…> | 10 min  | the root build has lock files and a library was updated    |
    | verify                    | <gradle> -q --console=plain <task> …                                                  | 30 min  | unless verification is skipped; with a `postUpdateScript` that script instead |

  Four facts decide the design (specs/README.md, facts 21, 22, 34, 35 and 36):

    * With dependency locking (`dependencyLocking { lockAllConfigurations() }`)
      a lock file `gradle.lockfile` sits in each project directory. After a
      declared version is raised, compiling fails with "Dependency version
      enforced by Dependency Locking" until the lock is refreshed. The task
      `dependencies` must be named per project (`:app:dependencies`); at the
      root it reports the root project only. `--update-locks g:a` rewrites
      that module and adds the transitive modules its new version brings.
    * A stale lock does not always fail: a lower declared version, or a
      transitive request for a higher one, is silently resolved down to the
      locked version. All lock files of the build are therefore refreshed
      together, not only that of the updated module.
    * With dependency verification (`gradle/verification-metadata.xml`) every
      artifact of the new version is unknown to the file and the compile fails
      with "Dependency verification failed for configuration …". Regenerating
      the file (`--write-verification-metadata`) would record the checksum of
      whatever was downloaded, which defeats the file. Elevate never does it:
      the update is rolled back with Gradle's message, and the user decides.
    * `dependencies` exits with 0 even when the lock state is stale or a
      version cannot be resolved; only tasks that resolve artifacts fail. The
      refresh step therefore cannot be judged by its exit code alone, and the
      verification that follows it is what finds a bad refresh.

  Dependency locking of the `buildscript` classpath (`buildscript-gradle.lockfile`)
  is not refreshed: after an update that invalidates it every Gradle run fails
  while it configures the build (fact 22), so the verification reports Gradle's
  words and the update is rolled back. The same is expected for the settings
  (`settings-gradle.lockfile`), which was not measured (UNVERIFIED in
  specs/README.md).

  Background:
    Given Gradle itself is replaced by a test double that answers describe runs with the builds given below and records every other run
    And the release channel is "stable"
    And the tree contains "settings.gradle" with the text "include 'app', 'core'"
    And Gradle describes the build "mono" in "." with the projects
      | path  | dir  | build file         | group    | version |
      | :     | .    | build.gradle       | org.mono | 1.0.0   |
      | :app  | app  | app/build.gradle   | org.mono | 1.0.0   |
      | :core | core | core/build.gradle  | org.mono | 1.0.0   |
    And ":app" depends on the project ":core"
    And the projects ":", ":app" and ":core" all have the tasks "testClasses" and "assemble"
    And the file "app/build.gradle" contains
      """
      dependencies {
          implementation project(':core')
          implementation 'org.example:lib:1.0'
      }
      """
    And an update candidate for "org.example:lib" from "1.0" to "1.1" declared in "app/build.gradle"

  Rule: The versions are written first and checked afterwards

    The files that may change are the files named by the declarations of the
    candidates, in the order of the candidates, followed by every
    `gradle.lockfile` below the directory of the build, sorted by path. The
    lock files are found by walking the directory without entering
    directories named node_modules, build, target, dist or out or starting with
    ".". Declarations of one candidate that lie in several files are written
    together, and every edit is computed before the first file is written
    (specs/16, GRDDEC-36).

    Scenario: GRDUPD-01 The outcome says what was written
      When the Gradle updater applies the candidate to the module ":app"
      Then "app/build.gradle" differs from the original only in the text "1.0" being replaced by "1.1"
      And the outcome is updated count 1, audit severity "clean" and audit message "Updated 1 version declaration(s) in 1 file(s)."
      And the outcome has no funding message and no integrity violation
      And no process is started

    Scenario: GRDUPD-02 Declarations in several files are written together
      Given the tree contains
        """
        gradle.properties              v=1.0
        """
      And the candidate for "org.example:lib" is declared in the property "v" of "gradle.properties" and in "app/build.gradle"
      When the Gradle updater applies the candidate to the module ":app"
      Then "gradle.properties" contains "v=1.1" and "app/build.gradle" contains "1.1" where it contained "1.0"
      And the audit message is "Updated 1 version declaration(s) in 2 file(s)."

    Scenario: GRDUPD-03 A candidate without a known declaration is refused
      Given an update candidate for "org.example:other" from "1.0" to "1.1" without a declaration
      When the Gradle updater applies the candidates to the module ":app"
      Then it fails with an InstallError
      And the message is
        """
        No version declaration known for org.example:other; rescan the module.
        """
      And no file of the tree is changed

    Scenario: GRDUPD-04 The files that may change are the declarations and the lock files of the build
      Given the tree contains
        """
        gradle.properties              v=1.0
        app/
          gradle.lockfile              # lock
        core/
          gradle.lockfile              # lock
        buildSrc/
          gradle.lockfile              # lock
        build/
          gradle.lockfile              # leftover
        """
      And the candidate for "org.example:lib" is declared in the property "v" of "gradle.properties" and in "app/build.gradle"
      When the files the update of the module ":app" may modify are requested
      Then they are, in this order
        | file                |
        | gradle.properties   |
        | app/build.gradle    |
        | app/gradle.lockfile |
        | buildSrc/gradle.lockfile |
        | core/gradle.lockfile |
      And "verification-metadata.xml" is not among them

    Scenario: GRDUPD-05 Nothing is started when the build has no lock files
      Given the tree contains no file "gradle.lockfile"
      When the Gradle updater applies the candidate to the module ":app"
      Then no process is started

  Rule: Dependency locks are refreshed with Gradle's own command

    The refresh runs only when the root build of the module has at least one
    `gradle.lockfile` and at least one library or platform (not a plugin) was
    updated. Its command names the `dependencies` task of every project of
    that build that has a lock file, in the order of their Gradle paths (":"
    gives ":dependencies"), and `--update-locks` with the updated
    coordinates `group:name`, sorted and joined with ",". Lock files of
    `buildSrc` and of included builds are not refreshed (GRDUPD-12).

    Background:
      Given the tree contains
        """
        app/
          gradle.lockfile              org.example:lib:1.0=compileClasspath,runtimeClasspath
        core/
          gradle.lockfile              org.example:lib:1.0=compileClasspath,runtimeClasspath
        """
      And Gradle reports the lock files of ":app" and ":core"

    Scenario: GRDUPD-06 All lock files of the build are refreshed for the updated coordinate
      When the Gradle updater applies the candidate to the module ":app"
      Then the processes started are, in this order, each with the top directory of the tree as working directory
        | purpose        | arguments after the wrapper                                                                       |
        | describe       | the arguments of the describe run of specs/15                                                     |
        | refresh locks  | -q --console=plain --no-configuration-cache :app:dependencies :core:dependencies --update-locks org.example:lib |
      And the timeout of the refresh run is 10 minutes
      And the audit message is "Updated 1 version declaration(s) in 1 file(s). Refreshed 2 dependency lock file(s)."

    Scenario: GRDUPD-07 Several coordinates are sorted and joined with commas
      Given an update candidate for "org.example:zeta" from "1.0" to "1.1" declared in "app/build.gradle"
      And the candidate for "org.example:lib" and the candidate for "org.example:zeta"
      When the Gradle updater applies both candidates to the module ":app"
      Then the refresh run ends with "--update-locks org.example:lib,org.example:zeta"

    Scenario: GRDUPD-08 Updating only plugins refreshes nothing
      Given an update candidate for the plugin "org.example.plugin" from "1.0" to "1.1" declared in "app/build.gradle"
      When the Gradle updater applies that candidate to the module ":app"
      Then no refresh run is started
      And no process other than the describe run is started

    Scenario: GRDUPD-09 A lock file in the root project is addressed as the root task
      Given the tree contains
        """
        gradle.lockfile                org.example:lib:1.0=compileClasspath
        """
      And Gradle reports the lock files of ":", ":app" and ":core"
      When the Gradle updater applies the candidate to the module ":app"
      Then the refresh run names ":dependencies :app:dependencies :core:dependencies" in this order

    Scenario: GRDUPD-10 A failed refresh fails the update with Gradle's words
      Given the refresh run exits with code 1 and prints on the standard error
        """
        FAILURE: Build failed with an exception.

        * What went wrong:
        Execution failed for task ':app:dependencies'.
        > Could not resolve all dependencies for configuration ':app:compileClasspath'.

        * Try:
        > Run with --stacktrace option to get the stack trace.
        """
      When the update workflow runs with the Gradle strategy for the module ":app"
      Then the summary is marked as rolled back
      And the summary's failure is
        """
        Refreshing the Gradle dependency locks failed
        FAILURE: Build failed with an exception.

        * What went wrong:
        Execution failed for task ':app:dependencies'.
        > Could not resolve all dependencies for configuration ':app:compileClasspath'.
        """
      And "app/build.gradle", "app/gradle.lockfile" and "core/gradle.lockfile" are byte-for-byte what they were before

    Scenario: GRDUPD-11 A refresh that does not finish is stopped and named
      Given the refresh run does not finish within 10 minutes
      When the update workflow runs with the Gradle strategy for the module ":app"
      Then the summary is marked as rolled back
      And the summary's failure starts with "Refreshing the Gradle dependency locks timed out"

    Scenario: GRDUPD-12 Lock files of an included build or buildSrc are not refreshed, so such an update is refused
      Given Gradle describes the included build "build-logic" in "build-logic"
      And the tree contains
        """
        build-logic/
          gradle.lockfile              org.example:lib:1.0=compileClasspath
        """
      And an update candidate for "org.example:lib" from "1.0" to "1.1" declared in "build-logic/build.gradle"
      When the Gradle updater applies the candidate to the module ":build-logic"
      Then it fails with an InstallError
      And the message is
        """
        The build of module :build-logic (build-logic) uses dependency locking (build-logic/gradle.lockfile), which Elevate refreshes only for the root build. Nothing was changed.
        """
      And no file of the tree is changed
      And no process is started

    Scenario: GRDUPD-13 An included build without lock files is updated like any module
      Given Gradle describes the included build "build-logic" in "build-logic"
      And the tree contains no file "build-logic/gradle.lockfile"
      And an update candidate for "org.example:lib" from "1.0" to "1.1" declared in "build-logic/build.gradle"
      When the Gradle updater applies the candidate to the module ":build-logic"
      Then "build-logic/build.gradle" holds the new version
      And no refresh run is started

    @integration
    Scenario: GRDUPD-14 A real Gradle accepts the refreshed locks
      Given Gradle is installed
      And a copy of the fixture "gradle-locking" with the locked dependency "com.acme:lib" at 1.0 and a local file repository that holds 1.0 and 1.1
      When the module ":app" is updated to "com.acme:lib" 1.1 with the update workflow
      Then the summary is not rolled back and its verification status is "clean"
      And "app/gradle.lockfile" lists "com.acme:lib:1.1" and "core/gradle.lockfile" lists no "com.acme:lib:1.0"

  Rule: The default verification builds what the update can affect

    The projects checked are the projects of the module's build that the
    change can affect:

      | A changed file lies in                                                       | Affected projects                                    |
      | the directory of a project P that is not the root project (build script, properties, lock file) | P and every project that depends on P through `project(...)`, directly or indirectly |
      | the directory of the root project: root build script, gradle.properties, settings file, `gradle/libs.versions.toml`, root lock file | every project of the build                          |
      | no changed file is known (the MCP tool `elevate_verify`)                     | the project of the module and its dependents         |

    For each affected project the task is `testClasses` (main and test
    sources compile), or `assemble` when it has no `testClasses`, or nothing.
    Tasks are named by project path (`:app:testClasses`) and sorted by path.
    A task is written without a path, as the single word `testClasses` or
    `assemble`, when running it in every project that has it is exactly what
    is wanted: when the projects that need it are all the projects of the
    root build that have it. The unqualified tasks come first. A module of an
    included build is addressed through the name of its build
    (`:build-logic:testClasses`, `:build-logic:conv:testClasses`; fact 18) and
    its tasks are always qualified; `buildSrc` has no selector and is compiled
    by every run. Without any task the run is `help`, which configures the
    build and compiles `buildSrc`. The projects and their tasks come from a
    describe run of the module's build. When that run fails, the verification
    stops there: the result is a warning with Gradle's words, as for a failed
    build, and its label is `Gradle build`.

    The label of the result is `Gradle build (<tasks separated by blanks>)`.

    Scenario Outline: GRDUPD-15 The tasks follow the affected projects
      Given the projects of the build have these tasks and project dependencies
        | path      | testClasses | assemble | depends on |
        | :         | no          | no       |            |
        | :app      | yes         | yes      | :core      |
        | :core     | yes         | yes      |            |
        | :docs     | no          | yes      |            |
        | :platform | no          | no       |            |
      And the changed files are <files>
      When the default verification of the module ":core" runs
      Then the arguments after the wrapper are "-q --console=plain <tasks>"
      And the label is "Gradle build (<tasks>)"

      Examples:
        | files                                   | tasks                              |
        | core/build.gradle                       | :app:testClasses :core:testClasses |
        | app/build.gradle                        | :app:testClasses                   |
        | docs/build.gradle                       | :docs:assemble                     |
        | platform/build.gradle                   | help                               |
        | gradle.properties                       | testClasses :docs:assemble         |
        | gradle/libs.versions.toml               | testClasses :docs:assemble         |
        | build.gradle                            | testClasses :docs:assemble         |
        | core/build.gradle, app/build.gradle     | :app:testClasses :core:testClasses |
        | core/gradle.lockfile                    | :app:testClasses :core:testClasses |

    Scenario: GRDUPD-16 The MCP verification without changed files checks the module and its dependents
      When the default verification of the module ":core" runs without changed files
      Then the arguments after the wrapper are "-q --console=plain :app:testClasses :core:testClasses"

    Scenario: GRDUPD-17 A module of an included build is addressed through its build
      Given Gradle describes the included build "build-logic" in "build-logic" with the projects
        | path  | dir               | build file                  | group | version |
        | :     | build-logic       | build-logic/build.gradle    |       |         |
        | :conv | build-logic/conv  | build-logic/conv/build.gradle |     |         |
      And the project ":conv" of "build-logic" has the tasks "testClasses" and "assemble"
      When the default verification of the module ":build-logic:conv" runs
      Then the arguments after the wrapper are "-q --console=plain :build-logic:conv:testClasses"

    Scenario: GRDUPD-18 A change in buildSrc is verified by configuring and compiling the build
      Given Gradle describes buildSrc in "buildSrc"
      When the default verification of the module ":buildSrc" runs
      Then the arguments after the wrapper are "-q --console=plain help"
      And the details of a successful result are "Only the configuration of the build and buildSrc were checked: no project with a compile task is affected."

    Scenario: GRDUPD-19 The run starts in the build directory and has a long timeout
      When the default verification of the module ":app" runs
      Then the working directory is the top directory of the tree
      And the timeout of the run is 30 minutes
      And the processes started are the describe run and the verification run, in this order

    Scenario: GRDUPD-20 A successful build is clean
      When the default verification of the module ":app" runs
      Then the result status is "clean"
      And the result details are "All affected projects build successfully."
      And the result label is "Gradle build (:app:testClasses)"

    Scenario: GRDUPD-21 A failed build is a warning that quotes Gradle
      Given the verification run exits with code 1 and prints on the standard error
        """
        /work/app/src/main/java/demo/App.java:2: error: cannot find symbol
          symbol:   method greet()
          location: class Lib
        1 error

        FAILURE: Build failed with an exception.

        * What went wrong:
        Execution failed for task ':app:compileJava'.
        > Compilation failed; see the compiler error output for details.

        * Try:
        > Run with --stacktrace option to get the stack trace.
        """
      When the default verification of the module ":app" runs
      Then the result status is "warn"
      And the result details contain "error: cannot find symbol" and "Execution failed for task ':app:compileJava'."
      And the result details do not contain "Run with --stacktrace"
      Given the describe run before the verification exits with code 1 and prints on the standard error
        """
        FAILURE: Build failed with an exception.

        * What went wrong:
        A problem occurred configuring root project 'mono'.
        > Could not resolve all artifacts for configuration 'classpath'.
           > Could not resolve org.example:plug:1.1.
              > Cannot find a version of 'org.example:plug' that satisfies the version constraints:
                   Constraint path ':mono:1.0.0' --> 'org.example:plug:{strictly 1.0}' because of the following reason: Dependency version enforced by Dependency Locking

        * Try:
        > Run with --stacktrace option to get the stack trace.
        """
      When the default verification of the module ":app" runs
      Then the result status is "warn" and the result label is "Gradle build"
      And the result details contain "Dependency version enforced by Dependency Locking"
      And no verification run is started

    Scenario: GRDUPD-22 A build that does not finish is a warning
      Given the verification run does not finish within 30 minutes
      When the default verification of the module ":app" runs
      Then the result status is "warn"
      And the result details are "Gradle build timed out."

    Scenario: GRDUPD-23 Gradle that cannot be started is a warning, not a crash
      Given the tree contains no file "gradlew" and `gradle` is not on the PATH
      When the default verification of the module ":app" runs
      Then the result status is "warn"
      And the result details are "Gradle is not available: no Gradle Wrapper (gradlew) in the repository and no `gradle` on the PATH."

    Scenario: GRDUPD-24 A custom script replaces the default and runs in the build directory
      Given the configuration has the postUpdateScript "./gradlew check" labelled "Full check"
      When the verification of the module ":app" runs with that script
      Then the script is started through the shell with the top directory of the tree as working directory and a timeout of 30 minutes
      And no Gradle run is started by Elevate
      And a script that exits with code 0 gives the status "clean", the details "Verification script succeeded." and the label "Full check"

    Scenario: GRDUPD-25 A failing custom script is a warning with Gradle's error lines
      Given the script prints "FAILURE: Build failed with an exception." on the standard error and exits with code 1
      When the verification of the module ":app" runs with that script
      Then the result status is "warn" and the result details contain "FAILURE: Build failed with an exception."

  Rule: The whole update is undone when a step fails

    The workflow is the one of specs/README.md ("Implementation contract",
    `runUpdateWorkflow`): snapshot, write, integrity check, verification
    before and after, rollback. Gradle has no installed state, so restoring
    the files is the whole rollback and its `resync` does nothing.

    Scenario: GRDUPD-26 A compile error after the update restores the files
      Given the verification run before the update succeeds
      And the verification run after the update exits with code 1 and prints "error: cannot find symbol" on the standard error
      When the update workflow runs with the Gradle strategy for the module ":app"
      Then the summary is marked as rolled back
      And the summary's failure is "Verification failed: Gradle build (:app:testClasses)"
      And "app/build.gradle" is byte-for-byte what it was before
      And the summary's updated count is 0 and its changed files are empty
      And no process is started after the failed verification

    Scenario: GRDUPD-27 Dependency verification protects the build and the update is rolled back
      Given the tree contains
        """
        gradle/verification-metadata.xml   <verification-metadata><configuration><verify-metadata>true</verify-metadata></configuration></verification-metadata>
        """
      And the verification run before the update succeeds
      And the verification run after the update exits with code 1 and prints on the standard error
        """
        FAILURE: Build failed with an exception.

        * What went wrong:
        Execution failed for task ':app:compileJava'.
        > Dependency verification failed for configuration ':app:compileClasspath'
          2 artifacts failed verification:
            - lib-1.1.jar (org.example:lib:1.1) from repository acme
            - lib-1.1.pom (org.example:lib:1.1) from repository acme
          If the artifacts are trustworthy, you will need to update the gradle/verification-metadata.xml file.
        """
      When the update workflow runs with the Gradle strategy for the module ":app"
      Then the summary is marked as rolled back
      And the summary's verification details contain "Dependency verification failed for configuration ':app:compileClasspath'"
      And "gradle/verification-metadata.xml" is byte-for-byte unchanged and was never among the files Elevate may modify
      And no run with "--write-verification-metadata" was started

    Scenario: GRDUPD-28 A build that already failed before the update does not stop it
      Given the verification run before the update fails with "error: cannot find symbol"
      And the verification run after the update fails with "error: cannot find symbol"
      When the update workflow runs with the Gradle strategy for the module ":app"
      Then the summary is not marked as rolled back
      And the summary's verification details start with "Verification already failed before the update; the update was kept."

    Scenario: GRDUPD-29 Keeping the changes of a failed verification keeps the refreshed locks too
      Given the tree contains the lock files of the rule "Dependency locks are refreshed with Gradle's own command"
      And Gradle reports the lock files of ":app" and ":core"
      And the verification run before the update succeeds
      And the verification run after the update fails
      When the update workflow runs with the Gradle strategy for the module ":app" and the option keepOnFailure
      Then the summary is not marked as rolled back and its verification status is "warn"
      And the changed files include "app/build.gradle", "app/gradle.lockfile" and "core/gradle.lockfile"

    Scenario: GRDUPD-30 Skipping the verification still refreshes the locks and runs no build
      Given the tree contains the lock files of the rule "Dependency locks are refreshed with Gradle's own command"
      And Gradle reports the lock files of ":app" and ":core"
      When the update workflow runs with the Gradle strategy for the module ":app" and the option skipVerification
      Then the processes started are the describe run and the refresh run
      And the summary has no verification status

    Scenario: GRDUPD-31 Restoring after a rollback starts no process
      When the Gradle updater's resync is called
      Then no process is started

    Scenario: GRDUPD-32 The verification before and after the update names the same tasks
      Given the verification run before the update succeeds
      And the verification run after the update succeeds
      When the update workflow runs with the Gradle strategy for the module ":app"
      Then the verification runs before and after the update have the same arguments
      And each of them is preceded by a describe run

  Rule: Requested updates are checked against what the repositories reported

    Scenario: GRDUPD-33 A version chosen by hand must exist in the repositories
      Given the candidate for "org.example:lib" has the available versions "1.2", "1.1" and "1.0"
      When the update of "org.example:lib" to "9.9.9" is requested
      Then it fails with an UpdateSelectionError
      And the message is
        """
        'org.example:lib' has no version 9.9.9 in the configured repositories. Available: 1.2, 1.1, 1.0.
        """

    Scenario: GRDUPD-34 A dependency without a pending update cannot be retargeted
      When the update of "org.example:unknown" to "1.2.3" is requested
      Then it fails with an UpdateSelectionError
      And the message is
        """
        'org.example:unknown' has no pending update. Gradle updates are written where the scan located the version; a dependency without an offered update cannot be retargeted.
        """

    Scenario: GRDUPD-35 A dependency that was listed as not offered says why
      Given "org.example:lib" was listed as skipped with the reason "version-constraint" and the detail "dynamic version '1.+'"
      When the update of "org.example:lib" is requested
      Then it fails with an UpdateSelectionError
      And the message is
        """
        'org.example:lib' cannot be updated: version is a selector or constraint, not a plain version (dynamic version '1.+').
        """

    Scenario: GRDUPD-36 A module of an included build can only be aligned to its local version
      Given the candidate for "com.acme:lib" is an alignment to the local version "2.0.0"
      When the update of "com.acme:lib" to "3.0.0" is requested
      Then it fails with an UpdateSelectionError
      And the message is
        """
        'com.acme:lib' is a workspace module; it can only be aligned to its local version 2.0.0.
        """

    Scenario: GRDUPD-37 A major update needs the explicit permission
      Given the candidate for "org.example:lib" goes from "1.0" to "2.0"
      When the update of "org.example:lib" is requested without allowMajor
      Then it fails with an UpdateSelectionError
      And the message is
        """
        'org.example:lib' is a major update (1.0.0 ➔ 2.0). Pass --allow-major / allowMajor.
        """

  Rule: The command line and the MCP server report an update as they do for Maven

    Scenario: GRDUPD-38 A dry run lists the planned changes and the files they would touch
      Given the candidate for "org.example:lib" is declared in the property "v" of "gradle.properties"
      When "elevate update --ecosystem=gradle --module=:app --packages=org.example:lib --dry-run --json" runs
      Then the output has "dryRun": true, "ecosystem": "gradle" and "targetModule": "app"
      And the update has "identifier": "org.example:lib", "currentRange": "1.0", "newRange": "1.1" and "declaredIn": "gradle.properties"
      And no file of the tree is changed and no Gradle run is started after the scan

    Scenario: GRDUPD-39 A finished update reports the files that changed
      Given the tree contains the lock files of scenario GRDUPD-06
      When "elevate update --ecosystem=gradle --module=:app --packages=org.example:lib --json" runs and verification succeeds
      Then the output has "success": true, "updatedCount": 1 and "rolledBack": false
      And "changedFiles" lists "app/build.gradle", "app/gradle.lockfile" and "core/gradle.lockfile"
      And the "verification" has the status "clean" and the label "Gradle build (:app:testClasses :core:testClasses)"
      And the exit code is 0

    Scenario: GRDUPD-40 A rolled back update exits with 2 and says why
      Given the verification run after the update fails
      When "elevate update --ecosystem=gradle --module=:app --packages=org.example:lib" runs
      Then the exit code is 2
      And the standard error contains "❌ Update failed and was rolled back."

    Scenario: GRDUPD-41 The MCP tool elevate_apply_updates reports the same summary
      Given the verification run after the update succeeds
      When the MCP tool "elevate_apply_updates" is called with the ecosystem "gradle", the moduleId ":app" and the update "org.example:lib"
      Then the result has "success": true, "targetModule": "app", "ecosystem": "gradle" and "updatedCount": 1

    Scenario: GRDUPD-42 The MCP tool elevate_verify checks the module and its dependents
      When the MCP tool "elevate_verify" is called with the ecosystem "gradle" and the moduleId ":core"
      Then the result has the label "Gradle build (:app:testClasses :core:testClasses)" and the status "clean"

  Rule: Arguments are safe on every platform

    Scenario: GRDUPD-43 The directory the repository lives in never appears on the command lines
      Given a Gradle repository in a directory whose path contains "R&D" with lock files
      And the process boundary is replaced by a test double that records every command and argument
      When the update workflow runs with the Gradle strategy for the module ":app" and verification succeeds
      Then the working directory of every process is the top directory
      And neither a command nor an argument contains "R&D"

    @windows
    Scenario: GRDUPD-44 A project path with a character the Windows shell would interpret is refused with an explanation
      Given the platform is Windows
      And the project ":a&b" has a lock file and a verification task
      When the update workflow runs with the Gradle strategy for a module of ":a&b"
      Then the summary is marked as rolled back
      And the summary's failure contains 'Cannot pass ":a&b:dependencies" to the Windows command shell'
      And no process other than the describe run is started

  Rule: A real Gradle judges the result

    @integration
    Scenario: GRDUPD-45 A compatible update passes the verification
      Given Gradle is installed
      And a copy of the fixture "gradle-multi-project" whose repository is a local file repository holding "com.acme:lib" in 1.0 and 1.1 with the same API
      When the module ":app" is updated to "com.acme:lib" 1.1 with the update workflow
      Then the summary is not rolled back and its verification status is "clean"
      And "app/build.gradle" reads "com.acme:lib:1.1"

    @integration
    Scenario: GRDUPD-46 An update that breaks the compile is rolled back
      Given Gradle is installed
      And a copy of the fixture "gradle-multi-project" whose repository holds "com.acme:lib" in 1.0 and in 2.0 without the method that ":app" calls
      When the module ":app" is updated to "com.acme:lib" 2.0 with the update workflow
      Then the summary is marked as rolled back
      And the summary's verification details contain "cannot find symbol"
      And "app/build.gradle" reads "com.acme:lib:1.0" again

    @integration
    Scenario: GRDUPD-47 A build with dependency verification refuses the new artifacts and is rolled back
      Given Gradle is installed
      And a copy of the fixture "gradle-multi-project" with a "gradle/verification-metadata.xml" generated by `gradle --write-verification-metadata sha256` for 1.0
      When the module ":app" is updated to "com.acme:lib" 1.1 with the update workflow
      Then the summary is marked as rolled back
      And the summary's verification details contain "Dependency verification failed for configuration ':app:compileClasspath'"
      And "gradle/verification-metadata.xml" is byte-for-byte unchanged

    @integration
    Scenario: GRDUPD-48 A build in the Kotlin DSL with a version catalog is updated and verified
      Given Gradle is installed
      And a copy of the fixture "gradle-catalog" whose repository holds "org.example:lib" in 1.0 and 1.1
      When the module ":app" is updated to "org.example:lib" 1.1 with the update workflow
      Then the summary is not rolled back and its verification status is "clean"
      And only "gradle/libs.versions.toml" differs from the original, in the text "1.0" being replaced by "1.1"
