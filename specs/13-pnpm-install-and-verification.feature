Feature: Updating a pnpm repository
  In a repository managed by pnpm, Elevate writes the new ranges and lets pnpm
  install them, with the same safety net as for npm: a failed install,
  integrity check or verification restores every touched file. This page fixes
  which pnpm commands Elevate runs, what it makes of their results, and what
  differs from npm.

  The commands, all run in the repository root:

    | Purpose                             | Command                                        | Timeout |
    | Is pnpm usable?                     | pnpm --version                                 | 15 s    |
    | Install after writing the ranges    | pnpm install --no-frozen-lockfile              | 10 min  |
    | Restore the state after a rollback  | pnpm install --frozen-lockfile                 | 10 min  |
    | Default verification                | pnpm install --frozen-lockfile --lockfile-only | 10 min  |
    | Vulnerability summary               | pnpm audit --json                              | 60 s    |
    | Latest or all versions of a package | pnpm view <name> <field> --json                | 15 s    |
    | Registry configuration              | pnpm config list --json                        | 15 s    |

  Elevate runs "pnpm" as found on the PATH, in the repository root. It does not
  choose a pnpm version: the "packageManager" field of package.json, which
  pnpm itself or Corepack honours, decides which one runs. Elevate does not
  read pnpm's version either. The commands above were checked against pnpm
  9.15, 10.34, 11.28 and 12.10, and run without npm on the PATH.

  Four facts about pnpm shape this page. Each was checked with the real
  program in those four versions:

    * With the environment variable CI set, "pnpm install" is implicitly
      "--frozen-lockfile" and fails as soon as a manifest differs from the
      lockfile, which is exactly the state after Elevate wrote a range. Elevate
      therefore passes "--no-frozen-lockfile" explicitly.
    * "pnpm ls" exits with 0 even when dependencies are missing, so it cannot
      be the integrity check that "npm ls" is. "pnpm install --frozen-lockfile
      --lockfile-only" exits with 1 when pnpm-lock.yaml no longer matches the
      manifests and with 0 when it does.
    * "pnpm install" prints no vulnerability summary and no funding hint.
    * pnpm 9 to 11 print errors on the standard output, pnpm 12 on the standard
      error.

  In the scenarios below, "the pnpm repository" is the tree

    package.json                   {"name": "root", "version": "1.0.0", "dependencies": {"left-pad": "^1.1.0"}}
    pnpm-lock.yaml                 lockfileVersion: '9.0'
    pnpm-workspace.yaml            packages: ["packages/*"]

  and "the root module" is the module of its top directory. Unless a scenario
  says otherwise, every pnpm process of the test double succeeds and prints
  nothing.

  Background:
    Given every pnpm process is replaced by a test double that records its command, arguments and working directory

  Rule: Elevate makes sure pnpm can run before it touches anything

    The first scan, update or default verification in a repository starts
    "pnpm --version". If that does not succeed, the operation fails with this
    message (one line, single spaces), <reason> being "command not found" when
    the program cannot be started, "pnpm --version timed out" when it does not
    answer in time, and otherwise "pnpm --version exited with code <n>: <first
    line of its standard error, or of its standard output when that is
    empty>":

      pnpm could not be run in this repository (<reason>). This repository is managed by pnpm (<evidence>); install pnpm or enable Corepack (corepack enable). Nothing was changed.

    <evidence> is the evidence of the package manager detection. The error is
    a PackageManagerNotFoundError. A successful check is remembered for the
    repository root as long as the process lives; a failure is not, so that
    installing pnpm while Elevate is open takes effect on the next attempt.

    Background:
      Given the pnpm repository

    Scenario Outline: PINST-01 A scan fails with an explanation when pnpm cannot be run
      Given `pnpm --version` <behaviour>
      When the npm scanner scans the root module
      Then it fails with a PackageManagerNotFoundError
      And the message is
        """
        pnpm could not be run in this repository (<reason>). This repository is managed by pnpm (pnpm-lock.yaml); install pnpm or enable Corepack (corepack enable). Nothing was changed.
        """
      And the only process started is `pnpm --version`
      And the application-level scan of that module reports the same message as its error and no candidates

      Examples:
        | behaviour                                                       | reason                                                      |
        | cannot be started (the program does not exist)                  | command not found                                           |
        | does not answer within 15 seconds                               | pnpm --version timed out                                    |
        | exits with code 1 and prints "Internal Error: Cannot find matching keyid" | pnpm --version exited with code 1: Internal Error: Cannot find matching keyid |

    @windows
    Scenario: PINST-02 The Windows shell's "not recognized" is the same failure
      Given the platform is Windows
      And `pnpm --version` exits with code 1 and prints "'pnpm' is not recognized as an internal or external command," on the standard error
      When the npm scanner scans the root module
      Then the message starts with "pnpm could not be run in this repository (pnpm --version exited with code 1:"

    Scenario: PINST-03 An update is refused before anything is written
      Given `pnpm --version` cannot be started
      And an update candidate for "left-pad" from "^1.1.0" to "^1.3.0"
      When the npm updater applies the candidate to the root module
      Then it fails with an InstallError whose message starts with "pnpm could not be run in this repository"
      And "package.json" is byte-for-byte unchanged
      And the only process started is `pnpm --version`

    Scenario: PINST-04 The default verification reports it instead of passing
      Given `pnpm --version` cannot be started
      When the npm verifier verifies the root module without a custom script
      Then the result status is "warn"
      And the result details start with "pnpm could not be run in this repository"

    Scenario: PINST-05 pnpm is checked once per repository
      Given `pnpm --version` succeeds
      When the npm scanner scans the root module twice
      Then `pnpm --version` was started exactly once

  Rule: Ranges are written to package.json and installed with pnpm

    The dependency sections of specs/05-dependency-coverage.feature apply to a
    pnpm repository unchanged. In addition, "pnpm.overrides" in package.json,
    "overrides" in pnpm-workspace.yaml and "resolutions" are statements about
    resolution, like "overrides" in npm, and are never changed.

    Background:
      Given the pnpm repository

    Scenario: PINST-06 The update runs install, then asks for the vulnerability summary
      Given an update candidate for "left-pad" from "^1.1.0" to "^1.3.0"
      And `pnpm install` succeeds
      And `pnpm audit --json` prints a result without vulnerabilities
      When the npm updater applies the candidate to the root module
      Then the package.json's dependencies contain "left-pad": "^1.3.0"
      And the processes started are, in this order, each with the repository root as working directory
        | command                           |
        | pnpm --version                    |
        | pnpm install --no-frozen-lockfile |
        | pnpm audit --json                 |
      And no process named "npm" is started

    Scenario: PINST-07 A set CI variable does not freeze the install
      Given the environment variable CI is "true"
      And an update candidate for "left-pad" from "^1.1.0" to "^1.3.0"
      When the npm updater applies the candidate to the root module
      Then the arguments of the install are exactly "install" and "--no-frozen-lockfile"

    @integration
    Scenario: PINST-08 With CI set, a real pnpm updates the lockfile instead of failing
      Given pnpm is installed
      And a copy of the fixture "pnpm-workspaces" with a package.json that depends on "left-pad": "^1.1.0"
      And a pnpm-lock.yaml produced by `pnpm install` for it
      And the environment variable CI is "true"
      When the root module is updated to "left-pad": "^1.3.0" with the update workflow
      Then the summary is not rolled back
      And the pnpm-lock.yaml resolves "left-pad" to "1.3.0"

    Scenario: PINST-09 Formatting is preserved and resolution settings are left alone
      Given a package.json indented with tabs, with Windows line endings and a final line break, that contains
        """
        "dependencies": {"left-pad": "^1.1.0"},
        "peerDependencies": {"left-pad": "^1.0.0"},
        "pnpm": {"overrides": {"left-pad": "^1.1.0"}},
        "resolutions": {"left-pad": "^1.1.0"}
        """
      And a pnpm-workspace.yaml that contains `overrides: {left-pad: ^1.1.0}`
      And an update candidate for "left-pad" with the new range "^1.3.0"
      When the npm updater applies the candidate to the root module
      Then the package.json differs from the original only in the dependencies entry "^1.1.0" being replaced by "^1.3.0"
      And "pnpm-workspace.yaml" is byte-for-byte unchanged

    Scenario: PINST-10 The files that may change are the manifests, the lockfile and the workspace file
      When the files the update of the root module may modify are requested
      Then they are, in this order
        | file                             |
        | package.json of the module       |
        | package.json of the root         |
        | pnpm-lock.yaml of the root       |
        | pnpm-workspace.yaml of the root  |

    Scenario: PINST-11 No funding hint is reported
      Given an update candidate for "left-pad" from "^1.1.0" to "^1.3.0"
      And `pnpm install` prints "Done in 1s" on the standard output
      When the npm updater applies the candidate to the root module
      Then the outcome has no funding message

  Rule: A failed install is rolled back, in pnpm's own words

    The failure is "pnpm install failed" or "pnpm install timed out"; the
    details are the last 15 lines of the standard output followed by the
    standard error. The standard output comes first because pnpm 9 to 11 print
    their errors there; pnpm 12 prints them on the standard error. (Taking
    only the standard error whenever it is not empty, as for npm, would show
    just a warning when pnpm 9 to 11 print one there next to the error.)

    Background:
      Given the pnpm repository

    Scenario Outline: PINST-12 The failure quotes pnpm
      Given an update candidate for "left-pad" from "^1.1.0" to "^99.0.0"
      And `pnpm install` exits with code 1 and prints "<stdout>" on the standard output and "<stderr>" on the standard error
      When the update workflow runs with the npm strategy for the root module
      Then the summary is marked as rolled back
      And the summary's failure starts with "pnpm install failed"
      And the summary's failure contains "<line>"
      And the summary's updated count is 0

      Examples:
        | stdout                                                                        | stderr                              | line                                |
        | ERR_PNPM_NO_MATCHING_VERSION  No matching version found for left-pad@^99.0.0 |                                     | ERR_PNPM_NO_MATCHING_VERSION        |
        |                                                                               | Error: ERR_PNPM_NO_MATCHING_VERSION | Error: ERR_PNPM_NO_MATCHING_VERSION |
        | ERR_PNPM_NO_MATCHING_VERSION  No matching version found for left-pad@^99.0.0 | WARN  deprecated left-pad@1.3.0     | ERR_PNPM_NO_MATCHING_VERSION        |

    Scenario Outline: PINST-13 A refusal by pnpm's own policy is just a failed install
      pnpm settings can make pnpm refuse something that Elevate offered because
      it is the latest version: "minimumReleaseAge" rejects a version that is
      too young (pnpm 10 to 12), and pnpm 11 and 12 fail on a dependency whose
      build script has not been approved, where pnpm 9 and 10 only warn.
      Elevate does not know these settings; the install fails, everything is
      rolled back, and pnpm's message tells the user why.

      Given an update candidate for "left-pad" from "^1.1.0" to "^1.3.0"
      And `pnpm install` exits with code 1 and prints "<output>" on the standard output
      When the update workflow runs with the npm strategy for the root module
      Then the summary is marked as rolled back
      And the summary's failure contains "<line>"

      Examples:
        | output                                                                                               | line                                           |
        | ERR_PNPM_NO_MATURE_MATCHING_VERSION  Version 1.3.0 of left-pad does not meet the minimumReleaseAge constraint | does not meet the minimumReleaseAge constraint |
        | ERR_PNPM_IGNORED_BUILDS  Ignored build scripts: left-pad@1.3.0                                      | Ignored build scripts: left-pad@1.3.0          |

    Scenario: PINST-14 A timeout is reported as such
      Given an update candidate for "left-pad" from "^1.1.0" to "^1.3.0"
      And `pnpm install` does not finish within 10 minutes
      When the update workflow runs with the npm strategy for the root module
      Then the summary is marked as rolled back
      And the summary's failure starts with "pnpm install timed out"

    Scenario: PINST-15 The rollback restores every touched file and the installed state from the restored lockfile
      Given an update candidate for "left-pad" from "^1.1.0" to "^1.3.0"
      And `pnpm install` rewrites "package.json", "pnpm-lock.yaml" and "pnpm-workspace.yaml" and then exits with code 1
      When the update workflow runs with the npm strategy for the root module
      Then "package.json", "pnpm-lock.yaml" and "pnpm-workspace.yaml" are byte-for-byte what they were before
      And the last process started is `pnpm install --frozen-lockfile`
      And the arguments of that process do not contain "--no-frozen-lockfile"

    Scenario: PINST-16 A restore that fails is reported next to the original failure
      Given an update candidate for "left-pad" from "^1.1.0" to "^1.3.0"
      And `pnpm install --no-frozen-lockfile` exits with code 1
      And `pnpm install --frozen-lockfile` exits with code 1
      When the update workflow runs with the npm strategy for the root module
      Then the summary's failure starts with "pnpm install failed"
      And the summary's failure contains "Restoring the installed state failed as well: pnpm install failed while restoring the previous state"

  Rule: The default verification checks that the lockfile matches the manifests

    The label is "Lockfile consistency (pnpm install --frozen-lockfile)". The
    check changes neither the lockfile nor node_modules: "--frozen-lockfile"
    forbids writing the lockfile and "--lockfile-only" installs nothing.

    Background:
      Given the pnpm repository

    Scenario: PINST-17 A consistent lockfile is clean
      Given `pnpm install --frozen-lockfile --lockfile-only` exits with code 0
      When the npm verifier verifies the root module without a custom script
      Then the result status is "clean"
      And the result details are "pnpm-lock.yaml is up to date with all package.json files."
      And the result label is "Lockfile consistency (pnpm install --frozen-lockfile)"
      And the only process started besides `pnpm --version` is `pnpm install --frozen-lockfile --lockfile-only`

    Scenario Outline: PINST-18 A lockfile that no longer matches is a warning that quotes pnpm
      Given `pnpm install --frozen-lockfile --lockfile-only` exits with code 1 and prints "<stdout>" on the standard output and "<stderr>" on the standard error
      When the npm verifier verifies the root module without a custom script
      Then the result status is "warn"
      And the result details contain "ERR_PNPM_OUTDATED_LOCKFILE"

      Examples:
        | stdout                                                                           | stderr                          |
        | ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date |        |
        |                                                                                  | Error: ERR_PNPM_OUTDATED_LOCKFILE |

    Scenario: PINST-19 A verification that does not finish is a warning
      Given `pnpm install --frozen-lockfile --lockfile-only` does not finish within 10 minutes
      When the npm verifier verifies the root module without a custom script
      Then the result status is "warn"
      And the result details are "Verification timed out."

    Scenario: PINST-20 A custom verification script still runs and needs no pnpm
      When the npm verifier verifies the root module with the custom script `node -e "process.exit(0)"`
      Then the result status is "clean"
      And no pnpm process is started

    @integration
    Scenario: PINST-21 A real pnpm tells a consistent lockfile from a stale one
      Given pnpm is installed
      And a copy of the fixture "pnpm-workspaces" with a pnpm-lock.yaml produced by `pnpm install`
      When the npm verifier verifies the root module without a custom script
      Then the result status is "clean"
      When "left-pad": "^1.1.0" is added to a package.json of the tree without installing
      And the npm verifier verifies the root module without a custom script
      Then the result status is "warn"
      And the result details contain "ERR_PNPM_OUTDATED_LOCKFILE"

  Rule: The vulnerability summary comes from pnpm audit

    "pnpm install" prints no summary, so after a successful install Elevate
    runs "pnpm audit --json" once, in the repository root, and reads the
    counts from the result:

      {"advisories": {}, "metadata": {"vulnerabilities": {"info": 0, "low": 0, "moderate": 3, "high": 3, "critical": 0}}}

    Only "metadata.vulnerabilities" decides. The exit code does not: pnpm
    exits with 1 when it found vulnerabilities, and pnpm 9 and 10 also when
    the registry could not be reached.

    With a total of zero the severity is "clean" and the message is "No known
    vulnerabilities found." Otherwise the severity is "warn" and the message
    is "<total> vulnerabilities (<n> <level>, …)": "vulnerability" when the
    total is 1, the levels in the order info, low, moderate, high, critical,
    levels with a count of zero left out.

    An audit that gave no usable result is a warning, never a clean result and
    never a reason to roll back: severity "warn" and the message
    "Vulnerability check unavailable: <reason>." The reason is the message of
    the "error" object when pnpm printed one, "pnpm audit timed out after 60
    seconds" when it did not finish in time, and otherwise "pnpm audit
    returned no result".

    Background:
      Given the pnpm repository

    Scenario: PINST-22 No vulnerabilities is a clean result
      Given `pnpm audit --json` prints
        """
        {"advisories": {}, "metadata": {"vulnerabilities": {"info": 0, "low": 0, "moderate": 0, "high": 0, "critical": 0}, "dependencies": 1}}
        """
      When the summary is read
      Then the severity is "clean"
      And the message is "No known vulnerabilities found."

    Scenario Outline: PINST-23 Vulnerabilities are a warning that names the counts
      Given `pnpm audit --json` prints a result whose vulnerabilities are <counts>
      When the summary is read
      Then the severity is "warn"
      And the message is "<message>"

      Examples:
        | counts                                                  | message                                      |
        | {"info": 0, "low": 0, "moderate": 0, "high": 1, "critical": 0} | 1 vulnerability (1 high)              |
        | {"info": 0, "low": 0, "moderate": 3, "high": 3, "critical": 0} | 6 vulnerabilities (3 moderate, 3 high) |
        | {"info": 1, "low": 2, "moderate": 0, "high": 0, "critical": 1} | 4 vulnerabilities (1 info, 2 low, 1 critical) |

    Scenario: PINST-24 The exit code does not decide
      Given `pnpm audit --json` exits with code 1 and prints a result whose vulnerabilities are {"info": 0, "low": 0, "moderate": 0, "high": 2, "critical": 0}
      When the npm updater reports the outcome of the update
      Then the audit severity is "warn"
      And the audit message is "2 vulnerabilities (2 high)"
      And the update is not rolled back

    Scenario Outline: PINST-25 An audit without a result is a warning
      Given `pnpm audit --json` prints <output>
      When the summary is read
      Then the severity is "warn"
      And the message is "<message>"

      Examples:
        | output                                                                                   | message                                                                                                                                      |
        | {"error": {"code": "ECONNREFUSED", "message": "request to https://registry.example/-/npm/v1/security/audits failed"}} | Vulnerability check unavailable: request to https://registry.example/-/npm/v1/security/audits failed. |
        | nothing                                                                                  | Vulnerability check unavailable: pnpm audit returned no result.                                                                              |
        | {"advisories": {}}                                                                       | Vulnerability check unavailable: pnpm audit returned no result.                                                                              |
        | the text "<html>502 Bad Gateway</html>"                                                  | Vulnerability check unavailable: pnpm audit returned no result.                                                                              |

    Scenario: PINST-26 An audit that hangs is stopped and does not fail the update
      pnpm 11 and 12 can stay silent for minutes when the registry cannot be
      reached.

      Given an update candidate for "left-pad" from "^1.1.0" to "^1.3.0"
      And `pnpm audit --json` does not finish within 60 seconds
      When the update workflow runs with the npm strategy for the root module
      Then the summary is not marked as rolled back
      And the summary's updated count is 1
      And the summary's audit severity is "warn"
      And the summary's audit message is "Vulnerability check unavailable: pnpm audit timed out after 60 seconds."

  Rule: Versions and the registry configuration come from pnpm

    pnpm and npm read the same ".npmrc" files for registries and credentials,
    but pnpm may know more (settings in pnpm-workspace.yaml, its own defaults),
    so in a pnpm repository Elevate asks pnpm, as it asks npm elsewhere
    (specs/02 PM-12 for Yarn and Bun repositories).

    Scenario: PINST-27 Version queries use pnpm view
      Given a directory that contains "pnpm-lock.yaml"
      And `pnpm view` answers ["1.0.0", "1.1.0"] for the versions of "left-pad" and "1.1.0" for its dist-tag latest
      When all versions of "left-pad" are requested in that directory
      Then the versions are "1.1.0" and "1.0.0", newest first
      And the command was `pnpm view left-pad versions --json` with that directory as working directory
      When the latest version of "left-pad" is requested on the stable channel in that directory
      Then the version is "1.1.0"
      And the command was `pnpm view left-pad dist-tags.latest --json`
      And no process named "npm" was started

    Scenario: PINST-28 Registry mappings come from pnpm's configuration
      Given `pnpm config list --json` prints
        """
        {"registry": "https://registry.npmjs.org/", "@acme:registry": "https://npm.acme.example/", "@jsr:registry": "https://npm.jsr.io/"}
        """
      And a module that declares "@acme/billing": "^1.0.0" and "@jsr/std__path": "^1.0.0"
      And the registry reports newer versions of both
      When the module is scanned
      Then the candidate for "@acme/billing" has the origin "private" matched by "scoped-registry"
      And the candidate for "@jsr/std__path" has the origin "public"

    Scenario Outline: PINST-29 The JSR registry counts as a public registry
      When the registry "<url>" is classified
      Then it is <kind>

      Examples:
        | url                         | kind       |
        | https://registry.npmjs.org/ | public     |
        | https://npm.jsr.io/         | public     |
        | https://npm.acme.example/   | not public |

    Scenario: PINST-30 A repository managed by npm keeps using npm
      Given a repository root that contains "package.json" and "package-lock.json"
      And `npm install` succeeds
      When the root module is scanned and then updated
      Then every process started is named "npm"
      And no process named "pnpm" is started

  Rule: A real pnpm links an aligned module

    @integration
    Scenario: PINST-31 An aligned workspace dependency is linked, verified and kept
      Given pnpm is installed
      And a copy of the fixture "pnpm-workspaces" in which "@acme/app" declares "@acme/lib": "workspace:^1.0.0" and "@acme/lib" is at 1.0.0
      And a pnpm-lock.yaml produced by `pnpm install` for that state
      And the version of "@acme/lib" is then raised to 2.0.0 in its package.json without installing
      When the module "@acme/app" is scanned and the offered candidate is applied with the update workflow
      Then the package.json's dependencies contain "@acme/lib": "workspace:^2.0.0"
      And the summary is not rolled back and its verification status is "clean"
      And the pnpm-lock.yaml links "@acme/lib" for "packages/app" with a version starting with "link:"
