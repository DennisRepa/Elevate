Feature: Internal dependencies in a pnpm repository
  In an npm repository a dependency on another module is linked when its range
  includes the module's local version (see "Aligning workspace modules" in
  docs/en.md). pnpm works differently: it links a module only when the
  dependency is
  written with the "workspace:" protocol. A plain range such as "^1.0.0" is
  resolved from the registry, even when the module in the repository
  satisfies it. If the registry knows a package of the same name, pnpm installs
  that stranger's package instead of the module. (Checked with pnpm 9.15,
  10.34, 11.28 and 12.10: a workspace package named "left-pad" at version 1.0.0
  and a dependency "left-pad": "^1.0.0" resolved to the registry's 1.3.0.)

  Elevate therefore never takes a plain range on a module for a link. It
  keeps its two promises for internal dependencies: a module's name is never
  looked up in a registry, and an update never leaves a module installed from
  somewhere else without saying so.

  How Elevate treats a dependency on another module of a pnpm repository:

    | Declared range                                         | Elevate                                                         |
    | workspace:*   workspace:^   workspace:~                | links by definition; nothing to offer                           |
    | workspace:../lib                                       | nothing to offer                                                |
    | workspace:^1.2.0   workspace:~1.2.0   workspace:1.2.0 | offered for alignment when the range excludes the local version |
    | ^1.2.0   1.2.0   (no protocol)                         | listed as not offered (reason "not-linked")                     |

  The protocols are only interpreted in pnpm repositories. A "workspace:" or
  "catalog:" range in an npm repository stays what it is today: not a SemVer
  range, never offered, never changed.

  "Aligned" has the meaning of the existing alignment: the candidate's action
  is "align", its target is the module's local version, and its origin is
  "workspace".

  Background:
    Given the npm registry is replaced by a test double
    And the release channel is "stable"
    And a pnpm repository whose modules are "@acme/app" at 1.0.0 and "@acme/lib" at 2.0.0

  Rule: Ranges with the workspace: protocol are aligned when they exclude the local version

    pnpm 9 and 12 refuse to install a "workspace:" range that the module does
    not satisfy ("No matching version found … inside the workspace"); pnpm 10
    and 11 link it anyway. Either way the declared range no longer describes
    the module, so Elevate treats it the same way in every version. The
    protocol and the prefix of the range (^, ~ or none) are kept.

    Scenario Outline: PLINK-01 Shorthand and path ranges need no alignment
      Given "@acme/app" declares the dependency "@acme/lib": "<range>"
      When "@acme/app" is scanned
      Then no candidate is offered
      And nothing is listed as skipped
      And the registry is not asked about "@acme/lib"

      Examples:
        | range           |
        | workspace:*     |
        | workspace:^     |
        | workspace:~     |
        | workspace:../lib |

    Scenario: PLINK-02 A range that excludes the local version is aligned
      Given "@acme/app" declares the dependency "@acme/lib": "workspace:^1.2.0"
      When "@acme/app" is scanned
      Then exactly one candidate is offered for "@acme/lib"
      And its current range is "workspace:^1.2.0", its new range is "workspace:^2.0.0"
      And its action is "align", its origin is "workspace", its diff is "major" and it is not preselected
      And the registry is not asked about "@acme/lib"

    Scenario Outline: PLINK-03 The prefix of the range is kept
      Given "@acme/app" declares the dependency "@acme/lib": "<declared>"
      When "@acme/app" is scanned
      Then the candidate for "@acme/lib" has the new range "<aligned>"

      Examples:
        | declared          | aligned           |
        | workspace:^1.2.0  | workspace:^2.0.0  |
        | workspace:~1.2.0  | workspace:~2.0.0  |
        | workspace:1.2.0   | workspace:2.0.0   |

    Scenario: PLINK-04 A range that includes the local version needs nothing
      Given "@acme/app" declares the dependency "@acme/lib": "workspace:^2.0.0"
      When "@acme/app" is scanned
      Then no candidate is offered
      And nothing is listed as skipped

    Scenario: PLINK-05 An aligned range is written and installed like any other update
      Given "@acme/app" declares the dependency "@acme/lib": "workspace:^1.2.0"
      And an update candidate for "@acme/lib" aligned from "workspace:^1.2.0" to "workspace:^2.0.0"
      And `pnpm install` is replaced by a test double that succeeds
      And the pnpm-lock.yaml of the tree links "@acme/lib" for "@acme/app"
      When the npm updater applies the candidate to "@acme/app"
      Then the package.json's dependencies contain "@acme/lib": "workspace:^2.0.0"
      And no integrity violation is reported

  Rule: A plain range on a module is listed as not linked and never looked up

    The reason is "not-linked"; the detail is the declared range. The
    dependency is not offered whether or not the local version satisfies the
    range: in both cases pnpm resolves it from the registry. Elevate does not
    rewrite a plain range into a "workspace:" range: that changes how the
    package is published, which is the repository's decision.

    Scenario Outline: PLINK-06 A plain range is listed as not linked
      Given "@acme/app" declares the dependency "@acme/lib": "<range>"
      When "@acme/app" is scanned
      Then no candidate is offered
      And the skipped dependency is "@acme/lib" with the origin "workspace", the reason "not-linked" and the detail "<range>"
      And the registry is not asked about "@acme/lib"

      Examples:
        | range  | comment                              |
        | ^2.0.0 | satisfied by the local version 2.0.0 |
        | ^1.0.0 | excluded by the local version 2.0.0  |
        | 2.0.0  | exact                                |

    Scenario: PLINK-07 A module named like a public package is not looked up
      Given the repository also has a module "left-pad" at 1.0.0
      And "@acme/app" declares the dependency "left-pad": "^1.0.0"
      And the registry reports "1.3.0" as the latest version of "left-pad"
      When "@acme/app" is scanned
      Then no candidate is offered
      And the skipped dependency is "left-pad" with the reason "not-linked"
      And the registry is not asked about "left-pad"

    Scenario: PLINK-08 The reason is explained in the output
      Given the skipped dependency "@acme/lib" with the origin "workspace", the reason "not-linked" and the detail "^2.0.0"
      When the skip is described
      Then the description is
        """
        workspace package that pnpm does not link unless it is declared with the workspace: protocol (^2.0.0)
        """
      And asking to update "@acme/lib" fails with
        """
        '@acme/lib' cannot be updated: workspace package that pnpm does not link unless it is declared with the workspace: protocol (^2.0.0).
        """

  Rule: After an update that aligned dependencies, pnpm-lock.yaml proves that they are linked

    Only when the update contains aligned dependencies (origin "workspace");
    otherwise the lockfile is not read. The check reads the "importers"
    section of the root pnpm-lock.yaml (lockfileVersion 9.x, written by
    pnpm 9 to 12):

      * the importer is the module's directory relative to the root, with
        forward slashes; the root module is ".";
      * the dependency is looked up in the importer's "dependencies",
        "devDependencies" and "optionalDependencies";
      * it is linked when its "version" starts with "link:".

    A violation is one message per dependency. Any violation fails the update
    and rolls it back, exactly as for npm.

      <name>: not present in pnpm-lock.yaml
      <name>: resolved to <version> instead of linking the workspace package
      pnpm-lock.yaml is missing; workspace links cannot be verified
      pnpm-lock.yaml could not be read; workspace links cannot be verified
      pnpm-lock.yaml has lockfileVersion '<value>', which Elevate cannot read; workspace links cannot be verified

    Scenario Outline: PLINK-09 A linked dependency passes in every section
      Given the pnpm-lock.yaml
        """
        lockfileVersion: '9.0'

        importers:

          .: {}

          packages/app:
            <section>:
              '@acme/lib':
                specifier: workspace:^2.0.0
                version: link:../lib

          packages/lib: {}
        """
      When the integrity of the aligned dependency "@acme/lib" of the module "packages/app" is checked
      Then no violation is reported

      Examples:
        | section              |
        | dependencies         |
        | devDependencies      |
        | optionalDependencies |

    Scenario: PLINK-10 The root module is the importer "."
      Given the pnpm-lock.yaml
        """
        lockfileVersion: '9.0'

        importers:

          .:
            dependencies:
              '@acme/lib':
                specifier: workspace:^2.0.0
                version: link:packages/lib

          packages/lib: {}
        """
      When the integrity of the aligned dependency "@acme/lib" of the root module is checked
      Then no violation is reported

    Scenario: PLINK-11 A dependency resolved from the registry is a violation
      Given the pnpm-lock.yaml
        """
        lockfileVersion: '9.0'

        importers:

          packages/app:
            dependencies:
              '@acme/lib':
                specifier: ^2.0.0
                version: 2.3.1

          packages/lib: {}
        """
      When the integrity of the aligned dependency "@acme/lib" of the module "packages/app" is checked
      Then the violations are
        """
        @acme/lib: resolved to 2.3.1 instead of linking the workspace package
        """

    Scenario: PLINK-12 A dependency missing from the importer is a violation
      Given the pnpm-lock.yaml
        """
        lockfileVersion: '9.0'

        importers:

          packages/app: {}

          packages/lib: {}
        """
      When the integrity of the aligned dependency "@acme/lib" of the module "packages/app" is checked
      Then the violations are
        """
        @acme/lib: not present in pnpm-lock.yaml
        """

    Scenario Outline: PLINK-13 A lockfile that cannot be checked is a violation
      Given <lockfile>
      When the integrity of the aligned dependency "@acme/lib" of the module "packages/app" is checked
      Then the violations are
        """
        <violation>
        """

      Examples:
        | lockfile                                          | violation                                                                                                      |
        | no pnpm-lock.yaml                                 | pnpm-lock.yaml is missing; workspace links cannot be verified                                                  |
        | a pnpm-lock.yaml containing "importers: [unclosed" | pnpm-lock.yaml could not be read; workspace links cannot be verified                                           |
        | a pnpm-lock.yaml with "lockfileVersion: '6.0'"    | pnpm-lock.yaml has lockfileVersion '6.0', which Elevate cannot read; workspace links cannot be verified        |

    Scenario: PLINK-14 A violation rolls the update back
      Given a pnpm repository whose module "@acme/app" declares "@acme/lib": "workspace:^1.2.0"
      And an update candidate for "@acme/lib" aligned from "workspace:^1.2.0" to "workspace:^2.0.0"
      And `pnpm install` is replaced by a test double that succeeds and writes a pnpm-lock.yaml in which "@acme/lib" is resolved to "2.3.1"
      When the update workflow runs with the npm strategy for "@acme/app"
      Then the summary is marked as rolled back
      And the summary's failure contains "Integrity check failed"
      And the summary's failure contains "@acme/lib: resolved to 2.3.1 instead of linking the workspace package"
      And "package.json" and "pnpm-lock.yaml" are byte-for-byte what they were before the update

    Scenario: PLINK-15 Updates from a registry do not read the lockfile
      Given an update candidate for "left-pad" from "^1.1.0" to "^1.3.0" whose origin is "public"
      And the tree has no pnpm-lock.yaml
      And `pnpm install` is replaced by a test double that succeeds
      When the npm updater applies the candidate
      Then no integrity violation is reported
