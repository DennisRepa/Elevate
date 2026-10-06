Feature: A broken elevate.config.json stops Elevate
  `internalScopes` in elevate.config.json is what keeps internal package names
  away from public registries. If the file cannot be read, or its
  `internalScopes` cannot be understood, ignoring it would silently switch that
  protection off. Elevate therefore refuses to start, says what is wrong and
  where, and changes nothing.

  A file that does not exist is not an error: Elevate works with defaults
  without any configuration.

  Rule: The file must be a JSON object

    Scenario: CONF-01 Invalid JSON stops Elevate with the location of the problem
      Given the tree
        """
        .git/HEAD
        elevate.config.json            { "internalScopes": ["@acme"
        package.json                   {"name": "root", "version": "1.0.0"}
        """
      When the configuration is loaded from the top directory of the tree
      Then it fails with a ConfigError
      And the message starts with
        """
        Cannot read elevate.config.json:
        """
      And the message contains the absolute path of the file
      And the message ends with
        """
        Fix the file or remove it; Elevate does not continue without your internalScopes.
        """

    Scenario Outline: CONF-02 A JSON value that is not an object stops Elevate
      Given an elevate.config.json whose content is <content>
      When the configuration is loaded
      Then it fails with a ConfigError
      And the message contains "must contain a JSON object"

      Examples:
        | content        |
        | []             |
        | "internal"     |
        | 42             |
        | null           |
        | true           |

    Scenario: CONF-05 An empty file stops Elevate
      Given an elevate.config.json that is empty
      When the configuration is loaded
      Then it fails with a ConfigError

  Rule: internalScopes and excludeScopes must be lists of strings

    Scenario Outline: CONF-03 An internalScopes value of the wrong shape stops Elevate
      Given an elevate.config.json with the content {"internalScopes": <value>}
      When the configuration is loaded
      Then it fails with a ConfigError
      And the message is
        """
        Invalid elevate.config.json (<path>): `internalScopes` must be a list of strings, for example ["@my-org", "com.mycompany"]. Elevate does not continue without your internalScopes.
        """

      Examples:
        | value          |
        | "@acme"        |
        | {"a": 1}       |
        | ["@acme", 3]   |
        | 5              |
        | null           |

    Scenario: CONF-06 The deprecated excludeScopes is checked the same way
      Given an elevate.config.json with the content {"excludeScopes": "@acme"}
      When the configuration is loaded
      Then it fails with a ConfigError
      And the message contains "`excludeScopes` must be a list of strings"

    Scenario: CONF-04 A correct file and a missing file still work
      Given an elevate.config.json with the content {"internalScopes": ["@acme"]}
      When the configuration is loaded
      Then the internal scopes are "@acme"
      Given no elevate.config.json
      When the configuration is loaded
      Then no error is raised and there are no internal scopes

  Rule: The command line reports the error and exits

    Scenario: CONF-07 Every command stops before doing anything
      Given a repository with an invalid elevate.config.json
      When any Elevate command is started, including `mcp`
      Then the message is written to stderr
      And nothing is written to stdout
      And the exit code is 1
      And no file in the repository is changed
