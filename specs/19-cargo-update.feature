Feature: Applying Cargo updates
  Only the version text of the declaring literal changes. Cargo.lock then
  follows with `cargo update -p`, and is pinned with `--precise` when an older
  version than the newest was picked (`--precise` is ignored while the old
  lock entry no longer fits the manifest, so it needs a second step). A
  failure restores Cargo.toml and Cargo.lock exactly.

  Rule: Edits are exact and checked

    Scenario: CUPD-01 Only the version text changes
      Given a Cargo.toml with comments, single quotes, inline tables and features
      When versions are updated
      Then every byte outside the version literals is unchanged

    Scenario: CUPD-11 CRLF files keep their line endings
      Given a Cargo.toml with Windows line endings
      When a version is updated
      Then all line endings are still Windows line endings

    Scenario: CUPD-02 An inherited dependency is changed in the workspace root
      Given "serde = { workspace = true }" in the member
      When "serde" is updated
      Then the root [workspace.dependencies] literal changes and the member is untouched
      And the affected files include the root manifest and Cargo.lock

    Scenario: CUPD-03 A manifest that changed since the scan is refused before anything happens
      Given the manifest now says "0.4.99" where the scan saw "0.4.10"
      When the update is applied
      Then it fails with an InstallError, the file is unchanged and no command ran

    Scenario: CUPD-12 A stale literal is refused by the edit itself
      When an edit expects text that is not there
      Then it fails with a StaleEditError

    Scenario: CUPD-07 A crate declared in several sections gets the new requirement everywhere
      Given "tokio = \"1.0.0\"" in dependencies and in dev-dependencies
      When "tokio" is updated to "1.40.0"
      Then both literals say "1.40.0" and the dev table keeps its features

  Rule: Cargo.lock follows the manifest

    Scenario: CUPD-04 The lockfile follows the manifest
      Given Cargo.lock locks itoa 0.4.8 and the requirement goes from "0.4" to "2"
      When the update is applied
      Then "cargo update -p itoa@0.4.8" is run

    Scenario: CUPD-13 A version picked below the newest is pinned exactly
      Given the lock moved to 1.0.18 but 1.0.15 was picked
      When the update is applied
      Then "cargo update -p itoa@1.0.18 --precise 1.0.15" is run afterwards
      And Cargo.lock locks itoa 1.0.15

    Scenario: CUPD-08 A crate locked in two versions is addressed by the version it resolved to
      Given Cargo.lock locks itoa 1.0.15 and 0.4.8, and the requirement "0.4" changes
      Then the first command is "cargo update -p itoa@0.4.8"

    Scenario: CUPD-05 Without a Cargo.lock none is created and cargo is not run
      Given a repository without Cargo.lock
      When the update is applied
      Then no cargo command is run and no Cargo.lock exists afterwards

    Scenario: CUPD-14 A real update leaves no Cargo.lock behind either
      Given a real workspace without Cargo.lock
      When the update runs without verification
      Then Cargo.toml changed and Cargo.lock still does not exist

    Scenario: CUPD-06 A failing cargo update is an InstallError with Cargo's output
      Given cargo update exits with 101
      Then the update fails with an InstallError

  Rule: A failed update leaves the repository as it was

    Scenario: CUPD-15 An inherited update changes only the root and checks the whole workspace
      Given a real workspace whose root declares "serde = { version = \"1.0.100\", features = [\"derive\"] } # shared"
      And "a" uses serde's derive feature through "workspace = true"
      When serde is updated from "a" with verification
      Then only the version text in the root Cargo.toml changes, the features and the comment stay
      And the members' manifests are byte-for-byte unchanged
      And the verification covers the whole workspace and "cargo check --locked" passes afterwards

    Scenario: CUPD-16 A shared update that breaks another crate restores root, members and lock
      Given the root declares itoa "0.4" and the crate "b" calls itoa::write
      When itoa is updated to the next major version with verification
      Then the summary is rolled back and names itoa
      And the root manifest, both member manifests and Cargo.lock are byte-for-byte unchanged

    Scenario: CUPD-09 A real update refreshes the lock and verifies
      Given a real workspace with an old itoa and serde
      When all updates are applied with verification
      Then it is not rolled back and the verification is clean
      And the lock no longer holds the old itoa, the comment in Cargo.toml is kept
      And "cargo check --locked" passes afterwards

    Scenario: CUPD-10 A breaking build rolls Cargo.toml and Cargo.lock back byte for byte
      Given code that compiles only with the old itoa
      When the major update is applied with verification
      Then the summary is rolled back and names itoa in the verification details
      And Cargo.toml and Cargo.lock are byte-for-byte unchanged
