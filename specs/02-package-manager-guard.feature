Feature: Package manager guard
  Elevate's Node.js support drives npm and pnpm: in an npm repository it runs
  `npm install` and checks `package-lock.json`, in a pnpm repository it runs
  `pnpm install` and checks `pnpm-lock.yaml` (specs/11 to 14). In a repository
  managed by Yarn or Bun that would create a second lockfile and a
  `node_modules` layout the project does not use, while reporting success.
  Elevate therefore recognises such repositories and refuses to scan or change
  them, saying why.

  The guard only concerns the npm ecosystem. Maven modules in the same
  repository and read-only registry queries (`elevate versions`) are not
  affected.

  Rule: The package manager is recognised from the repository root

    Checked in this order; the first match decides:

      1. the "packageManager" field of the root package.json, when it is a
         string starting with "npm@", "pnpm@", "yarn@" or "bun@";
      2. "package-lock.json" or "npm-shrinkwrap.json"            -> npm
      3. "pnpm-lock.yaml" or "pnpm-workspace.yaml"               -> pnpm
      4. "yarn.lock" or ".yarnrc.yml"                            -> yarn
      5. "bun.lock" or "bun.lockb"                               -> bun
      6. otherwise                                               -> npm

    The evidence names what decided: for rule 1 the text
    `"packageManager": "<value>" in package.json`, for rules 2 to 5 the file
    name that was found (the first of the two in the order given above), for
    rule 6 the text `no other package manager detected`.

    Scenario Outline: PM-01 A lockfile or workspace file identifies the package manager
      Given a repository root that contains a package.json without a "packageManager" field
      And the root contains the file "<file>"
      When the package manager is detected
      Then the package manager is "<manager>"
      And the evidence is "<file>"

      Examples:
        | file                | manager |
        | package-lock.json   | npm     |
        | npm-shrinkwrap.json | npm     |
        | pnpm-lock.yaml      | pnpm    |
        | pnpm-workspace.yaml | pnpm    |
        | yarn.lock           | yarn    |
        | .yarnrc.yml         | yarn    |
        | bun.lock            | bun     |
        | bun.lockb           | bun     |

    Scenario: PM-02 The packageManager field wins over lockfiles
      Given a repository root whose package.json contains "packageManager": "pnpm@9.12.0"
      And the root contains the file "package-lock.json"
      When the package manager is detected
      Then the package manager is "pnpm"
      And the evidence is
        """
        "packageManager": "pnpm@9.12.0" in package.json
        """

    Scenario: PM-03 An npm lockfile wins over a leftover lockfile of another manager
      Given a repository root that contains a package.json without a "packageManager" field
      And the root contains the files "package-lock.json" and "yarn.lock"
      When the package manager is detected
      Then the package manager is "npm"

    Scenario: PM-04 An unknown packageManager value is ignored
      Given a repository root whose package.json contains "packageManager": "deno@2.0.0"
      And the root contains the file "yarn.lock"
      When the package manager is detected
      Then the package manager is "yarn"

    The rules are applied to the directory Elevate works in, and then, one
    directory at a time, to each ancestor up to and including the checkout
    boundary (the nearest directory with a ".git" entry). The first directory
    where rules 1 to 5 decide wins; rule 6 applies only when none does. A
    pnpm or Yarn workspace keeps its lockfile at the workspace root, not next
    to the packages inside it. Without any ".git" entry only the directory
    itself is examined.

    Scenario: PM-13 A package inside a pnpm workspace is recognised from the workspace root
      Given the tree
        """
        .git/HEAD
        package.json                   {"name": "root", "private": true}
        pnpm-workspace.yaml            packages: ["packages/*"]
        pnpm-lock.yaml                 lockfileVersion: '9.0'
        packages/
          a/
            package.json               {"name": "a", "version": "1.0.0", "dependencies": {"left-pad": "^1.1.0"}}
        """
      When the package manager is detected for "packages/a"
      Then the package manager is "pnpm"
      And the evidence is "pnpm-lock.yaml"
      And the npm scanner scans the module "packages/a" and every process it starts is named "pnpm"

    Scenario: PM-14 Lockfiles outside the checkout are ignored
      Given the tree
        """
        yarn.lock
        repo/
          .git/HEAD
          package.json                 {"name": "root", "version": "1.0.0"}
        """
      When the package manager is detected for "repo"
      Then the package manager is "npm"
      And the evidence is "no other package manager detected"

    Scenario: PM-15 Without a checkout only the directory itself is examined
      Given the tree
        """
        yarn.lock
        project/
          package.json                 {"name": "root", "version": "1.0.0"}
        """
      And the top directory of the tree has no ".git" entry
      When the package manager is detected for "project"
      Then the package manager is "npm"

    Scenario: PM-10 A repository without any lockfile is treated as npm
      Given a repository root that contains only a package.json without a "packageManager" field
      When the package manager is detected
      Then the package manager is "npm"
      And the evidence is "no other package manager detected"

  Rule: npm and pnpm repositories are supported

    Scenario Outline: PM-16 A repository managed by npm or pnpm is not refused
      Given a repository root that contains a package.json without a "packageManager" field
      And the root contains the file "<file>"
      When the repository is checked for a supported package manager
      Then the supported package manager is "<manager>"
      And no error is raised

      Examples:
        | file                | manager |
        | package-lock.json   | npm     |
        | pnpm-lock.yaml      | pnpm    |
        | pnpm-workspace.yaml | pnpm    |

  Rule: Scans and updates are refused in repositories managed by Yarn or Bun

    The refusal message is, with <name> being yarn or bun:

      This repository is managed by <name> (<evidence>). Elevate supports npm
      and pnpm for Node.js projects; using either here would create a
      lockfile next to <name>'s. Nothing was changed.

    (one line, single spaces)

    Background:
      Given the tree
        """
        package.json                   {"name": "root", "version": "1.0.0", "dependencies": {"left-pad": "^1.1.0"}, "workspaces": ["packages/*"]}
        yarn.lock                      # yarn lockfile v1
        packages/
          a/
            package.json               {"name": "a", "version": "1.0.0"}
        """

    Scenario: PM-05 A scan is refused with an explanation
      When the npm scanner scans the root module
      Then it fails with an UnsupportedPackageManagerError
      And the message is
        """
        This repository is managed by yarn (yarn.lock). Elevate supports npm and pnpm for Node.js projects; using either here would create a lockfile next to yarn's. Nothing was changed.
        """
      And no process is started
      And the application-level scan of that module reports the same message as its error and no candidates

    Scenario: PM-06 An update is refused before anything is written
      Given an update candidate for "left-pad" from "^1.1.0" to "^1.3.0"
      When the npm updater applies the candidate to the root module
      Then it fails with an InstallError whose message starts with "This repository is managed by yarn"
      And "package.json" is byte-for-byte unchanged
      And none of "package-lock.json", "pnpm-lock.yaml" and "node_modules" exists in the tree
      And no process is started

    Scenario: PM-07 The update workflow fails cleanly and neither npm nor pnpm runs while rolling back
      Given an update candidate for "left-pad" from "^1.1.0" to "^1.3.0"
      When the update workflow runs with the npm strategy for the root module
      Then the summary is marked as rolled back
      And the summary's failure contains "managed by yarn"
      And the summary's updated count is 0
      And "package.json" is byte-for-byte unchanged
      And none of "package-lock.json", "pnpm-lock.yaml" and "node_modules" exists in the tree
      And no process is started

    Scenario: PM-08 The default verification is refused instead of running a package manager
      When the npm verifier verifies the root module without a custom script
      Then the result status is "warn"
      And the result details start with "This repository is managed by yarn"
      And no process is started

    Scenario: PM-09 A custom verification script still runs
      When the npm verifier verifies the root module with the custom script `node -e "process.exit(0)"`
      Then the result status is "clean"

    Scenario Outline: PM-17 Yarn and Bun are refused alike, by name and evidence
      Given a repository root that contains a package.json without a "packageManager" field
      And the root contains the file "<file>"
      When the npm scanner scans the root module
      Then it fails with an UnsupportedPackageManagerError
      And the message starts with "This repository is managed by <manager> (<file>). Elevate supports npm and pnpm for Node.js projects;"
      And no process is started

      Examples:
        | file        | manager |
        | yarn.lock   | yarn    |
        | .yarnrc.yml | yarn    |
        | bun.lock    | bun     |
        | bun.lockb   | bun     |

  Rule: Everything the guard does not touch keeps working

    Scenario: PM-11 Maven modules in a Yarn repository are still discovered
      Given the tree
        """
        package.json                   {"name": "root", "version": "1.0.0"}
        yarn.lock                      # yarn lockfile v1
        backend/
          pom.xml                      g:backend:1, no parent
        """
      When Maven module discovery runs from the top directory of the tree
      Then it reports the module "g:backend"

    Scenario: PM-12 Version queries are not blocked
      Given a directory that contains "yarn.lock"
      And an npm registry adapter whose `npm view` answers ["1.0.0", "1.1.0"] for "left-pad"
      When all versions of "left-pad" are requested in that directory
      Then the versions are "1.1.0" and "1.0.0", newest first
