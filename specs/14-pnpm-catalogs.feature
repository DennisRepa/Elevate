Feature: pnpm catalogs
  A pnpm repository can keep dependency ranges in one place, the catalogs of
  "pnpm-workspace.yaml", and let packages refer to them with the "catalog:"
  protocol:

    # pnpm-workspace.yaml
    packages: ["packages/*"]
    catalog:
      left-pad: ^1.1.0
    catalogs:
      legacy:
        is-odd: ^2.0.0

    # packages/app/package.json
    "dependencies": {"left-pad": "catalog:", "is-odd": "catalog:legacy"}

  "catalog:" and "catalog:default" refer to the default catalog (the "catalog"
  key, or "catalogs.default"), "catalog:<name>" to the named catalog. The range
  of such a dependency is not in its package.json but in the catalog. Without
  catalog support, every catalog dependency would silently count as up to date,
  because "catalog:" is not a SemVer range. Elevate reads the range from the
  catalog, offers the update like any other, and writes the new range to the
  catalog entry, where the version is declared. (Checked with pnpm 9.15, 10.34,
  11.28 and 12.10.)

  Only the dependency sections of specs/05-dependency-coverage.feature are
  scanned, so a "catalog:" in "peerDependencies" or in an override is not
  offered. A catalog entry that no scanned dependency uses is not offered.

  The candidate says where the version is declared. In the JSON of the
  command line and of the MCP server:

    "declaredIn": {"file": "pnpm-workspace.yaml", "kind": "catalog", "catalog": "default"}

  The catalogs are read from the "pnpm-workspace.yaml" in the repository root.

  Background:
    Given the npm registry is replaced by a test double
    And the release channel is "stable"
    And a pnpm repository whose modules are "app" and "web", both at 1.0.0

  Rule: A dependency that refers to a catalog is offered with the catalog's range

    Scenario: CAT-01 An outdated entry of the default catalog is offered
      Given the pnpm-workspace.yaml
        """
        packages: ["packages/*"]
        catalog:
          left-pad: ^1.1.0
        """
      And "app" declares in its dependencies "left-pad": "catalog:"
      And the registry reports "1.3.0" as the latest version of "left-pad"
      When "app" is scanned
      Then exactly one candidate is offered for "left-pad"
      And its current range is "^1.1.0", its new range is "^1.3.0", its scope is "prod" and its action is "update"
      And its declaration is the catalog "default" in "pnpm-workspace.yaml"

    Scenario: CAT-02 An entry of a named catalog is offered
      Given the pnpm-workspace.yaml
        """
        packages: ["packages/*"]
        catalogs:
          legacy:
            is-odd: ^2.0.0
        """
      And "app" declares in its dependencies "is-odd": "catalog:legacy"
      And the registry reports "3.0.1" as the latest version of "is-odd"
      When "app" is scanned
      Then the candidate for "is-odd" has the current range "^2.0.0" and the new range "^3.0.1"
      And its declaration is the catalog "legacy" in "pnpm-workspace.yaml"

    Scenario Outline: CAT-03 The default catalog is written in either of its two forms
      Given the pnpm-workspace.yaml
        """
        packages: ["packages/*"]
        <catalog>
        """
      And "app" declares in its dependencies "left-pad": "<reference>"
      And the registry reports "1.3.0" as the latest version of "left-pad"
      When "app" is scanned
      Then the candidate for "left-pad" has the current range "^1.1.0"
      And its declaration is the catalog "default" in "pnpm-workspace.yaml"

      Examples:
        | catalog                                | reference       |
        | catalog: {left-pad: ^1.1.0}            | catalog:        |
        | catalog: {left-pad: ^1.1.0}            | catalog:default |
        | catalogs: {default: {left-pad: ^1.1.0}} | catalog:        |
        | catalogs: {default: {left-pad: ^1.1.0}} | catalog:default |

    Scenario Outline: CAT-04 The scope follows the section of the module
      Given the pnpm-workspace.yaml
        """
        packages: ["packages/*"]
        catalog: {left-pad: ^1.1.0}
        """
      And "app" declares in its <section> "left-pad": "catalog:"
      And the registry reports "1.3.0" as the latest version of "left-pad"
      When "app" is scanned
      Then the candidate for "left-pad" has the scope "<scope>"

      Examples:
        | section              | scope |
        | dependencies         | prod  |
        | optionalDependencies | prod  |
        | devDependencies      | dev   |

    Scenario Outline: CAT-05 An entry that is not a SemVer range is not offered
      Given the pnpm-workspace.yaml
        """
        packages: ["packages/*"]
        catalog: {left-pad: "<entry>"}
        """
      And "app" declares in its dependencies "left-pad": "catalog:"
      When "app" is scanned
      Then no candidate is offered
      And nothing is listed as skipped
      And the registry is not asked about "left-pad"

      Examples:
        | entry                |
        | *                    |
        | latest               |
        | npm:left-pad@^1.0.0  |

    Scenario: CAT-06 An internal package in a catalog is never looked up on a public registry
      Given the internal scopes are "@acme"
      And the registry for "@acme/billing" is a public registry
      And the pnpm-workspace.yaml
        """
        packages: ["packages/*"]
        catalog: {"@acme/billing": ^1.0.0}
        """
      And "app" declares in its dependencies "@acme/billing": "catalog:"
      When "app" is scanned
      Then no candidate is offered
      And the skipped dependency is "@acme/billing" with the origin "private" and the reason "private-on-public-registry"
      And the registry is not asked about "@acme/billing"

    Scenario: CAT-07 Peer dependencies, overrides and unused entries are not offered
      Given the pnpm-workspace.yaml
        """
        packages: ["packages/*"]
        catalog:
          react: ^17.0.0
          left-pad: ^1.1.0
          is-odd: ^2.0.0
        overrides:
          is-odd: catalog:
        """
      And "app" declares in its peerDependencies "react": "catalog:"
      And the registry reports newer versions of "react", "left-pad" and "is-odd"
      When "app" is scanned
      Then no candidate is offered
      And nothing is listed as skipped
      And the registry is not asked about "react", "left-pad" or "is-odd"

  Rule: A reference that cannot be resolved is listed, never guessed

    pnpm itself refuses to install such a repository, so there is nothing to
    update until the catalog is fixed. The dependency is listed with the reason
    "catalog-unresolved" and the detail below, and is not looked up.

    Scenario Outline: CAT-08 An unresolvable reference is listed with its reason
      Given the pnpm-workspace.yaml <file>
      And "app" declares in its dependencies "left-pad": "<reference>"
      When "app" is scanned
      Then no candidate is offered
      And the skipped dependency is "left-pad" with the reason "catalog-unresolved" and the detail "<detail>"
      And the registry is not asked about "left-pad"

      Examples:
        | file                                                                         | reference    | detail                                                            |
        | with `catalog: {is-odd: ^2.0.0}`                                             | catalog:     | no entry for 'left-pad' in catalog 'default'                      |
        | with `catalog: {left-pad: ^1.1.0}`                                           | catalog:old  | no catalog 'old'                                                  |
        | with `catalog: {left-pad: ^1.1.0}` and `catalogs: {default: {left-pad: ^1.0.0}}` | catalog: | catalog 'default' is defined twice (catalog and catalogs.default) |
        | that does not exist                                                          | catalog:     | pnpm-workspace.yaml is missing or not valid YAML                  |
        | containing `catalog: {left-pad: ^1.1.0`                                      | catalog:     | pnpm-workspace.yaml is missing or not valid YAML                  |

    Scenario: CAT-09 The reason is explained in the output
      Given the skipped dependency "left-pad" with the origin "public", the reason "catalog-unresolved" and the detail "no catalog 'old'"
      When the skip is described
      Then the description is "catalog entry could not be resolved (no catalog 'old')"
      And asking to update "left-pad" fails with
        """
        'left-pad' cannot be updated: catalog entry could not be resolved (no catalog 'old').
        """

  Rule: The new range is written to the catalog entry, nowhere else

    The text of "pnpm-workspace.yaml" changes only at the entry's range:
    comments, quotes, the order of keys, indentation, the notation of the
    entry (block or flow) and the line endings stay. The package.json of the
    module is not rewritten at all. Afterwards "pnpm install
    --no-frozen-lockfile" runs as for any update. A frozen install would
    refuse in pnpm 10 to 12 ("ERR_PNPM_LOCKFILE_CONFIG_MISMATCH") and, worse,
    would leave the "catalogs" section of the lockfile stale in pnpm 9.

    Scenario Outline: CAT-10 The entry is replaced in place
      Given a pnpm-workspace.yaml with the catalog entry written as `<before>`
      And an update candidate for "left-pad" declared in the default catalog with the new range "^1.3.0"
      And `pnpm install` is replaced by a test double that succeeds
      When the npm updater applies the candidate to "app"
      Then the entry is written as `<after>`
      And the rest of the pnpm-workspace.yaml is byte-for-byte unchanged

      Examples:
        | before                                         | after                                          |
        | left-pad: ^1.1.0                               | left-pad: ^1.3.0                               |
        | left-pad: "^1.1.0"                             | left-pad: "^1.3.0"                             |
        | left-pad: '^1.1.0'                             | left-pad: '^1.3.0'                             |
        | left-pad: ^1.1.0   # keep this comment         | left-pad: ^1.3.0   # keep this comment         |
        | "left-pad": ^1.1.0                             | "left-pad": ^1.3.0                             |
        | catalog: {left-pad: ^1.1.0, is-odd: ^2.0.0}    | catalog: {left-pad: ^1.3.0, is-odd: ^2.0.0}    |

    Scenario: CAT-11 Windows line endings and the final line break are kept
      Given a pnpm-workspace.yaml with Windows line endings and a final line break that contains the catalog entry `left-pad: ^1.1.0`
      And an update candidate for "left-pad" declared in the default catalog with the new range "^1.3.0"
      And `pnpm install` is replaced by a test double that succeeds
      When the npm updater applies the candidate to "app"
      Then the file differs from the original only in the text "^1.1.0" being replaced by "^1.3.0"

    Scenario: CAT-12 The package.json of the module is not touched
      Given "app" declares in its dependencies "left-pad": "catalog:", written with tabs and Windows line endings
      And an update candidate for "left-pad" declared in the default catalog with the new range "^1.3.0"
      And `pnpm install` is replaced by a test double that succeeds
      When the npm updater applies the candidate to "app"
      Then the package.json of "app" is byte-for-byte unchanged
      And `pnpm install --no-frozen-lockfile` was started in the repository root

    Scenario: CAT-13 The workspace file is among the files a rollback restores
      Given an update candidate for "left-pad" declared in the default catalog with the new range "^1.3.0"
      And `pnpm install` fails
      When the update workflow runs with the npm strategy for "app"
      Then the summary is marked as rolled back
      And the pnpm-workspace.yaml is byte-for-byte what it was before the update

    Scenario: CAT-14 An entry used by several modules is changed once and offered to each
      Given the pnpm-workspace.yaml
        """
        packages: ["packages/*"]
        catalog: {left-pad: ^1.1.0}
        """
      And "app" and "web" declare in their dependencies "left-pad": "catalog:"
      And the registry reports "1.3.0" as the latest version of "left-pad"
      When "app" is scanned and "web" is scanned
      Then both scans offer a candidate for "left-pad" with the new range "^1.3.0"
      And the candidate of "app" is shared with the module "web", and the candidate of "web" with the module "app"
      When the npm updater applies the candidate to "app" and `pnpm install` succeeds
      Then the catalog entry reads "left-pad: ^1.3.0"
      And scanning "web" again offers nothing for "left-pad"

    @integration
    Scenario: CAT-15 A real pnpm accepts the new catalog range
      Given pnpm is installed
      And a copy of the fixture "pnpm-workspaces" whose catalog has "left-pad: ^1.1.0" and whose module "@acme/app" declares "left-pad": "catalog:"
      And a pnpm-lock.yaml produced by `pnpm install`
      When the module "@acme/app" is scanned and the offered candidate is applied with the update workflow
      Then the summary is not marked as rolled back and its verification status is "clean"
      And the catalog entry in pnpm-workspace.yaml reads "left-pad: ^1.3.0"
      And the "catalogs" section of pnpm-lock.yaml lists "left-pad" with the specifier "^1.3.0"
