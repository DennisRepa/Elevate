Feature: Repository root detection
  Elevate reads its configuration from the repository root and discovers
  modules below it. People start Elevate from wherever they happen to be: the
  repository root, a workspace package, a Maven submodule. The root must be
  the same in all of these cases, otherwise modules go missing and
  `elevate.config.json` — which holds `internalScopes`, the protection against
  looking up internal packages on public registries — is silently not applied.

  The start directory is the directory Elevate is started in.

  Background:
    Given every tree contains a ".git/HEAD" file in its top directory unless stated otherwise

  Rule: The search never leaves the version-control checkout

    The boundary is the nearest directory, starting at the start directory and
    walking upwards, that contains an entry named ".git" (a directory, or a
    file as in worktrees and submodules). The boundary directory itself is
    still examined; nothing above it is. Without any ".git" entry the search
    may continue to the file-system root.

    Scenario: ROOT-10 Markers above the checkout are ignored
      Given the tree
        """
        elevate.config.json            {"internalScopes": ["@outer"]}
        package.json                   {"name": "outer", "workspaces": ["checkout/*"]}
        checkout/
          .git/HEAD
          app/
            package.json               {"name": "app", "version": "1.0.0"}
        """
      And the top directory of the tree has no ".git" entry
      When the root is detected from "checkout/app"
      Then the root is "checkout/app"

  Rule: An elevate.config.json marks the root explicitly

    The nearest directory with a file named "elevate.config.json", starting at
    the start directory and walking upwards to the boundary, is the root. This
    rule wins over every other rule.

    Scenario: ROOT-01 A configuration file in an ancestor directory marks the root
      Given the tree
        """
        elevate.config.json            {"internalScopes": ["com.acme"]}
        services/
          billing/
            pom.xml                    a standalone project com.acme:billing:1.0.0
        """
      When the root is detected from "services/billing"
      Then the root is the top directory of the tree

    Scenario: ROOT-02 The nearest configuration file wins
      Given the tree
        """
        elevate.config.json            {}
        frontend/
          elevate.config.json          {}
          package.json                 {"name": "frontend", "version": "1.0.0"}
          src/
        """
      When the root is detected from "frontend/src"
      Then the root is "frontend"

    Scenario: ROOT-12 The configuration of the detected root is applied when started in a submodule
      Given the tree
        """
        elevate.config.json            {"internalScopes": ["com.acme"], "channel": "all"}
        pom.xml                        aggregator com.acme:parent:1.0.0 with module "core"
        core/
          pom.xml                      child of com.acme:parent, artifactId core
        """
      When the configuration is loaded from "core"
      Then the configuration's root is the top directory of the tree
      And the configuration's internal scopes are "com.acme"
      And the configuration's channel is "all"

  Rule: Without a configuration file, each ecosystem proposes a root and the outermost proposal wins

    npm proposes the nearest directory, from the start directory upwards to the
    boundary, whose package.json is valid JSON and declares "workspaces".

    Maven proposes a root only when the start directory contains a pom.xml. It
    starts there and repeatedly moves to *the POM above*, until there is none.
    The POM above a directory D is the outermost of:

      (a) the local parent: the file Maven would use for D's `<parent>`
          (`<relativePath>`, by default "../pom.xml"; an empty
          `<relativePath/>` disables it), provided it exists, lies in a strict
          ancestor directory of D within the boundary, and its artifactId and
          groupId (own or inherited from its own parent) equal those of the
          `<parent>` element;
      (b) the aggregator: the nearest strict ancestor directory of D within the
          boundary whose pom.xml lists D in `<modules>` — as a directory or as
          a path to D's pom.xml.

    A package.json or pom.xml that cannot be parsed counts as absent.
    `<modules>` inside `<profiles>` are not considered.

    Scenario: ROOT-03 An npm workspace package resolves to the workspace root
      Given the tree
        """
        package.json                   {"name": "mono", "workspaces": ["packages/*"]}
        packages/
          core/
            package.json               {"name": "core", "version": "1.0.0"}
        """
      When the root is detected from "packages/core"
      Then the root is the top directory of the tree

    Scenario: ROOT-04 A Maven submodule resolves to the reactor root
      Given the tree
        """
        pom.xml                        aggregator org.example:parent:1.0.0 with modules "core" and "app"
        core/
          pom.xml                      child of org.example:parent, artifactId core
        app/
          pom.xml                      child of org.example:parent, artifactId app
        """
      When the root is detected from "core"
      Then the root is the top directory of the tree
      And Maven module discovery from that root reports the modules "Root", "app" and "core"

    Scenario: ROOT-05 Nested aggregators are climbed to the outermost one
      Given the tree
        """
        pom.xml                        aggregator g:top:1 with module "platform", no parent
        platform/
          pom.xml                      aggregator g:platform:1 with module "services/billing", empty <relativePath/>
          services/
            billing/
              pom.xml                  g:billing:1, no parent
        """
      When the root is detected from "platform/services/billing"
      Then the root is the top directory of the tree

    Scenario: ROOT-06 A child that inherits from the POM above without being listed as a module still resolves to it
      Given the tree
        """
        pom.xml                        g:parent:1 with packaging pom and no <modules>
        tool/
          pom.xml                      <parent> g:parent:1 without <relativePath>, artifactId tool
        """
      When the root is detected from "tool"
      Then the root is the top directory of the tree

    Scenario: ROOT-07 A project that opts out of the local parent and is not aggregated stays its own root
      Given the tree
        """
        pom.xml                        g:parent:1 with packaging pom and no <modules>
        tool/
          pom.xml                      <parent> g:parent:1 with an empty <relativePath/>, artifactId tool
        """
      When the root is detected from "tool"
      Then the root is "tool"

    Scenario: ROOT-08 An unrelated pom.xml in the directory above is not a root
      Given the tree
        """
        pom.xml                        other:thing:1, no <modules>
        tool/
          pom.xml                      g:tool:1, no parent
        """
      When the root is detected from "tool"
      Then the root is "tool"

    Scenario: ROOT-09 The outermost proposal wins when both ecosystems propose a root
      Given the tree
        """
        package.json                   {"name": "mono", "workspaces": ["frontend/*"]}
        backend/
          pom.xml                      aggregator g:backend:1 with module "service"
          service/
            pom.xml                    child of g:backend, artifactId service
        """
      When the root is detected from "backend/service"
      Then the root is the top directory of the tree

    Scenario: ROOT-13 Unreadable manifests on the way up are skipped
      Given the tree
        """
        package.json                   {"name": "mono", "workspaces": ["packages/*"]}
        packages/
          package.json                 { this is not JSON
          pom.xml                      <project><unclosed>
          core/
            package.json               {"name": "core", "version": "1.0.0"}
            pom.xml                    g:core:1, no parent
        """
      When the root is detected from "packages/core"
      Then no error is raised
      And the root is the top directory of the tree

  Rule: Without any marker the start directory is the root

    Scenario: ROOT-11 A plain project is its own root
      Given the tree
        """
        project/
          package.json                 {"name": "plain", "version": "1.0.0"}
        """
      When the root is detected from "project"
      Then the root is "project"
