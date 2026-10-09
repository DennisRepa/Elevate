Feature: pnpm workspaces
  pnpm does not read the "workspaces" field of package.json. A pnpm repository
  declares its packages in "pnpm-workspace.yaml" at its root. Elevate reads that
  file, so that the packages of a pnpm repository are modules and the
  repository root is the same wherever in the repository Elevate is started.

  Elevate's Node.js ecosystem stays "npm" (package.json). pnpm is the package
  manager of that ecosystem, not a third ecosystem: command-line options, MCP
  parameters and module ids do not change.

  "A pnpm repository" means a repository that the package manager detection
  (specs/02-package-manager-guard.feature) recognises as pnpm. A repository
  recognised as npm keeps using the "workspaces" field of package.json, even if
  it also contains a "pnpm-workspace.yaml".

  Rule: The packages of a workspace are listed in pnpm-workspace.yaml

    The "packages" list of the "pnpm-workspace.yaml" in the repository root
    holds glob patterns, relative to the root. They behave like the patterns of
    npm workspaces: "*" matches within one directory level, "**" matches any
    depth, and a pattern starting with "!" removes what the patterns before it
    matched. In addition:

      * the root package is always a module, whatever the patterns say;
      * a matched directory without a package.json is not a module;
      * a directory named "node_modules" never contains modules;
      * without a "packages" list, or with an empty one, the root is the only
        module. (pnpm 9 reports a missing list as an error, pnpm 10 and later
        use the root alone. Elevate does the latter in all cases and leaves the
        error to pnpm's own output.)

    A module's id and name are its package name, its relPath is its directory
    relative to the root with forward slashes, and its version is the version
    of its package.json. The root comes first, the others are sorted by relPath.

    Scenario: PWS-01 Packages matched by the patterns are modules
      Given the tree
        """
        package.json                   {"name": "mono", "version": "0.0.0", "private": true}
        pnpm-workspace.yaml            packages: ["packages/*"]
        pnpm-lock.yaml                 lockfileVersion: '9.0'
        packages/
          core/
            package.json               {"name": "@acme/core", "version": "1.2.0"}
          cli/
            package.json               {"name": "@acme/cli", "version": "2.0.0"}
        apps/
          web/
            package.json               {"name": "@acme/web", "version": "3.0.0"}
        """
      When module discovery of the npm ecosystem runs from the top directory of the tree
      Then the modules are, in this order
        | id         | relPath       | isRoot | version |
        | mono       | Root          | yes    | 0.0.0   |
        | @acme/cli  | packages/cli  | no     | 2.0.0   |
        | @acme/core | packages/core | no     | 1.2.0   |
      And every module has the ecosystem "npm"

    Scenario: PWS-02 A double star matches any depth
      Given the tree
        """
        package.json                   {"name": "mono", "private": true}
        pnpm-workspace.yaml            packages: ["packages/**"]
        pnpm-lock.yaml                 lockfileVersion: '9.0'
        packages/
          a/
            package.json               {"name": "a", "version": "1.0.0"}
          deep/
            x/
              package.json             {"name": "x", "version": "1.0.0"}
        """
      When module discovery of the npm ecosystem runs from the top directory of the tree
      Then the modules are "mono", "a" and "x"

    Scenario: PWS-03 A pattern starting with ! excludes directories
      Given the tree
        """
        package.json                   {"name": "mono", "private": true}
        pnpm-workspace.yaml            packages: ["packages/**", "!packages/deep/**"]
        pnpm-lock.yaml                 lockfileVersion: '9.0'
        packages/
          a/
            package.json               {"name": "a", "version": "1.0.0"}
          deep/
            x/
              package.json             {"name": "x", "version": "1.0.0"}
        """
      When module discovery of the npm ecosystem runs from the top directory of the tree
      Then the modules are "mono" and "a"

    Scenario: PWS-04 The root is a module even when the patterns do not match it
      Given the tree
        """
        package.json                   {"name": "mono", "version": "1.0.0", "private": true}
        pnpm-workspace.yaml            packages: ["apps/*"]
        pnpm-lock.yaml                 lockfileVersion: '9.0'
        apps/
          web/
            package.json               {"name": "web", "version": "1.0.0"}
        """
      When module discovery of the npm ecosystem runs from the top directory of the tree
      Then the first module is "mono" with the relPath "Root" and isRoot "yes"
      And the second module is "web"

    Scenario Outline: PWS-05 Without a usable packages list the root is the only module
      Given the tree
        """
        package.json                   {"name": "mono", "private": true}
        pnpm-workspace.yaml            <content>
        pnpm-lock.yaml                 lockfileVersion: '9.0'
        packages/
          a/
            package.json               {"name": "a", "version": "1.0.0"}
        """
      When module discovery of the npm ecosystem runs from the top directory of the tree
      Then the only module is "mono"

      Examples:
        | content                              |
        | catalog: {left-pad: ^1.1.0}          |
        | packages: []                         |

    Scenario: PWS-06 Directories named node_modules never contain modules
      Given the tree
        """
        package.json                   {"name": "mono", "private": true}
        pnpm-workspace.yaml            packages: ["**"]
        pnpm-lock.yaml                 lockfileVersion: '9.0'
        packages/
          a/
            package.json               {"name": "a", "version": "1.0.0"}
            node_modules/
              dep/
                package.json           {"name": "dep", "version": "1.0.0"}
        node_modules/
          other/
            package.json              {"name": "other", "version": "1.0.0"}
        """
      When module discovery of the npm ecosystem runs from the top directory of the tree
      Then the modules are "mono" and "a"

    Scenario: PWS-07 The workspaces field of package.json is ignored in a pnpm repository
      Given the tree
        """
        package.json                   {"name": "mono", "private": true, "workspaces": ["libs/*"]}
        pnpm-workspace.yaml            packages: ["packages/*"]
        pnpm-lock.yaml                 lockfileVersion: '9.0'
        libs/
          l/
            package.json               {"name": "l", "version": "1.0.0"}
        packages/
          a/
            package.json               {"name": "a", "version": "1.0.0"}
        """
      When module discovery of the npm ecosystem runs from the top directory of the tree
      Then the modules are "mono" and "a"

    Scenario: PWS-08 A pnpm-workspace.yaml does not make an npm repository a pnpm repository
      Given the tree
        """
        package.json                   {"name": "mono", "private": true, "packageManager": "npm@10.8.0", "workspaces": ["libs/*"]}
        pnpm-workspace.yaml            packages: ["packages/*"]
        libs/
          l/
            package.json               {"name": "l", "version": "1.0.0"}
        packages/
          a/
            package.json               {"name": "a", "version": "1.0.0"}
        """
      When module discovery of the npm ecosystem runs from the top directory of the tree
      Then the modules are "mono" and "l"

    Scenario: PWS-09 A pnpm-workspace.yaml that is not valid YAML leaves the root as the only module
      Given the tree
        """
        package.json                   {"name": "mono", "private": true}
        pnpm-workspace.yaml            packages: ["packages/*"
        pnpm-lock.yaml                 lockfileVersion: '9.0'
        packages/
          a/
            package.json               {"name": "a", "version": "1.0.0"}
        """
      When module discovery of the npm ecosystem runs from the top directory of the tree
      Then no error is raised
      And the only module is "mono"

  Rule: The repository root is found from any directory of a pnpm workspace

    Besides the directories whose package.json declares "workspaces" (see
    specs/01-repository-root.feature), the npm ecosystem proposes the nearest
    directory, from the start directory upwards to the boundary, that contains
    a "pnpm-workspace.yaml" which is valid YAML. Of the two kinds of directory
    the nearest one is proposed.

    The file does not need a "packages" list: a file with only settings or
    catalogs marks the root too, because the settings, the catalogs and the
    lockfile live next to it. As for package.json and pom.xml, a file that
    cannot be parsed counts as absent.

    Scenario: PWS-10 A pnpm workspace package resolves to the workspace root
      Given the tree
        """
        .git/HEAD
        package.json                   {"name": "mono", "private": true}
        pnpm-workspace.yaml            packages: ["packages/*"]
        pnpm-lock.yaml                 lockfileVersion: '9.0'
        packages/
          core/
            package.json               {"name": "core", "version": "1.0.0"}
        """
      When the root is detected from "packages/core"
      Then the root is the top directory of the tree

    Scenario: PWS-11 A workspace file with only settings still marks the root
      Given the tree
        """
        .git/HEAD
        package.json                   {"name": "app", "version": "1.0.0"}
        pnpm-workspace.yaml            catalog: {left-pad: ^1.1.0}
        pnpm-lock.yaml                 lockfileVersion: '9.0'
        src/
          index.js
        """
      When the root is detected from "src"
      Then the root is the top directory of the tree

    Scenario: PWS-12 An unreadable workspace file on the way up is skipped
      Given the tree
        """
        .git/HEAD
        package.json                   {"name": "mono", "private": true}
        pnpm-workspace.yaml            packages: ["packages/*"]
        packages/
          pnpm-workspace.yaml          packages: [unclosed
          core/
            package.json               {"name": "core", "version": "1.0.0"}
        """
      When the root is detected from "packages/core"
      Then no error is raised
      And the root is the top directory of the tree

    Scenario: PWS-13 A workspace file above the checkout is ignored
      Given the tree
        """
        pnpm-workspace.yaml            packages: ["checkout/*"]
        checkout/
          .git/HEAD
          app/
            package.json               {"name": "app", "version": "1.0.0"}
        """
      And the top directory of the tree has no ".git" entry
      When the root is detected from "checkout/app"
      Then the root is "checkout/app"

  Rule: The listing of modules names the package manager

    Scenario: PWS-14 The module listing says that the repository is managed by pnpm
      Given the tree
        """
        package.json                   {"name": "mono", "private": true}
        pnpm-workspace.yaml            packages: ["packages/*"]
        pnpm-lock.yaml                 lockfileVersion: '9.0'
        packages/
          a/
            package.json               {"name": "a", "version": "1.0.0"}
        """
      When "elevate modules --json" runs in the top directory of the tree
      Then the output has "ecosystem": "npm" and "packageManager": "pnpm"
      When "elevate modules" runs in the top directory of the tree
      Then the first line of the listing is "🪶 Discovered 📦 Node / pnpm Modules (2):"

    Scenario: PWS-15 A repository without pnpm evidence reports npm
      Given the tree
        """
        package.json                   {"name": "mono", "version": "1.0.0"}
        package-lock.json              {}
        """
      When "elevate modules --json" runs in the top directory of the tree
      Then the output has "ecosystem": "npm" and "packageManager": "npm"

    Scenario: PWS-16 The MCP tool elevate_discover_modules reports the package manager of an npm ecosystem
      Given the tree of scenario PWS-14
      When the MCP tool "elevate_discover_modules" is called with the ecosystem "npm"
      Then the result has "packageManager": "pnpm"
      When the MCP tool "elevate_discover_modules" is called with the ecosystem "maven"
      Then the result has no "packageManager"
