Feature: npm dependency sections
  A package.json declares dependencies in several sections. Elevate offers
  updates for the sections whose ranges say "this is what I install", and
  leaves alone the sections whose ranges are a statement to others.

    | Section              | Scanned | Written |
    | dependencies         | yes     | yes     |
    | devDependencies      | yes     | yes     |
    | optionalDependencies | yes     | yes     |
    | peerDependencies     | no      | never   |
    | overrides            | no      | never   |
    | bundleDependencies   | no      | never   |

  A peer range tells consumers which versions a package works with; raising it
  because a newer version exists would be a breaking change nobody decided.

  Background:
    Given the npm registry is replaced by a test double
    And the release channel is "stable"

  Rule: Optional dependencies are scanned and updated like regular dependencies

    Scenario: COV-01 An outdated optional dependency is offered
      Given a module whose package.json contains
        """
        {"name": "m", "version": "1.0.0", "optionalDependencies": {"fsevents": "^2.1.0"}}
        """
      And the registry reports "2.3.3" as the latest version of "fsevents"
      When the module is scanned
      Then exactly one candidate is offered for "fsevents"
      And its current range is "^2.1.0", its new range is "^2.3.3" and its scope is "prod"

    Scenario: COV-02 The new range is written to optionalDependencies
      Given a module whose package.json contains
        """
        {
          "name": "m",
          "version": "1.0.0",
          "optionalDependencies": {
            "fsevents": "^2.1.0"
          }
        }
        """
      And an update candidate for "fsevents" with the new range "^2.3.3"
      And `npm install` is replaced by a test double that succeeds
      When the npm updater applies the candidate
      Then the package.json's optionalDependencies contain "fsevents": "^2.3.3"

    Scenario: COV-03 A name declared in several sections follows npm's precedence
      npm installs the range from optionalDependencies when a name is in both
      dependencies and optionalDependencies. A name that is also a
      devDependency is shown as a development dependency, as before.

      Given a module whose package.json contains
        """
        {
          "name": "m",
          "version": "1.0.0",
          "dependencies": {"a": "^1.0.0", "b": "^1.0.0"},
          "optionalDependencies": {"a": "^1.2.0"},
          "devDependencies": {"b": "^1.4.0"}
        }
        """
      And the registry reports "1.9.0" as the latest version of "a" and of "b"
      When the module is scanned
      Then the candidate for "a" has the current range "^1.2.0" and the scope "prod"
      And the candidate for "b" has the current range "^1.4.0" and the scope "dev"
      And each of the two names is offered exactly once

    Scenario: COV-07 Every section that declares the name receives the new range
      Given a module whose package.json contains
        """
        {
          "name": "m",
          "version": "1.0.0",
          "dependencies": {"a": "^1.0.0"},
          "optionalDependencies": {"a": "^1.2.0"}
        }
        """
      And an update candidate for "a" with the new range "^1.9.0"
      And `npm install` is replaced by a test double that succeeds
      When the npm updater applies the candidate
      Then the package.json's dependencies contain "a": "^1.9.0"
      And the package.json's optionalDependencies contain "a": "^1.9.0"

  Rule: Peer dependencies, overrides and bundled dependencies are never offered and never changed

    Scenario: COV-04 A package declared only as a peer dependency is not looked up
      Given a module whose package.json contains
        """
        {"name": "m", "version": "1.0.0", "peerDependencies": {"react": "^17.0.0"}}
        """
      And the registry reports "19.0.0" as the latest version of "react"
      When the module is scanned
      Then no candidate is offered
      And nothing is listed as skipped
      And the registry is not asked about "react"

    Scenario: COV-05 Updating a development dependency leaves the peer range and overrides untouched
      Given a module whose package.json contains
        """
        {
          "name": "m",
          "version": "1.0.0",
          "devDependencies": {"react": "^17.0.0"},
          "peerDependencies": {"react": "^17.0.0"},
          "overrides": {"react": "^17.0.0"},
          "bundleDependencies": ["react"]
        }
        """
      And an update candidate for "react" with the new range "^19.0.0"
      And `npm install` is replaced by a test double that succeeds
      When the npm updater applies the candidate
      Then the package.json's devDependencies contain "react": "^19.0.0"
      And the package.json's peerDependencies still contain "react": "^17.0.0"
      And the package.json's overrides still contain "react": "^17.0.0"
      And the package.json's bundleDependencies are still ["react"]

    Scenario: COV-06 The formatting of package.json is preserved
      Given a module whose package.json is indented with tabs, uses CRLF line endings and ends with a line break
      And it declares "fsevents": "^2.1.0" in optionalDependencies
      And an update candidate for "fsevents" with the new range "^2.3.3"
      And `npm install` is replaced by a test double that succeeds
      When the npm updater applies the candidate
      Then the file differs from the original only in the text "^2.1.0" being replaced by "^2.3.3"
