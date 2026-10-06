Feature: Reactor-scoped alignment of Maven dependencies
  When a Maven module depends on another module of the same reactor, the build
  uses the module as it is in the repository. A different version in the
  dependency is a mistake Elevate offers to fix by aligning it to the local
  version.

  Outside a reactor this is not true. Maven resolves the dependency from a
  repository, like any other artifact, even when a project with the same
  coordinates lies somewhere in the checkout. Aligning to that local version
  would be a guess — and with a stray POM (a sample, a fixture, an old copy)
  it can turn into the offer to downgrade a real dependency.

  Two modules are in the same reactor when both are built by the same
  outermost aggregator, that is, when their `aggregatorDir` is set and equal.

  Background:
    Given Maven itself is replaced by a test double that returns a given effective POM and a given list of newer versions
    And the release channel is "stable"

  Rule: Inside one reactor a dependency on a module is aligned, never looked up

    Scenario: ALIGN-01 A dependency on a reactor module with another version is offered for alignment
      Given the tree
        """
        pom.xml                        aggregator com.acme:parent:2.0.0 with modules "core" and "app"
        core/
          pom.xml                      child of com.acme:parent, artifactId core
        app/
          pom.xml                      child of com.acme:parent, artifactId app,
                                       depends on com.acme:core with <version>1.0.0</version>
        """
      And the repositories would report "1.5.0" as a newer version of "com.acme:core"
      When the module "app" is scanned
      Then exactly one candidate is offered for "com.acme:core"
      And its action is "align", its origin is "workspace" and its target version is "2.0.0"
      And its available versions are exactly "2.0.0"
      And "com.acme:core" is not part of the version lookup sent to Maven

    Scenario: ALIGN-02 A dependency that already matches the reactor module is left alone
      Given the tree of ALIGN-01, but "app" depends on com.acme:core with <version>2.0.0</version>
      When the module "app" is scanned
      Then no candidate is offered for "com.acme:core"
      And "com.acme:core" is not listed as skipped
      And "com.acme:core" is not part of the version lookup sent to Maven

  Rule: Outside the reactor the same coordinates are an ordinary dependency

    Such a dependency is classified without regard to the modules of the
    repository: `private` when it matches `internalScopes`, otherwise `public`.
    It is looked up through Maven and offered as an `update`.

    Scenario: ALIGN-03 A project of another reactor in the same repository is looked up, not aligned
      Given the tree
        """
        libs/
          pom.xml                      aggregator com.acme:libs:3.0.0 with module "core"
          core/
            pom.xml                    child of com.acme:libs, artifactId core
        apps/
          pom.xml                      aggregator com.acme:apps:1.0.0 with module "shop"
          shop/
            pom.xml                    child of com.acme:apps, artifactId shop,
                                       depends on com.acme:core with <version>2.1.0</version>
        """
      And the repositories report "2.2.0" as the only newer version of "com.acme:core"
      When the module "apps/shop" is scanned
      Then exactly one candidate is offered for "com.acme:core"
      And its action is "update", its origin is "public" and its target version is "2.2.0"
      And "com.acme:core" is part of the version lookup sent to Maven

    Scenario: ALIGN-04 A stray POM with the coordinates of a public artifact does not cause a downgrade
      Given the tree
        """
        pom.xml                        aggregator org.example:parent:1.0.0 with module "app"
        app/
          pom.xml                      child of org.example:parent, artifactId app,
                                       depends on com.google.guava:guava with <version>33.0.0-jre</version>
        examples/
          legacy/
            pom.xml                    com.google.guava:guava:1.0, no parent
        """
      And the repositories report "33.1.0-jre" and "33.2.0-jre" as newer versions of "com.google.guava:guava"
      When the module "app" is scanned
      Then exactly one candidate is offered for "com.google.guava:guava"
      And its action is "update", its origin is "public" and its target version is "33.2.0-jre"
      And no candidate has the target version "1.0"

    Scenario: ALIGN-05 Independent projects without an aggregator are not aligned to each other
      Given the tree
        """
        lib/
          pom.xml                      com.acme:lib:5.0.0, no parent, no <modules>
        app/
          pom.xml                      com.acme:app:1.0.0, no parent,
                                       depends on com.acme:lib with <version>4.0.0</version>
        """
      And the repositories report "4.1.0" as the only newer version of "com.acme:lib"
      When the module "app" is scanned
      Then exactly one candidate is offered for "com.acme:lib"
      And its action is "update" and its target version is "4.1.0"

    Scenario: ALIGN-06 An internal scope still marks such a dependency as private
      Given the tree of ALIGN-03
      And the internal scopes are "com.acme"
      And the repositories report "2.2.0" as the only newer version of "com.acme:core"
      When the module "apps/shop" is scanned
      Then exactly one candidate is offered for "com.acme:core"
      And its action is "update" and its origin is "private"

    Scenario: ALIGN-07 Nothing is offered when the repositories know no newer version
      Given the tree of ALIGN-03
      And the repositories report no newer version of "com.acme:core"
      When the module "apps/shop" is scanned
      Then no candidate is offered for "com.acme:core"
      And no candidate has the target version "3.0.0"
