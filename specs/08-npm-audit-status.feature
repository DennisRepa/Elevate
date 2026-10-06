Feature: npm vulnerability summary after an update
  After `npm install`, npm prints a one-line summary of known
  vulnerabilities. Elevate shows it in the update report and marks the report
  as a warning when there are any.

  npm's wording, which Elevate reads:

    found 0 vulnerabilities
    1 high severity vulnerability
    2 moderate severity vulnerabilities
    5 vulnerabilities (1 low, 2 moderate, 2 high)
    found 3 vulnerabilities (1 low, 2 high)          (npm 6)

  Rule: Zero vulnerabilities is a clean result

    Scenario: AUDIT-01 npm reports no vulnerabilities
      Given npm install printed
        """
        added 1 package, and audited 2 packages in 1s

        found 0 vulnerabilities
        """
      When the summary is read
      Then the severity is "clean"
      And the message is "No known vulnerabilities found."

    Scenario: AUDIT-05 npm prints no summary at all
      Given npm install printed
        """
        up to date in 400ms
        """
      When the summary is read
      Then the severity is "clean"
      And the message is "No known vulnerabilities found."

  Rule: One or more vulnerabilities is a warning that quotes npm's line

    Scenario Outline: AUDIT-02 npm reports vulnerabilities
      Given npm install printed
        """
        added 12 packages, and audited 13 packages in 2s

        <line>

        To address all issues, run:
          npm audit fix
        """
      When the summary is read
      Then the severity is "warn"
      And the message is "<line>"

      Examples:
        | line                                           |
        | 3 info severity vulnerabilities                |
        | 1 high severity vulnerability                  |
        | 2 moderate severity vulnerabilities            |
        | 1 critical severity vulnerability              |
        | 5 vulnerabilities (1 low, 2 moderate, 2 high)  |
        | found 3 vulnerabilities (1 low, 2 high)        |

    Scenario: AUDIT-03 The summary is found in either output stream and with Windows line endings
      Given npm install printed "added 1 package\r\n\r\n2 high severity vulnerabilities\r\n" on stderr and nothing on stdout
      When the npm updater reports the outcome of the update
      Then the audit severity is "warn"
      And the audit message is "2 high severity vulnerabilities"

    Scenario: AUDIT-04 Other numbers in the output are not mistaken for a count
      Given npm install printed
        """
        added 310 packages, and audited 311 packages in 9s

        42 packages are looking for funding
          run `npm fund` for details

        found 0 vulnerabilities
        """
      When the npm updater reports the outcome of the update
      Then the audit severity is "clean"
      And the audit message is "No known vulnerabilities found."
      And the funding message is "42 packages are looking for funding"
