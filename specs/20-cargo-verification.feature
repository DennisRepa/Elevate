Feature: Verifying Cargo updates, and showing them
  Verification is `cargo check --all-targets`, the counterpart of
  `mvn test-compile`: it type-checks libraries, binaries, tests, benches and
  examples without generating code. It covers the changed crates and every
  crate that depends on them by path. Doctests and non-default features are
  not covered; a `postUpdateScript` adds them.

  Rule: The check covers what a change can break

    Scenario: CVER-01 The changed member and everything depending on it are checked
      Given core <- api <- app, and an unrelated util
      When "core" changed
      Then the check is "cargo check --all-targets -p core -p api -p app"
      And when "util" changed it is "-p util" only

    Scenario: CVER-09 Without information about changes the module itself is checked
      When no changed files are known for "api"
      Then "api" and "app" are checked

    Scenario: CVER-02 A changed workspace root checks the whole workspace
      When the root Cargo.toml changed
      Then the check uses "--workspace"

    Scenario: CVER-03 --locked is used only when a Cargo.lock existed
      Then the check includes "--locked" with a lockfile and omits it without one

    Scenario: CVER-04 A custom script replaces the check and runs in the workspace root
      Given the postUpdateScript "just test"
      Then no cargo check is started and the script runs in the workspace root
      And the label is the configured label

    Scenario: CVER-05 A failed check reports Cargo's error lines
      Given cargo check prints errors
      Then the result is a warning whose details are the "error" lines only
      And the label is "Cargo build (cargo check --all-targets -p util)"

    Scenario: CVER-06 Error summaries keep the error lines
      Then "error[E0308]: ..." and "error: could not compile ..." are kept and progress lines dropped

    Scenario: CVER-07 A toolchain rustup does not have says how to get it
      Given cargo prints "error: toolchain '1.80.0-...' is not installed"
      Then the summary adds that `rustup toolchain install` installs what rust-toolchain.toml pins

    Scenario: CVER-08 A passing check is clean
      Given cargo check exits with 0
      Then the verification is clean

  Rule: Command lines never carry the repository path

    Scenario: CWIN-01 Only the working directory is handed to cargo
      Given a repository below "R&D 100%"
      When modules are discovered, an update applied and the result verified
      Then every cargo run has that directory as working directory
      And no argument contains the path, "&" or "%"

    Scenario: CWIN-02 Names and versions with + and @ pass the command runner
      Then arguments such as "itoa@1.0.18+x" are run without being rejected

    @windows
    Scenario: CWIN-03 A repository below a path containing & is discovered
      Given a Cargo package below "R&D" on Windows
      Then the module is found with the real cargo

  Rule: The dashboard shows where a dependency applies

    Scenario: CUI-01 A row names the qualifier and that the version is shared
      Given "serde" in a "cfg(unix)" table, shared with "api" and "web"
      Then the row shows "serde (cfg(unix)) [+2 crates]"
      And in German "[+2 Crates]"

    Scenario: CUI-02 A plain row shows neither
      Given a dependency without qualifier and not shared
      Then the row shows neither "(cfg" nor "crates]"

    Scenario: CUI-03 The version picker lists the crates that share the declaration
      Then it shows "Also changes: api, web"

    Scenario: CUI-04 The workspace bar shows what discovery could not load
      Given a diagnostic "cargo metadata failed in /r/bad: error: broken"
      Then the bar shows that message
