Feature: Cargo registries and their configuration
  Versions come from the registry's sparse index: one file per crate, with
  every version, its yanked flag and its Rust version. Elevate sends no
  credentials. Where a lookup goes is decided by the Cargo configuration:
  `cargo metadata` does not show source replacement and `cargo config get`
  is nightly-only, so the few settings that matter are read directly and
  anything unreadable is refused, never bypassed.

  Rule: The index is read as Cargo's sparse protocol defines it

    Scenario Outline: CREG-01 The path of a crate's index file
      Then the crate "<name>" is found at "<path>"

      Examples:
        | name       | path             |
        | a          | 1/a              |
        | cc         | 2/cc             |
        | log        | 3/l/log          |
        | itoa       | it/oa/itoa       |
        | serde_json | se/rd/serde_json |
        | Serde      | se/rd/serde      |

    Scenario: CREG-12 A request goes to <index>/<prefix>/<name> and identifies Elevate
      When the versions of "itoa" are requested from "sparse+https://index.crates.io/"
      Then the URL is "https://index.crates.io/it/oa/itoa"
      And the User-Agent starts with "elevate/"

    Scenario: CREG-02 Versions, yanked flag and Rust version are read
      Given index lines with unknown fields and blank lines
      Then each version carries its yanked flag and rust_version, unknown fields are ignored

    Scenario: CREG-05 The legacy crates.io git index maps to the sparse index
      Given the index "registry+https://github.com/rust-lang/crates.io-index"
      Then the request goes to "https://index.crates.io/"

    Scenario: CREG-13 Another git index is refused without a request
      Given the index "registry+https://example.com/idx"
      Then the lookup fails with UnsupportedIndexError and no request is made

    Scenario Outline: CREG-06 A registry that wants authentication is reported and no token is sent
      Given the registry answers with status <status>
      Then the lookup fails with RegistryAuthRequiredError
      And the request carries no Authorization header

      Examples:
        | status |
        | 401    |
        | 403    |

    Scenario: CREG-08 An unknown crate
      Given the registry answers 404
      Then the lookup fails with CrateNotFoundError

    Scenario: CREG-09 The registry port honours channel and yanked flag
      Given the versions 1.0.0, 1.2.0 (yanked), 1.1.0 and 2.0.0-rc.1
      Then the latest stable version is 1.1.0 and the latest on the all channel is 2.0.0-rc.1
      And all versions are listed newest first without the yanked one
      And the endpoint of an alternative registry is its own index and is not public

    Scenario: CREG-10 A network failure behind an unused proxy points at NODE_USE_ENV_PROXY
      Given the network is unreachable and HTTPS_PROXY is set
      When NODE_USE_ENV_PROXY is not "1"
      Then the message names the reason and tells to start Elevate with NODE_USE_ENV_PROXY=1
      And with NODE_USE_ENV_PROXY=1, or without any proxy, that hint is absent

    Scenario: CREG-11 Lookups are memoised per index and crate
      When the same crate is requested twice at once
      Then the registry is asked once

  Rule: The configuration decides where a lookup goes

    Scenario: CCFG-01 Without configuration crates.io is the public default
      Then the index is the crates.io index and it is public

    Scenario: CCFG-02 A replaced source is followed and is not public
      Given "[source.crates-io] replace-with = \"mirror\"" and "[source.mirror] registry = \"sparse+https://mirror.example/crates/\""
      Then the index is the mirror and it is not public

    Scenario: CCFG-03 Configuration is found in parent directories, the nearest file wins, CARGO_HOME comes last
      Given configuration files in "proj", in a parent directory and in CARGO_HOME
      Then the file nearest to the working directory decides
      And CARGO_HOME applies only when nothing nearer says anything

    Scenario: CCFG-04 An included file has lower precedence than the file that includes it
      Given ".cargo/config.toml" with include = ["extra.toml"] and both files defining the same source
      Then the including file wins
      And the included file applies when the including file is silent

    Scenario: CCFG-05 CARGO_SOURCE_* variables are ignored, as Cargo ignores them
      Given "CARGO_SOURCE_MIRROR_REGISTRY" is set and a file defines the mirror differently
      Then the file's value is used
      And with only the variables set, crates.io stays the default

    Scenario Outline: CCFG-06 A replacement that cannot be read is refused instead of bypassed
      Given crates.io is replaced by a source with <setting>
      Then resolving fails with UnsupportedSourceError and no request goes to crates.io

      Examples:
        | setting                                  |
        | directory = "vendor"                     |
        | local-registry = "reg"                   |
        | git = "https://example.com/x.git"        |

    Scenario: CCFG-09 A vendored source makes a real scan fail
      Given a workspace configured with a directory source
      When it is scanned
      Then the scan reports that Elevate cannot read the source and offers no candidates

    Scenario: CCFG-07 An alternative registry index passes through
      Then "sparse+https://corp.example/idx/" is returned as it is and is not public
      And "sparse+https://index.crates.io/" is public

    Scenario: CCFG-08 A replacement cycle is refused
      Given source "a" is replaced by "b" and "b" by "a"
      Then resolving fails with UnsupportedSourceError
