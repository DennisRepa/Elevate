Feature: Cargo version requirements and the version offered
  A bare version in Cargo.toml is a caret requirement: `1.2.3` means
  `^1.2.3`. Node's `semver` reads it as exact, so every Cargo requirement is
  translated first. The new requirement keeps the style of the old one, and
  compatibility follows Cargo's rule: the leftmost non-zero component breaks.

  Rule: Requirements are read the way Cargo reads them

    Scenario: CREQ-01 A bare version means caret
      Then "1.2.3" allows 1.9.0 but not 2.0.0
      And "0.2.3" allows 0.2.9 but not 0.3.0
      And "0.0.3" does not allow 0.0.4
      And "=1.2.3" does not allow 1.2.4
      And "~1.2" allows 1.2.9 but not 1.3.0
      And ">=1.2, <2" allows 1.9.0

    Scenario: CREQ-03 The floor is the lowest version a requirement allows
      Then the floor of "1" is 1.0.0, of "~1.8.0" is 1.8.0 and of "0.4.10" is 0.4.10

    Scenario Outline: CREQ-04 Only a single plain comparator can be rewritten
      Then the requirement "<requirement>" is <upgradable>

      Examples:
        | requirement | upgradable     |
        | 1           | upgradable     |
        | 1.2         | upgradable     |
        | 1.2.3       | upgradable     |
        | ^1.2        | upgradable     |
        | ~1.2.3      | upgradable     |
        | =1.2.3      | upgradable     |
        | 0.4         | upgradable     |
        | *           | not upgradable |
        | 1.*         | not upgradable |
        | >=1.2, <2   | not upgradable |
        | <2          | not upgradable |
        | >1          | not upgradable |

    Scenario: CREQ-11 Wildcards and git dependencies are left alone
      Given the dependencies "any = '*'" and a git dependency
      When the module is scanned
      Then no candidate is offered and no registry is asked

  Rule: A new requirement keeps operator and precision

    Scenario Outline: CREQ-02 The target is written in the style of the current requirement
      When "<current>" is rewritten for the target "<target>"
      Then the result is "<written>"

      Examples:
        | current | target      | written     |
        | 1.0.100 | 1.0.229     | 1.0.229     |
        | 1.0     | 2.3.4       | 2.3         |
        | 1       | 2.3.4       | 2           |
        | 0.4     | 1.0.18      | 1.0         |
        | 0.4.10  | 0.5.1       | 0.5.1       |
        | ~1.8.0  | 1.9.2       | ~1.9.2      |
        | ^1.2    | 1.4.0       | ^1.4        |
        | =1.0.0  | 1.0.5       | =1.0.5      |
        | 1       | 2.0.0-rc.1  | 2.0.0-rc.1  |

    Scenario: CREQ-10 A loose requirement that already allows the target is unchanged
      When "1" is rewritten for the target "1.0.18"
      Then the result is "1"

    Scenario Outline: CREQ-06 Differences follow Cargo's compatibility rule
      Then the change from "<from>" to "<to>" is "<kind>"

      Examples:
        | from  | to    | kind  |
        | 1.2.3 | 1.2.4 | patch |
        | 1.2.3 | 1.3.0 | minor |
        | 1.2.3 | 2.0.0 | major |
        | 0.4.2 | 0.4.3 | minor |
        | 0.4.2 | 0.5.0 | major |
        | 0.4.2 | 1.0.0 | major |
        | 0.0.3 | 0.0.4 | major |

  Rule: The offered version respects yanks, channels and the project's Rust version

    Scenario: CREQ-07 The stable channel skips yanked versions and pre-releases
      Given the versions 1.0.0, 1.1.0, 1.2.0 (yanked), 2.0.0-rc.1 and 1.1.5 (needs Rust 1.80)
      Then the stable channel offers 1.1.5

    Scenario: CREQ-12 The all channel includes pre-releases but never yanked versions
      Given the same versions
      Then the all channel offers 2.0.0-rc.1

    Scenario: CREQ-13 Pre-releases are offered only on the all channel
      Given a dependency "log = 0.4.10" and the versions 0.4.10 and 0.5.0-rc.1
      Then the stable channel offers nothing and the all channel offers 0.5.0-rc.1

    Scenario: CREQ-08 A release that needs a newer Rust than the project declares is passed over
      Given the project declares rust-version "1.70"
      And the versions 1.0.0, 1.1.0 and 1.1.5 (needs Rust 1.80)
      Then 1.1.0 is chosen
      And 1.1.5 is reported as held back with the Rust version it needs

    Scenario: CREQ-14 A held-back release is reported when nothing newer is usable
      Given the project declares rust-version "1.70"
      And the versions 0.4.10 and 0.4.35 (needs Rust 1.80)
      When the module is scanned
      Then no candidate is offered
      And "log" is skipped with the reason "incompatible-rust-version"

    Scenario: CREQ-09 Nothing qualifies
      Given only yanked versions
      Then no version is chosen
