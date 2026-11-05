Feature: Lock-file-only updates for Cargo
  A requirement such as `itoa = "1"` already allows every 1.x release, so the
  manifest never changes while Cargo.lock can lag behind. Elevate offers such
  a crate as a lock update: the locked version moves to the newest release the
  requirement allows, Cargo.toml stays as it is, and the change is pinned with
  `cargo update -p name@locked --precise target`.

  Only direct dependencies are offered. A crate that gets a manifest update
  shows only that candidate, so it never appears twice; the manifest update
  moves the lock file along. Transitive crates are not offered.

  Rule: A lock update is offered when only Cargo.lock is behind

    Scenario: CLOCK-01 A loose requirement whose locked version is behind gets a lock-only candidate
      Given "itoa = \"1\"", Cargo.lock locks itoa 1.0.15 and the registry offers 1.0.15, 1.0.16 and 1.0.18
      When the module is scanned
      Then "itoa" is offered with the action "lock" from 1.0.15 to 1.0.18 as a selected patch update
      And its declaration is Cargo.lock
      And the versions that may be picked are 1.0.18 and 1.0.16

    Scenario: CLOCK-02 Without a Cargo.lock there is nothing to update in it
      Given the same requirement and registry but no Cargo.lock
      When the module is scanned
      Then nothing is offered

    Scenario: CLOCK-03 A lock that already holds the newest allowed version needs nothing
      Given Cargo.lock locks itoa 1.0.18 and the newest release is 1.0.18
      Then nothing is offered

    Scenario: CLOCK-04 A requirement that is raised anyway shows only that candidate
      Given "itoa = \"1.0.10\"", Cargo.lock locks itoa 1.0.15 and the registry offers 1.0.18
      Then one candidate with the action "update" to "1.0.18" is offered, none for the lock

    Scenario: CLOCK-05 Only versions the requirement allows are offered for the lock
      Given "itoa = \"0.4\"", Cargo.lock locks itoa 0.4.7 and the registry offers 0.4.8 and 1.0.18
      Then the breaking 1.0.18 is shown as the manifest update and no lock candidate is added
      And without 1.0.18 the lock candidate moves itoa to 0.4.8

    Scenario: CLOCK-06 A crate locked in two versions is judged by the version its requirement resolved to
      Given Cargo.lock locks itoa 0.4.8 and 1.0.15 and the requirement is "1"
      Then the lock candidate starts at 1.0.15

    Scenario: CLOCK-07 A release that needs a newer Rust than the project declares is not chosen
      Given the project declares rust-version "1.70" and 1.0.18 needs Rust 1.80
      Then the lock candidate moves to 1.0.16

    Scenario: CLOCK-08 Pre-releases are not offered for the lock on the stable channel
      Given the registry offers 1.0.15 and 1.1.0-rc.1
      Then nothing is offered

    Scenario: CLOCK-09 An exact requirement leaves no room in the lock
      Given "itoa = \"=1.0.15\""
      Then the candidate is the manifest update, not a lock update

    Scenario: CLOCK-10 A crate from a private registry is looked up there for the lock, never on a public one
      Given "secret = { version = \"1\", registry = \"corp\" }" and Cargo.lock locks secret 1.2.0
      Then only the index of "corp" is asked
      And the lock candidate has a private origin and moves to the newest release there

  Rule: Applying a lock update changes Cargo.lock and nothing else

    Scenario: CLOCK-11 Only Cargo.lock is touched
      When a lock update of itoa from 1.0.15 to 1.0.18 is applied
      Then "cargo update -p itoa@1.0.15 --precise 1.0.18" is run
      And the manifest is byte for byte unchanged
      And the only affected file is Cargo.lock

    Scenario: CLOCK-12 Each locked crate gets its own update
      When lock updates of itoa and log are applied
      Then each is pinned with the version it is locked at, one after the other

    Scenario: CLOCK-13 Without a Cargo.lock the update is refused and nothing runs
      When a lock update is applied in a repository without Cargo.lock
      Then it fails with an InstallError, no command runs and no Cargo.lock is created

    Scenario: CLOCK-14 A lock file that no longer holds the scanned version is refused
      Given Cargo.lock now locks itoa 1.0.16 where the scan saw 1.0.15
      Then the update fails mentioning 1.0.15 before any command runs

    Scenario: CLOCK-15 A failing cargo update is an InstallError with Cargo's output
      Given cargo update exits with 101
      Then the update fails with an InstallError

    Scenario: CLOCK-16 A manifest update and a lock update in one run both happen
      When "serde" is raised in the manifest and "itoa" is updated in the lock
      Then only the manifest literal of serde changes
      And serde is refreshed with "cargo update -p serde@1.0.100"
      And itoa is pinned afterwards with "--precise"

  Rule: A lock update is verified on the whole workspace

    Scenario: CLOCK-17 A changed lock file alone is checked on the whole workspace
      When only Cargo.lock changed
      Then the check uses "--workspace"

    Scenario: CLOCK-18 A lock file that changed together with a manifest keeps the check on the changed crates
      When a manifest and Cargo.lock changed
      Then the check covers the changed crates and their dependents only

  Rule: A pinned release that was yanked is reported, not hidden

    Scenario: CLOCK-26 A locked release that was yanked, with nothing allowed to replace it, is reported
      Given a requirement of "1" and Cargo.lock holding 1.0.15, which the index marks as yanked
      And no allowed release is newer
      Then "itoa" is skipped with the reason "locked-version-yanked" and names 1.0.15
      And no candidate is offered

  Rule: The shared layers handle the lock action

    Scenario: CLOCK-19 A request takes the newest allowed release, or another one the requirement allows
      Given a lock candidate for itoa from 1.0.15 to 1.0.18 with 1.0.16 also allowed
      Then "itoa" selects 1.0.18 and "itoa@1.0.16" selects 1.0.16, pinned exactly
      And "itoa@2.0.0" is refused and names 1.0.18 and 1.0.16

    Scenario: CLOCK-20 Lock updates are selected with the others
      When all updates are selected without allowing majors
      Then the lock candidate is included

    Scenario: CLOCK-21 The JSON output names the action and the lock file
      Then the candidate shows "action": "lock" and declaredIn Cargo.lock of the kind "lockfile"

    Scenario: CLOCK-22 A row is marked as a lock update, in both languages
      Then the row shows 1.0.15, 1.0.18 and "[Lock]"

  Rule: Against the real cargo

    Scenario: CLOCK-23 A lock held back behind a loose requirement is offered, updated and verified
      Given a real workspace with itoa = "1" and Cargo.lock held at 1.0.15
      When it is scanned and updated with verification
      Then the manifest is byte for byte unchanged and the lock no longer holds 1.0.15
      And the whole workspace was checked and "cargo check --locked" passes afterwards

    Scenario: CLOCK-24 A failing verification restores Cargo.lock byte for byte
      Given a verification script that fails only once the update has moved the locked version
      Then the update is rolled back and Cargo.lock is byte for byte as before

    Scenario: CLOCK-25 A repository without Cargo.lock offers no lock updates and gets none
      Given a real workspace without Cargo.lock
      Then nothing is offered and no Cargo.lock exists afterwards
