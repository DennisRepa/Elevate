Feature: The changelog drives releases
  CHANGELOG.md is the single source of the release notes. Changes are written
  under "## Unreleased" while the work is done. Releasing turns that section
  into the section of the new version, and the GitHub release shows exactly
  that section. A release without notes is refused before anything is tagged.

  The changelog uses second-level headings: "## Unreleased" and
  "## <version> (<YYYY-MM-DD>)". A section runs up to the next second-level
  heading; third-level headings ("### Features") belong to it. A section has
  entries when it contains at least one list item (a line starting with "* "
  or "- ").

  Background:
    Given a CHANGELOG.md
      """
      # Changelog

      All notable changes to this project will be documented in this file.

      ## Unreleased

      ### Features

      * **config:** a broken configuration stops Elevate

      ### Fixes

      * **npm:** info vulnerabilities are reported

      ## 1.2.0 (2026-09-28)

      ### Features

      * **core:** initial release of Elevate
      """

  Rule: Releasing turns Unreleased into the version

    Scenario: REL-01 The new version gets a heading with the date and Unreleased starts empty
      When the release "1.3.0" is made on 2026-10-06
      Then the file contains, in this order
        """
        ## Unreleased

        ## 1.3.0 (2026-10-06)

        ### Features

        * **config:** a broken configuration stops Elevate
        """
      And the section "1.2.0 (2026-09-28)" is unchanged
      And the text of the file before "## Unreleased" is unchanged

    Scenario: REL-02 Line endings of the file are kept
      Given the file uses Windows line endings
      When the release "1.3.0" is made on 2026-10-06
      Then every line break of the result is a Windows line break

    Scenario Outline: REL-03 A release without entries is refused
      Given the Unreleased section contains <content>
      When the release "1.3.0" is made on 2026-10-06
      Then it fails with the message
        """
        CHANGELOG.md has no entries under "Unreleased". Describe the changes of this release there before releasing.
        """
      And the file is not changed

      Examples:
        | content                       |
        | nothing                       |
        | only the heading "### Fixes"  |
        | only a paragraph of prose     |

    Scenario: REL-04 A version that already has a section is refused
      When the release "1.2.0" is made on 2026-10-06
      Then it fails with the message
        """
        CHANGELOG.md already has a section for 1.2.0.
        """
      And the file is not changed

    Scenario: REL-05 A missing Unreleased section is refused
      Given the file has no "## Unreleased" heading
      When the release "1.3.0" is made on 2026-10-06
      Then it fails with the message
        """
        CHANGELOG.md has no "## Unreleased" section.
        """

  Rule: The release notes are the section of the version

    Scenario: REL-06 The notes are the section without its heading
      When the notes for "1.2.0" are read
      Then the notes are
        """
        ### Features

        * **core:** initial release of Elevate
        """

    Scenario: REL-07 The notes of a released section end at the next second-level heading
      Given the release "1.3.0" was made on 2026-10-06
      When the notes for "1.3.0" are read
      Then the notes start with "### Features"
      And the notes contain "### Fixes" and "info vulnerabilities are reported"
      And the notes do not contain "initial release of Elevate"

    Scenario: REL-08 A pre-release version is not confused with its final version
      Given the release "1.3.0-rc.1" was made on 2026-10-01
      When the notes for "1.3.0" are read
      Then it fails with the message
        """
        CHANGELOG.md has no section for 1.3.0.
        """

    Scenario: REL-09 A version without a section is refused
      When the notes for "9.9.9" are read
      Then it fails with the message
        """
        CHANGELOG.md has no section for 9.9.9.
        """

    Scenario: REL-10 A section without entries is refused
      Given the section "1.2.0 (2026-09-28)" contains only the heading "### Features"
      When the notes for "1.2.0" are read
      Then it fails with the message
        """
        The CHANGELOG.md section for 1.2.0 has no entries.
        """

  Rule: The commands guard the release

    Scenario: REL-11 npm version stops before changing anything when there is nothing to release
      Given the Unreleased section has no entries
      When "npm version minor" is run
      Then the "preversion" step fails with the message of REL-03
      And package.json still has the old version
      And no commit and no tag is created

    Scenario: REL-12 The tag workflow stops when the tag has no notes
      Given a tag "v1.3.0" is pushed
      And CHANGELOG.md has no section for 1.3.0
      When the release workflow runs
      Then the verification job fails with the message of REL-09
      And no binary is built and no GitHub release is created
