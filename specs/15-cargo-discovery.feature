Feature: Cargo workspaces and modules
  Elevate treats Rust as a third ecosystem next to npm and Maven. Cargo
  itself decides what belongs to a workspace: Elevate finds every Cargo.toml
  in the repository and asks `cargo metadata --no-deps` once per workspace,
  which needs neither network access nor a Cargo.lock.

  Rule: Cargo is a first-class ecosystem

    Scenario: CECO-01 Cargo is registered next to npm and Maven
      Then the available ecosystems begin with "npm", "maven" and "cargo"
      And the Cargo strategy has the manifest file "Cargo.toml" and the icon "🦀"
      And asking for the strategy twice returns the same instance

    Scenario: CECO-02 The ecosystem switch rotates through all ecosystems
      Then the ecosystem after "npm" is "maven" and after "maven" is "cargo"
      And every ecosystem is reached once, and the last one is followed by "npm"

    Scenario: CECO-03 Cargo uses its own version rules
      Then rewriting "1.0.100" for the target "1.0.229" gives "1.0.229"
      And rewriting "1" for the target "2.3.4" gives "2"
      And the change from "0.4.2" to "0.5.0" is "major"
      And manual targets for dependencies without a pending update are not allowed

    Scenario: CECO-04 Cargo can be chosen on the command line
      When the arguments "scan --ecosystem=cargo" or "scan -e cargo" are parsed
      Then the ecosystem is "cargo"

    Scenario: CECO-05 The product version is the version of package.json
      Then the version Elevate reports equals the "version" of package.json

    Scenario: CECO-06 Registry requests identify Elevate with its version
      When a crate is requested from a registry
      Then the User-Agent is "elevate/<version> (+https://github.com/DennisRepa/Elevate)"

  Rule: Modules are the members of the workspaces found

    Scenario: CDISC-01 A virtual workspace reports its members with one cargo run
      Given the tree
        """
        Cargo.toml                     [workspace] members = ["crates/*", "tools/c"]
        crates/a/Cargo.toml
        crates/b/Cargo.toml
        tools/c/Cargo.toml
        """
      When the modules are discovered
      Then "cargo metadata --no-deps --format-version 1" is run exactly once, in the root
      And the modules are "a" (crates/a, 0.3.0), "b" (crates/b, 0.2.0) and "c" (tools/c, 1.0.0)
      And none of them is the root module
      And each module's aggregator directory is the workspace root

    Scenario: CDISC-02 A package at the repository root is the Root module
      Given a repository whose root Cargo.toml is a package "solo" in version "2.0.0"
      When the modules are discovered
      Then the module "solo" has the path "Root" and is marked as root

    Scenario: CDISC-05 Rust below a non-Rust root, and independent workspaces
      Given the tree
        """
        package.json
        apps/desktop/src-tauri/Cargo.toml
        tools/gen/Cargo.toml
        """
      When the modules are discovered
      Then both "app" (apps/desktop/src-tauri) and "gen" (tools/gen) are reported
      And each has its own workspace directory as aggregator

    Scenario: CDISC-06 Folders that never hold modules are not searched
      Given Cargo.toml files below "target", "node_modules", "vendor", ".hidden" and "src"
      When the modules are discovered
      Then cargo is not run for them

    Scenario: CDISC-08 The root proposal is the nearest workspace
      Given a crate inside a directory whose Cargo.toml declares [workspace]
      When the root is proposed starting in a subdirectory of the crate
      Then the workspace directory is proposed
      And without any [workspace] the nearest directory with a Cargo.toml is proposed
      And a directory without a Cargo.toml below the checkout proposes nothing

    Scenario: CDISC-11 Two workspaces with a crate of the same name get distinct ids
      Given the workspaces "one" and "two" each contain a crate "utils"
      When the modules are discovered
      Then the ids are "utils" and "utils (two)", both named "utils"

  Rule: Problems are shown, never mistaken for an empty repository

    Scenario: CDISC-09 A failing cargo run is reported with Cargo's own message
      Given cargo fails with "error: registry index was not found in any configuration: `corp`"
      When the modules are discovered and nothing else was found
      Then discovery fails with a CargoMetadataError that quotes that message

    Scenario: CDISC-15 A failing workspace does not hide the others
      Given the workspace "bad" fails and the workspace "good" succeeds
      When the modules are discovered
      Then only the modules of "good" are reported

    Scenario: CDISC-16 A failing workspace is listed in the diagnostics
      Given the workspace "bad" fails and the workspace "good" succeeds
      When the modules are discovered
      Then the diagnostics name "bad" and quote the failure

    Scenario: CDISC-10 A machine without cargo gets a clear error
      Given no "cargo" can be started
      When the modules are discovered
      Then discovery fails with a CargoUnavailableError instead of returning an empty list

    Scenario: CDISC-17 A Windows shell that cannot find cargo is reported as a missing cargo
      Given cmd.exe answers a cargo command with exit code 1 and a message in the user's language
      And "cargo --version" fails as well
      When cargo is run
      Then it fails with a CargoUnavailableError
      But a failure that carries Cargo's own "error" prefix, or one after which "cargo --version" works, is returned as it is

    Scenario: CDISC-12 Diagnostics start empty on every run
      Given a run that reported a problem
      When the next run has none
      Then the diagnostics are empty

    Scenario: CDISC-13 The application layer returns modules together with diagnostics
      Then ecosystems with diagnostics return them and ecosystems without return an empty list

    Scenario: CDISC-14 The modules command reports the diagnostics
      When "modules --json" is run
      Then the JSON contains "diagnostics"
      And the text output prints each problem to the error stream
