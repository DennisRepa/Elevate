Feature: Maven module discovery
  Elevate treats the Maven projects of a repository as modules. A dependency
  on one of them is an internal dependency. Repositories also contain POM
  files that are not projects of the build: test fixtures under
  `src/test/resources`, sample projects of the maven-invoker-plugin under
  `src/it`, archetype templates. If such a file is taken for a module, a
  dependency with the same coordinates is mistaken for an internal one.

  Rule: Every project named in a <modules> section is a module

    This holds wherever the project lies, including directories the file walk
    does not enter.

    Scenario: DISC-05 A module listed in <modules> is found even inside a source tree
      Given the tree
        """
        pom.xml                        aggregator g:parent:1 with module "src/tools"
        src/
          tools/
            pom.xml                    g:tools:1, no parent
        """
      When Maven module discovery runs from the top directory of the tree
      Then it reports exactly the modules "g:parent" and "g:tools"

  Rule: The file walk does not enter the source tree of a Maven project

    The walk finds projects that no `<modules>` section names. It does not
    descend into a directory named "src" whose parent directory contains a
    pom.xml: Maven reserves `<project>/src` for sources, resources and test
    projects.

    Scenario: DISC-01 A fixture POM under src/test/resources is not a module
      Given the tree
        """
        pom.xml                        aggregator org.example:parent:1.0.0 with module "core"
        core/
          pom.xml                      child of org.example:parent, artifactId core
          src/
            test/
              resources/
                sample/
                  pom.xml              com.google.guava:guava:1.0
        """
      When Maven module discovery runs from the top directory of the tree
      Then it reports exactly the modules "org.example:parent" and "org.example:core"

    Scenario: DISC-02 Integration-test projects under src/it are not modules
      Given the tree
        """
        pom.xml                        g:plugin:1, no parent, no <modules>
        src/
          it/
            simple/
              pom.xml                  g:it-simple:1
            settings/
              nested/
                pom.xml                g:it-nested:1
        """
      When Maven module discovery runs from the top directory of the tree
      Then it reports exactly the module "g:plugin"

    Scenario: DISC-03 Projects next to a source tree are still found
      Given the tree
        """
        pom.xml                        g:app:1, no parent, no <modules>
        src/
          main/
            resources/
              archetype/
                pom.xml                g:template:1
        tools/
          pom.xml                      g:tools:1, no parent
        """
      When Maven module discovery runs from the top directory of the tree
      Then it reports exactly the modules "g:app" and "g:tools"

    Scenario: DISC-04 A directory named src that is not a project's source tree is walked
      Given the tree
        """
        README.md
        src/
          backend/
            pom.xml                    g:backend:1, no parent
          frontend/
            package.json               {"name": "frontend"}
        """
      And the top directory of the tree contains no pom.xml
      When Maven module discovery runs from the top directory of the tree
      Then it reports exactly the module "g:backend"

  Rule: Build output and dependency directories are not walked

    Scenario Outline: DISC-06 POM files in <directory> are not modules
      Given the tree
        """
        pom.xml                        g:app:1, no parent, no <modules>
        <directory>/
          leftover/
            pom.xml                    g:leftover:1
        """
      When Maven module discovery runs from the top directory of the tree
      Then it reports exactly the module "g:app"

      Examples:
        | directory    |
        | node_modules |
        | target       |
        | build        |
        | dist         |
        | out          |
        | .cache       |
