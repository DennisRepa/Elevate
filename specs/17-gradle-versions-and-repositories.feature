Feature: Newer versions of Gradle dependencies, and where they may be looked up
  Elevate learns about newer versions from the repositories the build itself
  declares, by asking Gradle (the lookup run of specs/15), so that mirrors,
  credentials, proxies, init scripts and the content filters of the build apply
  without any Elevate configuration. Elevate never contacts a repository
  itself. Three facts about Gradle shape this page (specs/README.md, facts 1 to
  6 and 12; checked with Gradle 7.6.6, 8.14.3 and 9.8.1):

    * Gradle lists the versions of a module only to answer a dynamic selector.
      Elevate asks for `group:name:+` with a component selection rule that
      rejects every candidate; Gradle then offers the rule each version of
      every repository, in its own order, and ends with a failure that says
      "not found". The failure is the normal end of the lookup, not an error:
      a failure of another kind (HTTP 401, 500, no connection) is an error.
    * A dynamic selector merges all repositories. With the build's
      repositories `[internal, public]` and the version 99.0 only in
      `public`, `g:a:+` resolves to 99.0. An internal name looked up this
      way is sent to the public repository: dependency confusion. Elevate's
      rule (specs/README.md, "Origin"): an internal package is never looked up
      on a public repository. Gradle enforces it: before the lookup, Elevate
      makes every public repository exclude the internal groups
      (`content { excludeGroupByRegex }`), and the public plugin repositories
      are taken away from the lookup of an internal plugin id.
    * The order in which Gradle offers versions is per repository, so Elevate
      merges the lists and sorts them itself with Gradle's version ordering.

  "Latest" is the highest version, in that ordering, among the versions
  newer than the current one that the release channel allows. The channel and
  the pre-release detection are the ones of the other ecosystems
  (`isPreReleaseVersion`); the flavour logic of Maven (`pickLatest`) applies
  too, so a `-jre` version is not replaced by an `-android` one.

  The plan Elevate hands to the lookup run (`plan.json`, protocol in
  specs/README.md):

    | Field                 | Content                                                                                         |
    | publicRepositoryUrls  | the URLs of the public repositories of all projects of the build, without trailing slash or credentials |
    | internalGroupPatterns | one regular expression per internal scope: the escaped scope followed by `(\..*)?`              |
    | lookups[]             | `id`, `buildRoot` (the build's directory), `project` (Gradle path), `kind` ("module" or "plugin"), `group`, `name` |

  Background:
    Given Gradle itself is replaced by a test double that answers describe runs with the builds given below and lookup runs with the versions given below
    And the release channel is "stable"
    And the tree contains "settings.gradle" with the text "include 'app'"
    And Gradle describes the build "mono" in "." with the projects ":" and ":app", both at version 1.0.0 and with the build scripts "build.gradle" and "app/build.gradle"
    And Gradle reports for ":app" the repository "MavenRepo" at "https://repo.maven.apache.org/maven2/"
    And the build script of every module contains a literal for each dependency Gradle reports for it

  Rule: Versions are ordered the way Gradle orders them

    Gradle compares versions part by part (verified against Gradle itself with
    24 919 pairs of version strings on each of the three Gradle versions,
    fact 12):

      1. A version is split into parts at ".", "-", "_" and "+" and wherever a
         digit meets a non-digit (only the ASCII digits count). Empty parts
         are kept.
      2. The parts are compared from the left until one version has no part
         left. Equal parts are skipped.
      3. A numeric part is greater than a non-numeric one. Two numeric parts
         compare as numbers; a part of more than 18 digits whose value
         exceeds 9223372036854775807 is not numeric but a string.
      4. Two strings: when both are special words, compared without regard to
         case, the order is dev < rc < snapshot < final < ga < release < sp,
         and the comparison ends there (so "rc" and "RC" are equal, however
         the versions continue). A special word other than "dev" is greater
         than any other string, "dev" is smaller than any other string. Two
         other strings compare as text, with uppercase before lowercase.
      5. If one version has parts left over: when the first of them is
         numeric the longer version is greater, otherwise it is smaller.

    The versions of a coordinate are the union of what all its repositories
    hold, without duplicates. Versions that compare equal ("1.0-1" and "1.0.1")
    are different versions; their relative order is the order in which they
    were reported. "Newer" means strictly greater than the current version.

    Scenario Outline: GRDVER-01 Versions are sorted newest first
      Given the versions of the case "<case>" in any order
      When they are sorted newest first
      Then the order is exactly <order>

      Examples:
        | case                | order                                                                                                           |
        | numbers             | "10.0", "9.0", "2.0", "2", "1.10", "1.9", "1.0.1", "1.0.0", "1.0"                                                 |
        | qualifiers          | "2.0.0", "2.0.0-SP1", "2.0.0.RELEASE", "2.0.0-GA", "2.0.0.Final", "2.0.0-SNAPSHOT", "2.0.0-RC1", "2.0.0-beta.2", "2.0.0-alpha1", "2.0.0-dev-5", "2.0" |
        | other strings       | "1.0.0-zzz", "1.0.0-z", "1.0.0.b", "1.0.0.alpha", "1.0.0-aaa", "1.0.0-a", "1.0.0-ZZZ", "1.0.0.CR1", "1.0.0.Beta2", "1.0.0-BETA3", "1.0.0-B05" |
        | words and strings   | "1.0.0-SP1", "1.0.0.RELEASE", "1.0.0.Final", "1.0.0-b05", "1.0.0.M1", "1.0.0-dev-5"                               |
        | flavours            | "33.0.0-jre", "32.0.0-jre", "32.0.0-android", "31.1-jre", "31.0-jre", "31.0-android"                              |
        | leftover parts      | "1.0-1", "1.0.1", "1.0.0.0", "1.0.0", "1.0.0-SNAPSHOT", "1.0.0-rc1", "1.0"                                        |
        | Spring and JUnit    | "5.10.0", "5.10.0-RC1", "5.10.0-M1", "5.9.3", "4.13.2", "4.13", "4.13-rc-1", "4.13-beta-2"                        |
        | Android Gradle      | "8.2.0", "8.2.0-rc01", "8.2.0-beta01", "8.2.0-alpha10", "8.2.0-alpha01", "8.1.4"                                  |
        | dates               | "20240101", "2024.10.1", "2024.9.30", "2024.01.15", "100", "99"                                                    |
        | very large numbers  | "9223372036854775807", "20240101123456", "1.99999", "1.9223372036854775808", "9223372036854775808"                |

    Scenario Outline: GRDVER-02 Some different versions are equal for Gradle
      When "<a>" and "<b>" are compared
      Then neither is newer than the other

      Examples:
        | a          | b          |
        | 1.0.0-rc   | 1.0.0-RC1  |
        | 2.0.0-sp   | 2.0.0-SP1  |
        | 1.0.release | 1.0.RELEASE |
        | 1.0-1      | 1.0.1      |
        | 1.0.1      | 1.0_1      |
        | 1.0_1      | 1.0+1      |
        | 1.         | 1          |
        | 01         | 1          |

    Scenario Outline: GRDVER-03 Only a strictly greater version is newer
      When "<candidate>" is compared with the current version "<current>"
      Then it is <verdict>

      Examples:
        | current       | candidate        | verdict      |
        | 1.0.0         | 1.0.0.RELEASE    | not newer    |
        | 1.0.0         | 1.0.0.0          | newer        |
        | 1.0           | 1.0.0            | newer        |
        | 1.0.0-rc1     | 1.0.0            | newer        |
        | 2.0.0-SNAPSHOT | 2.0.0           | newer        |
        | 2.0.0         | 2.0.0-SNAPSHOT   | not newer    |
        | 31.0-jre      | 31.0-android     | not newer    |
        | 31.0-android  | 31.0-jre         | newer        |
        | 1.9           | 1.10             | newer        |

    @integration
    Scenario: GRDVER-04 Gradle itself orders a corpus of version strings the way Elevate does
      Given Gradle is installed
      And a local file repository that holds the module "ord:t" in the 203 versions of the version corpus of specs/README.md, in a scrambled order
      When Gradle lists the versions of "ord:t" through the lookup run
      And Elevate sorts the versions newest first
      Then every pair of neighbours in Gradle's order is in the same order, or equal, for Elevate

  Rule: The channel decides which newer version is the latest

    Scenario Outline: GRDVER-05 Pre-releases are recognised in the version strings of the Gradle world
      When the version "<version>" is classified
      Then it is <kind>

      Examples:
        | version        | kind        |
        | 1.9.20-Beta2   | a pre-release (tag BETA)  |
        | 2.0.0-RC1      | a pre-release (tag RC)    |
        | 8.2.0-alpha01  | a pre-release (tag ALPHA) |
        | 6.0.0-M1       | a pre-release (tag M1)    |
        | 3.2.0-SNAPSHOT | a pre-release (tag SNAPSHOT) |
        | 2.0.0-dev-5    | a pre-release (tag DEV)   |
        | 4.13-beta-2    | a pre-release (tag BETA)  |
        | 5.3.30.RELEASE | a release                 |
        | 1.0.0.Final    | a release                 |
        | 2.0.0-SP1      | a release                 |
        | 33.0.0-jre     | a release                 |
        | 32.0.0-android | a release                 |
        | 2024.01.15     | a release                 |

    Scenario: GRDVER-06 The stable channel offers the highest stable version that is newer
      Given Gradle reports for ":app" the declared dependency "org.example:lib:1.0" in the configuration "implementation"
      And the repositories hold the versions "1.0", "1.1", "1.2-rc1" and "2.0-beta1" of "org.example:lib"
      When ":app" is scanned
      Then exactly one candidate is offered for "org.example:lib"
      And its new range is "1.1" and it is not a pre-release

    Scenario: GRDVER-07 The all channel offers the highest version, pre-releases included
      Given the release channel is "all"
      And Gradle reports for ":app" the declared dependency "org.example:lib:1.0" in the configuration "implementation"
      And the repositories hold the versions "1.0", "1.1", "1.2-rc1" and "2.0-beta1" of "org.example:lib"
      When ":app" is scanned
      Then the candidate for "org.example:lib" has the new range "2.0-beta1"
      And it is a pre-release with the tag "BETA", its diff is "major" and it is not preselected

    Scenario: GRDVER-08 A flavour suffix is kept
      Given Gradle reports for ":app" the declared dependency "org.example:lib:31.0-jre" in the configuration "implementation"
      And the repositories hold the versions "31.0-jre", "32.0-jre", "32.0-android" and "33.0-android" of "org.example:lib"
      When ":app" is scanned
      Then the candidate for "org.example:lib" has the new range "32.0-jre"

    Scenario: GRDVER-09 A pre-release as the current version still gets the highest stable version on the stable channel
      Given Gradle reports for ":app" the declared dependency "org.example:lib:2.0-rc1" in the configuration "implementation"
      And the repositories hold the versions "1.9", "2.0-rc1", "2.0-rc2" and "2.0" of "org.example:lib"
      When ":app" is scanned
      Then the candidate for "org.example:lib" has the new range "2.0"

    Scenario: GRDVER-10 Nothing newer means no candidate and no entry in the skipped list
      Given Gradle reports for ":app" the declared dependency "org.example:lib:1.1" in the configuration "implementation"
      And the repositories hold the versions "1.0" and "1.1" of "org.example:lib"
      When ":app" is scanned
      Then no candidate is offered
      And nothing is listed as skipped

    Scenario Outline: GRDVER-11 The kind of change follows the numbers, a major change is not preselected
      Given Gradle reports for ":app" the declared dependency "org.example:lib:<current>" in the configuration "implementation"
      And the repositories hold the versions "<current>" and "<latest>" of "org.example:lib"
      When ":app" is scanned
      Then the candidate for "org.example:lib" has the diff "<diff>"
      And it is <preselected>

      Examples:
        | current    | latest      | diff  | preselected      |
        | 1.0.0      | 1.0.1       | patch | preselected      |
        | 1.0.0      | 1.3.0       | minor | preselected      |
        | 1.0.0      | 2.0.0       | major | not preselected  |
        | 31.0-jre   | 33.0.0-jre  | major | not preselected  |
        | 5.3.30.RELEASE | 5.3.31.RELEASE | patch | preselected |

    Scenario: GRDVER-12 The versions to choose from are all newer versions, newest first, and the current one
      Given Gradle reports for ":app" the declared dependency "org.example:lib:1.0" in the configuration "implementation"
      And the repositories hold the versions "0.9", "1.0", "1.1", "1.2-rc1", "1.2" and "2.0-beta1" of "org.example:lib"
      When ":app" is scanned
      Then the available versions of the candidate for "org.example:lib" are exactly "2.0-beta1", "1.2", "1.2-rc1", "1.1" and "1.0"

    Scenario: GRDVER-13 An update the repositories do not know is refused when chosen by hand
      Given Gradle reports for ":app" the declared dependency "org.example:lib:1.0" in the configuration "implementation"
      And the repositories hold the versions "1.0", "1.1" and "1.2" of "org.example:lib"
      When the update of "org.example:lib" to "7.7.7" is requested for ":app"
      Then it fails with an UpdateSelectionError
      And the message is
        """
        'org.example:lib' has no version 7.7.7 in the configured repositories. Available: 1.2, 1.1, 1.0.
        """

  Rule: The repositories are the ones Gradle would use for the project

    The describe run reports, for every project, the repositories of the
    project and of its `buildscript` and, for the build, those of the settings
    (`dependencyResolutionManagement`) and of the plugin management. The
    repositories that decide a dependency lookup are, by the
    `repositoriesMode` of the settings (fact 23):

      | repositoriesMode          | repositories used for the dependencies of a project |
      | PREFER_PROJECT (default)  | those of the project when it declares any, otherwise those of the settings |
      | PREFER_SETTINGS           | those of the settings only (none, when the settings declare none) |
      | FAIL_ON_PROJECT_REPOS     | those of the settings                               |

    For a plugin lookup the repositories of the project's `buildscript` decide.
    Gradle reports the repositories of `pluginManagement` there as wrappers
    named `__plugin_repository__<name>` without a URL (fact 24); Elevate maps
    them to the repository `<name>` of the settings' plugin management. A build
    that declares no plugin repository uses the Gradle Plugin Portal,
    `https://plugins.gradle.org/m2`.

    Scenario Outline: GRDVER-14 The effective repositories follow the repositories mode
      Given the repositories mode of the build is "<mode>"
      And the settings declare the repositories <settings>
      And ":app" declares the repositories <project>
      When the repositories for the dependencies of ":app" are determined
      Then they are <effective>

      Examples:
        | mode                  | settings    | project   | effective |
        | PREFER_PROJECT        | "S"         | "P"       | "P"       |
        | PREFER_PROJECT        | "S"         | none      | "S"       |
        | PREFER_PROJECT        | none        | "P"       | "P"       |
        | PREFER_SETTINGS       | "S"         | "P"       | "S"       |
        | PREFER_SETTINGS       | none        | "P"       | none      |
        | FAIL_ON_PROJECT_REPOS | "S"         | none      | "S"       |

    Scenario: GRDVER-15 Plugin repositories are mapped from the plugin management of the settings
      Given the plugin management of the settings declares the repositories "corp-plugins" at "https://nexus.acme.example/plugins" and "Gradle Central Plugin Repository" at "https://plugins.gradle.org/m2"
      And ":app" reports in its buildscript the repositories "__plugin_repository__corp-plugins" and "__plugin_repository__Gradle Central Plugin Repository" without URLs
      When the repositories for the plugins of ":app" are determined
      Then they are "corp-plugins" at "https://nexus.acme.example/plugins" and "Gradle Central Plugin Repository" at "https://plugins.gradle.org/m2"

    Scenario: GRDVER-16 Without plugin repositories the Gradle Plugin Portal is used
      Given ":app" reports in its buildscript the repository "Gradle Central Plugin Repository" at "https://plugins.gradle.org/m2"
      When the repositories for the plugins of ":app" are determined
      Then they are "Gradle Central Plugin Repository" at "https://plugins.gradle.org/m2"

    Scenario Outline: GRDVER-17 A repository is public when its host is a well-known public one
      The hosts are repo.maven.apache.org, repo1.maven.org, central.sonatype.com,
      plugins.gradle.org, dl.google.com, maven.google.com, jcenter.bintray.com,
      jitpack.io, oss.sonatype.org, s01.oss.sonatype.org and repo.spring.io. A
      repository with any other host, a `file:` URL (`mavenLocal()`) or no URL
      (`flatDir`) is private: a company's Artifactory or Nexus is private even
      when it mirrors Maven Central, as an npm registry is private.

      When the repository <repository> is classified
      Then it is <kind>

      Examples:
        | repository                                              | kind    |
        | "https://repo.maven.apache.org/maven2/"                 | public  |
        | "https://repo1.maven.org/maven2"                        | public  |
        | "https://dl.google.com/dl/android/maven2/"              | public  |
        | "https://plugins.gradle.org/m2"                         | public  |
        | "https://jitpack.io"                                    | public  |
        | "https://REPO.MAVEN.APACHE.ORG/maven2"                  | public  |
        | "https://nexus.acme.example/repository/maven-central/"  | private |
        | "http://127.0.0.1:8081/repository/releases"             | private |
        | "file:/root/.m2/repository"                             | private |
        | a flat directory                                        | private |

    Scenario: GRDVER-18 Credentials in a repository URL never leave the scan
      Given Gradle reports for ":app" the repository "corp" at "https://deploy:s3cret@repo.maven.apache.org/maven2/"
      And the repositories hold the versions "1.0" and "1.1" of "org.example:lib"
      When ":app" is scanned
      Then the plan sent to Gradle contains the public repository URL "https://repo.maven.apache.org/maven2" and no text "s3cret"
      And the lookup error of a failing coordinate contains no text "s3cret" either

  Rule: An internal package is never looked up on a public repository

    A dependency's origin is decided as for Maven (specs/04): "workspace" for
    a project of an included build that Gradle substitutes (see below),
    "private" when its group matches one of the `internalScopes`
    (`com.acme` matches `com.acme` and `com.acme.billing`, not `com.acmecorp`),
    "public" otherwise. A plugin id is matched like a group.

    Gradle substitutes a dependency by a project of an included build when the
    project's group and name are the dependency's, whatever version is
    requested (fact 15). That holds for every project of the included build
    that has a group, not only its root project. Substitution rules that a
    settings file writes by hand (`dependencySubstitution { substitute module(…)
    using project(…) }`) are honoured by Gradle but not read by Elevate: such a
    dependency is an ordinary one for Elevate, looked up through the guard
    below like any other (specs/README.md, "Gradle: scope and non-goals").

    Scenario Outline: GRDVER-19 Every internal scope becomes one pattern
      Given the internal scopes are "<scope>"
      When the plan for a lookup is built
      Then its internalGroupPatterns are <patterns>

      Examples:
        | scope           | patterns                          |
        | com.acme        | "com\\.acme(\\..*)?"              |
        | com.acme.       | "com\\.acme(\\..*)?"              |
        | @my-org         | "my-org(\\..*)?"                  |
        | io.github.me    | "io\\.github\\.me(\\..*)?"        |
        | @               | none                              |

    Scenario: GRDVER-20 A public dependency is looked up in all repositories without a guard
      Given no internal scopes are configured
      And Gradle reports for ":app" the declared dependency "com.google.guava:guava:31.0-jre" in the configuration "implementation"
      And the repositories hold the versions "31.0-jre" and "33.0-jre" of "com.google.guava:guava"
      When ":app" is scanned
      Then the candidate for "com.google.guava:guava" has the origin "public" and the new range "33.0-jre"
      And the plan lists the lookup of "com.google.guava:guava" for ":app" and its internalGroupPatterns are empty

    Scenario: GRDVER-21 An internal dependency is looked up when the build has a private repository
      Given the internal scopes are "com.acme"
      And Gradle reports for ":app" the repositories
        | name      | url                                                 |
        | MavenRepo | https://repo.maven.apache.org/maven2/               |
        | corp      | https://nexus.acme.example/repository/releases/     |
      And Gradle reports for ":app" the declared dependency "com.acme.billing:core:1.0" in the configuration "implementation"
      And the repositories hold the versions "1.0" and "1.1" of "com.acme.billing:core"
      When ":app" is scanned
      Then the candidate for "com.acme.billing:core" has the origin "private" matched by "internal-scope"
      And the plan lists the lookup of "com.acme.billing:core" for ":app"
      And the plan's publicRepositoryUrls are exactly "https://repo.maven.apache.org/maven2"
      And the plan's internalGroupPatterns are exactly "com\\.acme(\\..*)?"

    Scenario: GRDVER-22 An internal dependency with only public repositories is not looked up
      Given the internal scopes are "com.acme"
      And Gradle reports for ":app" the declared dependency "com.acme.billing:core:1.0" in the configuration "implementation"
      When ":app" is scanned
      Then no candidate is offered
      And the skipped dependency is "com.acme.billing:core" with the origin "private", the reason "private-on-public-registry" and the detail "https://repo.maven.apache.org/maven2/"
      And no lookup run is started

    Scenario: GRDVER-23 An internal plugin id is guarded like a group
      Given the internal scopes are "com.acme"
      And Gradle reports for ":app" no declared dependencies
      And Gradle reports for ":app" the plugin "com.acme.conventions" at version "1.0"
      And ":app" reports in its buildscript the repositories "Gradle Central Plugin Repository" at "https://plugins.gradle.org/m2"
      When ":app" is scanned
      Then no candidate is offered
      And the skipped dependency is "com.acme.conventions" with the origin "private", the reason "private-on-public-registry" and the detail "https://plugins.gradle.org/m2"

    Scenario: GRDVER-24 An internal plugin id with a private plugin repository is looked up there
      Given the internal scopes are "com.acme"
      And Gradle reports for ":app" no declared dependencies
      And Gradle reports for ":app" the plugin "com.acme.conventions" at version "1.0"
      And the plugin management of the settings declares the repositories "corp-plugins" at "https://nexus.acme.example/plugins" and "Gradle Central Plugin Repository" at "https://plugins.gradle.org/m2"
      And ":app" reports in its buildscript the repositories "__plugin_repository__corp-plugins" and "__plugin_repository__Gradle Central Plugin Repository" without URLs
      And the repositories hold the versions "1.0" and "1.1" of "com.acme.conventions:com.acme.conventions.gradle.plugin"
      When ":app" is scanned
      Then the candidate for "com.acme.conventions" has the origin "private" and the new range "1.1"
      And the plan lists the lookup of the plugin "com.acme.conventions" for ":app" with the artifact "com.acme.conventions.gradle.plugin"

    Scenario: GRDVER-25 A dependency on an included build is aligned, never looked up
      Given Gradle describes the included build "lib" in "lib" with the projects
        | path | dir | build file    | group    | version |
        | :    | lib | lib/build.gradle | com.acme | 2.0.0   |
      And Gradle reports for ":app" the declared dependency "com.acme:lib:1.0.0" in the configuration "implementation"
      When ":app" is scanned
      Then exactly one candidate is offered for "com.acme:lib"
      And its action is "align", its origin is "workspace", its new range is "2.0.0" and its diff is "major"
      And its available versions are exactly "2.0.0"
      And the plan lists no lookup of "com.acme:lib"

    Scenario: GRDVER-26 A dependency that already has the version of the included build is left alone
      Given Gradle describes the included build "lib" in "lib" with the projects
        | path | dir | build file    | group    | version |
        | :    | lib | lib/build.gradle | com.acme | 2.0.0   |
      And Gradle reports for ":app" the declared dependency "com.acme:lib:2.0.0" in the configuration "implementation"
      When ":app" is scanned
      Then no candidate is offered
      And nothing is listed as skipped
      And the plan lists no lookup of "com.acme:lib"

    Scenario: GRDVER-27 An included build wins over the internal scopes
      Given the internal scopes are "com.acme"
      And Gradle describes the included build "lib" in "lib" with the projects
        | path | dir | build file    | group    | version |
        | :    | lib | lib/build.gradle | com.acme | 2.0.0   |
      And Gradle reports for ":app" the declared dependency "com.acme:lib:1.0.0" in the configuration "implementation"
      When ":app" is scanned
      Then the candidate for "com.acme:lib" has the origin "workspace"

    Scenario: GRDVER-28 A project of the same build with the same coordinates is an ordinary dependency
      Gradle does not replace an external coordinate by a project of the same
      build, whatever the version (fact 15). It is resolved from the
      repositories, like the dependency on another reactor in specs/04 ALIGN-03.

      Given Gradle describes the build "mono" in "." with the projects
        | path  | dir  | build file         | group    | version |
        | :     | .    | build.gradle       | com.acme | 1.0.0   |
        | :app  | app  | app/build.gradle   | com.acme | 1.0.0   |
        | :core | core | core/build.gradle  | com.acme | 3.0.0   |
      And Gradle reports for ":app" the declared dependency "com.acme:core:2.1.0" in the configuration "implementation"
      And the repositories hold the versions "2.1.0" and "2.2.0" of "com.acme:core"
      When ":app" is scanned
      Then the candidate for "com.acme:core" has the action "update", the origin "public" and the new range "2.2.0"
      And the plan lists the lookup of "com.acme:core" for ":app"

    Scenario: GRDVER-29 An included build without a group is not substituted by Gradle and is an ordinary dependency
      Given Gradle describes the included build "shared-lib" in "shared" with the projects
        | path | dir    | build file        | group | version |
        | :    | shared | shared/build.gradle |     | 3.1.4   |
      And Gradle reports for ":app" the declared dependency "shared-lib:shared-lib:1.0" in the configuration "implementation"
      And the repositories hold the versions "1.0" and "1.1" of "shared-lib:shared-lib"
      When ":app" is scanned
      Then the candidate for "shared-lib:shared-lib" has the action "update" and the origin "public"

    Scenario: GRDVER-30 An included build outside the repository is neither looked up nor offered nor listed
      Gradle substitutes it whatever version is written (fact 15), so the
      version is dead text and the name must not reach a repository.

      Given Gradle describes the included build "ext-lib" in "../ext-lib" with the projects
        | path | dir        | build file              | group   | version |
        | :    | ../ext-lib | ../ext-lib/build.gradle | org.ext | 7.0     |
      And Gradle reports for ":app" the declared dependency "org.ext:ext-lib:1.0" in the configuration "implementation"
      When ":app" is scanned
      Then no candidate is offered
      And nothing is listed as skipped
      And the plan lists no lookup of "org.ext:ext-lib"

    Scenario: GRDVER-31 The root build is not substituted in an included build
      Given Gradle describes the included build "lib" in "lib" with the projects
        | path | dir | build file       | group    | version |
        | :    | lib | lib/build.gradle | com.acme | 2.0.0   |
      And Gradle reports for ":lib" the declared dependency "com.acme:mono:0.9" in the configuration "implementation"
      And the repositories hold the versions "0.9" and "1.0" of "com.acme:mono"
      When ":lib" is scanned
      Then the candidate for "com.acme:mono" has the action "update" and the origin "public"

    Scenario: GRDVER-32 One included build can depend on any project of another by coordinates
      Given Gradle describes the included build "lib" in "lib" with the projects
        | path | dir     | build file           | group        | version |
        | :    | lib     | lib/build.gradle     | com.acme     | 2.0.0   |
        | :sub | lib/sub | lib/sub/build.gradle | com.acme.sub | 3.0.0   |
      And Gradle describes the included build "tools" in "tools" with the projects
        | path | dir   | build file         | group    | version |
        | :    | tools | tools/build.gradle | com.acme | 5.0.0   |
      And Gradle reports for ":tools" the declared dependencies
        | configuration  | dependency             |
        | implementation | com.acme:lib:1.0.0     |
        | implementation | com.acme.sub:sub:1.0.0 |
      When ":tools" is scanned
      Then the candidate for "com.acme:lib" has the action "align" and the new range "2.0.0"
      And the candidate for "com.acme.sub:sub" has the action "align" and the new range "3.0.0"

  Rule: The lookup run asks each repository once for each coordinate

    Background:
      Given Gradle reports for ":app" the declared dependencies
        | configuration  | dependency            |
        | implementation | org.example:a:1.0     |
        | implementation | org.example:b:1.0     |
      And the repositories hold the versions "1.0" and "1.1" of "org.example:a" and "org.example:b"

    Scenario: GRDVER-33 The plan names every coordinate, with the project that decides its repositories
      When ":app" is scanned
      Then the plan is
        """
        {
          "protocol": 1,
          "publicRepositoryUrls": ["https://repo.maven.apache.org/maven2"],
          "internalGroupPatterns": [],
          "lookups": [
            {"id": "L1", "buildRoot": "<top directory of the tree>", "project": ":app", "kind": "module", "group": "org.example", "name": "a"},
            {"id": "L2", "buildRoot": "<top directory of the tree>", "project": ":app", "kind": "module", "group": "org.example", "name": "b"}
          ]
        }
        """

    @posix
    Scenario: GRDVER-34 The lookup run has exactly these arguments
      Given the tree contains "gradlew"
      When ":app" is scanned
      Then the arguments of the second Gradle run after "./gradlew" are, in this order
        | argument                                      |
        | -q                                            |
        | -m                                            |
        | --console=plain                               |
        | --no-configuration-cache                      |
        | -Delevate.mode=lookup                         |
        | -Delevate.plan=.gradle/elevate-<id>/plan.json |
        | -Delevate.outDir=.gradle/elevate-<id>/out     |
        | -I                                            |
        | .gradle/elevate-<id>/probe.init.gradle        |
        | help                                          |
      And the timeout of the run is 5 minutes

    Scenario: GRDVER-35 Several modules share one describe run and one lookup run
      Given Gradle reports for ":" the declared dependency "org.example:a:1.0" in the configuration "implementation"
      When ":" and ":app" are scanned together
      Then exactly one describe run and one lookup run are started
      And the plan lists "org.example:a" once for ":" and ":app" together, because both have the same repositories

    Scenario: GRDVER-36 Modules with different repositories look up the same coordinate separately
      Given Gradle reports for ":" the repository "corp" at "https://nexus.acme.example/releases"
      And Gradle reports for ":" the declared dependency "org.example:a:1.0" in the configuration "implementation"
      When ":" and ":app" are scanned together
      Then the plan lists "org.example:a" for ":" and for ":app"

    Scenario: GRDVER-37 Without anything to look up no lookup run is started
      Given Gradle reports for ":app" no declared dependencies
      When ":app" is scanned
      Then no candidate is offered
      And exactly one Gradle run is started

    Scenario: GRDVER-38 A module without repositories lists its dependencies as not looked up
      Given Gradle reports for ":app" no repositories
      When ":app" is scanned
      Then no candidate is offered
      And the skipped dependency is "org.example:a" with the origin "public", the reason "lookup-failed" and the detail "the build declares no repository for :app"
      And the skipped dependency is "org.example:b" with the reason "lookup-failed"
      And no lookup run is started

    Scenario: GRDVER-39 The versions of several repositories are merged and sorted
      Given the repository "MavenRepo" holds the versions "1.0", "1.1" and "1.2" of "org.example:a"
      And the repository "corp" holds the versions "1.1" and "1.3" of "org.example:a"
      And Gradle reports for ":app" the repositories "MavenRepo" and "corp"
      When ":app" is scanned
      Then the candidate for "org.example:a" has the new range "1.3"
      And its available versions are exactly "1.3", "1.2", "1.1" and "1.0"

    Scenario: GRDVER-40 A coordinate the repositories do not know is not an error
      Given the repositories hold no version of "org.example:a"
      When ":app" is scanned
      Then no candidate is offered for "org.example:a"
      And nothing is listed as skipped for "org.example:a"
      And the candidate for "org.example:b" is offered as usual

    Scenario Outline: GRDVER-41 A repository error is a failed lookup, never an empty one
      The failure of a lookup is the chain of Gradle's messages, outermost
      first, joined with " > "; the detail is its last message. Once a
      repository has failed, Gradle disables it for the rest of the run (fact
      2): the lookups that follow fail with a note about the earlier error. A
      failure whose last message is such a note ("Repository <name> is
      disabled due to earlier error below:", on Gradle 7.6.6 "Skipped due to
      earlier error") takes the detail of the first failed lookup of the run
      instead, so the user sees the cause and not the note.

      Given the lookup of "org.example:a" fails with "Could not resolve org.example:a:+. > Failed to list versions for org.example:a. > Could not GET 'https://nexus.acme.example/releases/org/example/a/maven-metadata.xml'. Received status code 401 from server: Unauthorized"
      And the lookup of "org.example:b", which follows it in the run, fails with "Could not resolve org.example:b:+. > <note>"
      When ":app" is scanned
      Then no candidate is offered for "org.example:a" or "org.example:b"
      And the skipped dependency is "org.example:a" with the origin "public", the reason "lookup-failed" and the detail "Could not GET 'https://nexus.acme.example/releases/org/example/a/maven-metadata.xml'. Received status code 401 from server: Unauthorized"
      And the skipped dependency is "org.example:b" with the reason "lookup-failed" and the same detail

      Examples:
        | note                                                         |
        | Repository MavenRepo is disabled due to earlier error below: |
        | Skipped due to earlier error                                 |

    Scenario: GRDVER-42 Versions seen before a repository failed are not used
      Given the lookup of "org.example:a" fails with "Could not resolve org.example:a:+. > Could not GET 'https://corp/a'. Received status code 500 from server: Internal Server Error" after Gradle had offered the versions "1.0" and "1.1"
      When ":app" is scanned
      Then no candidate is offered for "org.example:a"
      And the skipped dependency is "org.example:a" with the reason "lookup-failed"

    Scenario: GRDVER-43 A lookup run that fails fails the scan of its modules
      Given the lookup run exits with code 1 and prints on the standard error
        """
        FAILURE: Build failed with an exception.

        * What went wrong:
        Could not compile initialization script '/work/.gradle/elevate-1a2b3c4d/probe.init.gradle'.
        """
      When ":app" is scanned
      Then the scan fails with the message
        """
        Gradle could not look up newer versions:
        FAILURE: Build failed with an exception.

        * What went wrong:
        Could not compile initialization script '/work/.gradle/elevate-1a2b3c4d/probe.init.gradle'.
        """
      And the application-level scan of ":app" reports that message as its error and no candidates
      Given the lookup run exits with code 0 and writes no answer for the lookup of "org.example:a"
      When ":app" is scanned
      Then the skipped dependency is "org.example:a" with the reason "lookup-failed" and the detail "Gradle gave no answer for this lookup."

    Scenario: GRDVER-44 A lookup run that does not finish is stopped and named
      Given the lookup run does not finish within 5 minutes
      When ":app" is scanned
      Then the scan fails with the message
        """
        Gradle timed out after 5 minutes while looking up newer versions.
        """

  Rule: Single lookups use the same machinery

    `elevate versions`, the MCP tool `elevate_get_versions` and the version
    picker of the dashboard ask for the versions of one coordinate. The
    registry of the Gradle ecosystem answers them with a lookup run of the
    build in the repository root: the first build of the module list when the
    root has none, with the repositories of its root project.

    Scenario: GRDVER-45 The versions of a library, newest first, with their kinds
      Given the repositories hold the versions "1.0", "1.2-rc1", "1.2" and "1.1" of "org.example:lib"
      When "elevate versions org.example:lib --ecosystem=gradle --json" runs in the top directory of the tree
      Then "latest" is "1.2" and "totalCount" is 4
      And the versions are "1.2", "1.2-rc1", "1.1" and "1.0"
      And the version "1.2-rc1" has "isPreRelease": true and the tag "RC"

    Scenario: GRDVER-46 A plugin id is looked up through the plugin repositories
      Given the repositories hold the versions "1.0" and "1.1" of "org.example.plugin:org.example.plugin.gradle.plugin"
      When "elevate versions org.example.plugin --ecosystem=gradle --json" runs in the top directory of the tree
      Then "latest" is "1.1"
      And the plan lists the lookup of the plugin "org.example.plugin"

    Scenario: GRDVER-47 An internal package is refused when only public repositories would be asked
      Given the internal scopes are "com.acme"
      When "elevate versions com.acme:core --ecosystem=gradle" runs in the top directory of the tree
      Then it fails with a PublicLookupRefusedError
      And the message is
        """
        'com.acme:core' is an internal package (internalScopes) and its lookup would go to the public registry https://repo.maven.apache.org/maven2/. Configure a private registry for it instead.
        """
      And no lookup run is started

    Scenario: GRDVER-48 A repository error is an error of the query
      Given the lookup of "org.example:lib" fails with "Could not resolve org.example:lib:+. > Could not GET 'https://corp/lib'. Received status code 401 from server: Unauthorized"
      When "elevate versions org.example:lib --ecosystem=gradle --json" runs in the top directory of the tree
      Then the output has the error "Could not GET 'https://corp/lib'. Received status code 401 from server: Unauthorized" and the exit code is 1

    Scenario: GRDVER-49 The MCP tool answers like the command line
      Given the repositories hold the versions "1.0" and "1.1" of "org.example:lib"
      When the MCP tool "elevate_get_versions" is called with the ecosystem "gradle" and the identifier "org.example:lib"
      Then the result has "latest": "1.1" and "totalCount": 2

    Scenario: GRDVER-50 The version picker needs no further run for a scanned candidate
      Given ":app" was scanned and the candidate for "org.example:a" carries its available versions
      When the version picker of the dashboard is opened for that candidate
      Then no Gradle run is started

  Rule: Gradle's own repository machinery is what answers

    @integration
    Scenario: GRDVER-51 The versions of two repositories are merged
      Given Gradle is installed
      And a build with the file repositories "one" (holding "org.example:lib" in 1.0 and 1.1) and "two" (holding it in 1.1 and 2.0)
      When ":app" is scanned with real Gradle
      Then the candidate for "org.example:lib" has the available versions "2.0", "1.1" and "1.0"
      And the scan leaves no file of Elevate behind

    @integration
    Scenario: GRDVER-52 An internal group is not requested from a public repository
      Given Gradle is installed
      And two local HTTP repositories that record their requests: "internal" holds "com.acme:lib" in 1.0 and 1.1, "publicish" holds "com.acme:lib" in 1.0 and 99.0 and "org.other:thing" in 5.0
      And the build declares both and the internal scopes are "com.acme"
      And Elevate treats the host of "publicish" as public
      When ":app" is scanned with real Gradle
      Then the candidate for "com.acme:lib" has the new range "1.1"
      And the log of "publicish" contains no request for "com/acme"
      And the log of "publicish" contains requests for "org/other/thing"

    @integration
    Scenario: GRDVER-53 A repository that answers 401 or 500 makes the lookup fail
      Given Gradle is installed
      And a local HTTP repository that answers every request with 401 and one that answers with 500
      When ":app" is scanned with real Gradle against each of them
      Then the dependency is listed with the reason "lookup-failed" and a detail that contains "Received status code 401 from server" or "Received status code 500 from server"

    @integration
    Scenario: GRDVER-54 A version published after the last scan is seen by the next one
      Given Gradle is installed
      And a local HTTP repository holding "org.example:lib" in 1.0 and 1.1
      When ":app" is scanned with real Gradle
      And the repository then also holds 1.2
      And ":app" is scanned again without restarting the Gradle daemon
      Then the second scan offers 1.2

    @integration
    Scenario: GRDVER-55 A project with the configuration cache enabled is scanned like any other
      Given Gradle is installed
      And a build whose gradle.properties contains "org.gradle.configuration-cache=true" ("org.gradle.unsafe.configuration-cache=true" for Gradle 7)
      When ":app" is scanned twice with real Gradle
      Then both scans offer the same candidates
