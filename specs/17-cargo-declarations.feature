Feature: Where a Cargo dependency's version is written, and what is offered
  `cargo metadata` says what applies, not where it is written. Elevate reads
  Cargo.toml itself, finds the literal that declares each version, and cross-
  checks it with what Cargo resolved. Only then is an update offered.

  Rule: Every way of declaring a dependency is found

    Scenario Outline: CDECL-01 The version literal of each declaration form is located
      Given a Cargo.toml with a dependency declared as <form>
      Then the version literal is "<version>" and its offsets cover exactly that text

      Examples:
        | form                                            | version |
        | plain = "1.2.3"                                 | 1.2.3   |
        | single = '0.4.10'                               | 0.4.10  |
        | inline = { version = "1.0.100", features = [] } | 1.0.100 |
        | dotted.version = "2.0"                          | 2.0     |
        | renamed = { package = "serde_json", version = "1.0.0" } | 1.0.0 |
        | pathv = { path = "../p", version = "0.1.0" }    | 0.1.0   |
        | [dependencies.tabled] version = "3.1"           | 3.1     |

    Scenario: CDECL-02 Section and target are known
      Then "[dev-dependencies]" and the legacy "[dev_dependencies]" are dev dependencies
      And "[target.'cfg(unix)'.dependencies]" has the target "cfg(unix)"
      And "[target.\"cfg(windows)\".build-dependencies]" is a build dependency for "cfg(windows)"

    Scenario: CDECL-03 An inherited dependency has no local literal
      Given "inherit = { workspace = true }" and "inherit2.workspace = true"
      Then both are marked inherited and have no version literal

    Scenario: CDECL-04 Workspace dependencies are declarations of their own
      Given "[workspace.dependencies]" with "wsdep = { version = \"1.0.100\" }" and "wsplain = \"0.8.0\""
      Then both have a version literal and are marked as workspace declarations

    Scenario: CDECL-05 A dependency without a version has no literal
      Given "gitdep = { git = \"https://example.invalid/x.git\" }"
      Then it has no version literal

  Rule: The scan combines Cargo's view with the manifest

    Scenario: CSCAN-01 A fully specified requirement is raised to the latest release
      Given "log = \"0.4.10\"" and the registry offers 0.4.10 and 0.4.35
      When the module is scanned
      Then "log" is offered from "0.4.10" to "0.4.35" as a selected minor update
      And its declaration is the dependency in "a/Cargo.toml"

    Scenario: CSCAN-02 A loose requirement shows only breaking updates, which are not preselected
      Given "itoa = \"1\"" and "rand = \"0.8\""
      When the registry offers only itoa 1.0.18
      Then nothing is offered
      When the registry offers itoa 2.1.0 and rand 0.9.2
      Then "itoa" is offered as "2" and "rand" as "0.9", both major and not selected

    Scenario: CSCAN-03 Dev, build and target dependencies are scoped and annotated
      Then a dev dependency has the scope "dev" and no qualifier
      And a build dependency has the scope "prod" and the qualifier "build"
      And a "cfg(unix)" dependency has the scope "prod" and the qualifier "cfg(unix)"

    Scenario: CSCAN-04 A real workspace is scanned with the real cargo
      Given a workspace with "serde = \"1.0.100\"" and "itoa = \"0.4\""
      When it is scanned against crates.io
      Then itoa is offered as a major update and serde as a patch update

    Scenario: CDECL-09 An inherited dependency points at the workspace root and names who shares it
      Given "serde = { workspace = true }" in "a" and "b", declared in the root [workspace.dependencies]
      When "a" is scanned
      Then the declaration is the dependency management entry in the root "Cargo.toml"
      And the dependency is shared with "b"

    Scenario: CDECL-15 A real workspace offers an inherited dependency from the root
      Given a real workspace whose root declares serde in [workspace.dependencies] and "a" and "b" inherit it
      When "a" is scanned with the real cargo
      Then "serde" is offered from the root "Cargo.toml" as a dependency management entry
      And it is shared with "b"

    Scenario: CDECL-11 A literal that disagrees with cargo is reported, not edited
      Given the manifest says "0.3.0" but cargo resolved "^0.4.10"
      When the module is scanned
      Then no candidate is offered
      And the dependency is skipped with the reason "declaration-mismatch"

    Scenario: CDECL-12 A renamed dependency is found under its rename
      Given "sj = { package = \"serde_json\", version = \"1.0.0\" }"
      When the module is scanned
      Then the candidate is "serde_json" and the registry is asked for "serde_json"

    Scenario: CDECL-13 A crate declared twice with different requirements gets a note
      Given "tokio = \"1.0.0\"" in dependencies and "tokio = \"1.2.0\"" in dev-dependencies
      When the module is scanned
      Then one candidate is offered, for the prod declaration
      And a note says that the dev-dependencies requirement "^1.2.0" is not changed

    Scenario: CDECL-14 Identical requirements in two sections need no note
      Given "tokio = \"1.0.0\"" in both sections
      When the module is scanned
      Then no note is added

  Rule: Path dependencies on workspace members are aligned

    Scenario: CALIGN-01 A version that excludes the member's version is aligned, keeping precision
      Given "b = { path = \"../b\", version = \"0.1\" }" and the member "b" is at 0.2.0
      When the module is scanned
      Then "b" is offered for alignment from "0.1" to "0.2"
      And no registry is asked

    Scenario: CALIGN-02 A version that already matches needs nothing
      Given "version = \"0.2\"" and the member is at 0.2.5
      Then no candidate is offered

    Scenario: CALIGN-03 Aligning edits the literal and touches no lockfile
      When an alignment is applied
      Then the version literal changes and cargo is not run

    Scenario: CORIG-01 A path dependency elsewhere that shares a member's name is not that member
      Given a path dependency "b" outside the workspace and a member "b"
      Then it is not aligned to the member

    Scenario: CORIG-02 A registry crate named like a member is a registry crate
      Given "b = \"0.1.0\"" from the registry and a member "b" at 0.2.0
      Then it is looked up in the registry as a public crate and updated, not aligned

  Rule: Internal crates are never looked up on a public registry

    Scenario: CREG-03 A crate from an alternative registry is looked up there and nowhere else
      Given "secret = { version = \"1.0.0\", registry = \"corp\" }"
      When the module is scanned
      Then only the index of "corp" is asked
      And the origin is private, matched by a scoped registry, with that registry

    Scenario: CREG-04 An internal name that would be resolved on a public registry is not looked up
      Given internalScopes ["acme-*"] and "acme-core = \"1.0.0\"" from crates.io
      When the module is scanned
      Then no registry is asked
      And "acme-core" is skipped with the reason "private-on-public-registry"

    Scenario: CREG-14 A registry that wants authentication is a failed lookup
      Given the registry answers that authentication is required
      When the module is scanned
      Then the dependency is skipped with the reason "lookup-failed" and a message about authentication
