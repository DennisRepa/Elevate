Feature: Where a Gradle dependency's version is declared, and what is offered
  Gradle tells Elevate what applies: the dependencies a project declares, with
  the version each one has after Gradle has run every script of the build
  (describe run, specs/15). It does not tell where the version is written, and
  that is what an update has to change. Elevate therefore searches the files
  of the repository for the text that carries the version and checks its find
  against Gradle's answer: a location counts only if the text there is exactly
  the version Gradle reports. What cannot be located with certainty is not
  guessed; it is listed as not offered, with the reason (transparency: nothing
  silently disappears). This is the pattern of Maven's locator
  (`maven-locator.ts`), for files that are programs instead of XML.

  What Gradle reports for a project (the declared dependencies of every
  configuration, the declared constraints, the plugin markers of
  `plugins { }` and the `buildscript` classpath) is identical in Gradle 7.6.6,
  8.14.3 and 9.8.1 and in both DSLs (facts 8 to 10 and 16 in specs/README.md).
  What an update does with each kind:

    | Gradle reports                                               | Elevate                                                                              |
    | external module, plain version                               | offered; the version text is located and written                                     |
    | external module without a version                            | nothing to offer, not listed (a platform, a constraint or a plugin manages it)       |
    | project(":x"), files(...)                                    | not a subject, not listed                                                            |
    | external module without a group                              | listed, reason "invalid-name", detail "no group"                                     |
    | version `1.+`, `latest.release`, `[1.0,2.0)`                | listed, reason "version-constraint": the selector is the declaration, not a version  |
    | `strictly`, `reject` or `prefer` in the version              | listed, reason "version-constraint": changing one number would break the constraint  |
    | version whose text cannot be located with certainty          | listed, reason "declaration-mismatch", with what was searched                        |
    | platform, enforcedPlatform, bundle member                    | offered like a library                                                               |
    | constraint in `dependencies { constraints { } }`            | offered, declaration kind "dependency-management"                                   |
    | plugin marker `<id>:<id>.gradle.plugin:<version>`            | offered as the plugin <id>, scope "plugin", declaration kind "plugin"                |

  A configuration is a test configuration when one of the words of its
  camelCase name is "test" (`testImplementation`, `integrationTestRuntimeOnly`,
  `androidTestImplementation`, `testFixturesApi`); its dependencies have the
  scope "test". The `buildscript` classpath and plugins have the scope
  "plugin"; everything else is "prod". A coordinate that a module declares in
  several configurations is one candidate: its scope is the first of "prod",
  "test", "plugin" among them, its current version is the one of that
  declaration, and the new version is written to every declaration of the
  coordinate in the module.

  Where the text of a version is searched, in this order, for the dependencies
  of a module (a project with a build script, specs/15):

    1. string and map notation in the module's own build script;
    2. when that script has no such literal: the build scripts of the parent
       projects of the same build, nearest first (`subprojects { }` and
       `allprojects { }` live there). The first script with a match wins; all
       matches in that script are written;
    3. when the version is a name (`$name`, `${name}`, `version: name`): the
       definition of that name (GRDDEC-13 to GRDDEC-22);
    4. when Gradle marks the dependency as coming from a version catalog
       (`MinimalExternalModuleDependency`, fact 16): `gradle/libs.versions.toml`
       of the build (GRDCAT).

  Not searched: convention plugins in `buildSrc` or an included build, scripts
  applied with `apply from:`, init scripts, the user's `gradle.properties`. A
  version that only they define is listed as not offered, which is always
  correct and never destructive. Both DSLs are read by the same literal rules:
  outside comments, every string literal is a candidate (single, double and
  triple quotes). The forms recognised:

    | Form                  | Groovy                                                              | Kotlin                                                   |
    | string notation       | `implementation 'g:a:1.0'` `implementation "g:a:1.0"` `implementation('g:a:1.0')` | `implementation("g:a:1.0")`                |
    | classifier, extension | `'g:a:1.0:sources@jar'`                                             | `"g:a:1.0:sources@jar"`                                  |
    | map notation          | `group: 'g', name: 'a', version: '1.0'` (any order)                 | `group = "g", name = "a", version = "1.0"`               |
    | name as the version   | `"g:a:$v"` `"g:a:${v}"` `version: v`                                | `"g:a:$v"` `"g:a:${v}"` `version = v`                    |
    | plugin                | `id 'x' version '1.0'` `id('x') version('1.0')`                     | `id("x") version "1.0"` `kotlin("jvm") version "1.9.20"` |

  In the scenarios, `settings.gradle` includes the module "app", whose build
  script is `app/build.gradle` unless a scenario names another file. Unless
  a scenario says what Gradle reports for ":app" itself, Gradle reports the
  one dependency `org.example:lib:1.0` in the configuration
  "implementation"; a step that says what Gradle reports for ":app" replaces
  that usual dependency, and "no declared dependencies" removes it. Every
  coordinate is held by the repositories in the versions 1.0 and 1.1, so
  an offered candidate goes from 1.0 to 1.1 unless a step says otherwise.

  Background:
    Given Gradle itself is replaced by a test double that answers describe runs with the builds given below
    And the release channel is "stable"
    And the tree contains "settings.gradle" with the text "include 'app'"
    And Gradle describes the build "mono" in "." with the projects ":" and ":app", both at version 1.0.0 and with the build scripts "build.gradle" and "app/build.gradle"
    And Gradle reports for ":app" the usual dependency
    And the repositories hold the versions "1.0" and "1.1" of every coordinate

  Rule: A dependency with a literal version is offered

    Scenario: GRDDEC-01 A dependency in string notation is offered with its location
      Given the file "app/build.gradle" contains
        """
        dependencies { implementation 'org.example:lib:1.0' }
        """
      When ":app" is scanned
      Then exactly one candidate is offered for "org.example:lib"
      And its current range is "1.0", its new range is "1.1" and its diff is "minor"
      And its action is "update", its origin is "public", its scope is "prod" and it is preselected
      And its declaration is the dependency literal in "app/build.gradle"

    Scenario Outline: GRDDEC-02 The notations of both DSLs are recognised
      Given the file "app/<file>" contains
        """
        <line>
        """
      When ":app" is scanned
      Then the candidate for "org.example:lib" has its declaration in "app/<file>"
      When the candidate is applied to the tree
      Then "app/<file>" differs from the original only in the text "1.0" being replaced by "1.1"

      Examples:
        | file             | line                                                                                   |
        | build.gradle     | dependencies { implementation 'org.example:lib:1.0' }                                  |
        | build.gradle     | dependencies { implementation "org.example:lib:1.0" }                                  |
        | build.gradle     | dependencies { implementation('org.example:lib:1.0') }                                 |
        | build.gradle     | dependencies { implementation group: 'org.example', name: 'lib', version: '1.0' }      |
        | build.gradle     | dependencies { implementation name: 'lib', version: '1.0', group: "org.example" }      |
        | build.gradle.kts | dependencies { implementation("org.example:lib:1.0") }                                 |
        | build.gradle.kts | dependencies { implementation(group = "org.example", name = "lib", version = "1.0") }  |
        | build.gradle.kts | dependencies { implementation("""org.example:lib:1.0""") }                              |

    Scenario: GRDDEC-03 A classifier and an extension survive the update
      Given the file "app/build.gradle" contains
        """
        dependencies { runtimeOnly 'org.example:lib:1.0:tests@zip' }
        """
      And Gradle reports for ":app" the declared dependency "org.example:lib:1.0" in the configuration "runtimeOnly" with the classifier "tests" and the extension "zip"
      When ":app" is scanned
      Then the candidate's identifier is "org.example:lib"
      When the candidate is applied to the tree
      Then "app/build.gradle" contains 'org.example:lib:1.1:tests@zip'

    Scenario Outline: GRDDEC-04 The scope follows the configuration
      Given the file "app/build.gradle" contains
        """
        dependencies { <configuration> 'org.example:lib:1.0' }
        """
      And Gradle reports for ":app" the declared dependency "org.example:lib:1.0" in the configuration "<configuration>"
      When ":app" is scanned
      Then the candidate for "org.example:lib" has the scope "<scope>"

      Examples:
        | configuration                 | scope |
        | implementation                | prod  |
        | api                           | prod  |
        | compileOnly                   | prod  |
        | runtimeOnly                   | prod  |
        | annotationProcessor           | prod  |
        | testImplementation            | test  |
        | testRuntimeOnly               | test  |
        | integrationTestImplementation | test  |
        | androidTestImplementation     | test  |
        | testFixturesApi               | test  |

    Scenario: GRDDEC-05 Dependencies that are not external modules with a version are not subjects
      Given the file "app/build.gradle" contains
        """
        dependencies {
            implementation project(':lib')
            implementation files('libs/x.jar')
            implementation 'org.springframework:spring-core'
        }
        """
      And Gradle reports for ":app" the declared dependencies
        | configuration  | dependency                      |
        | implementation | project :lib                    |
        | implementation | files libs/x.jar                |
        | implementation | org.springframework:spring-core |
      When ":app" is scanned
      Then no candidate is offered
      And nothing is listed as skipped
      And the repositories are not asked about "org.springframework:spring-core"

    Scenario: GRDDEC-06 A dependency without a group is listed as not offered
      Given Gradle reports for ":app" the declared dependencies
        | configuration  | dependency  |
        | implementation | :legacy:1.0 |
      When ":app" is scanned
      Then no candidate is offered
      And the skipped dependency is "legacy" with the origin "public", the reason "invalid-name" and the detail "no group"
      And the repositories are not asked about "legacy"

    Scenario: GRDDEC-07 A coordinate in several configurations is one candidate and every declaration changes
      Given the file "app/build.gradle" contains
        """
        dependencies {
            implementation 'org.example:lib:1.0'
            testImplementation 'org.example:lib:1.0'
        }
        """
      And Gradle reports for ":app" the declared dependencies
        | configuration      | dependency          |
        | implementation     | org.example:lib:1.0 |
        | testImplementation | org.example:lib:1.0 |
      When ":app" is scanned
      Then exactly one candidate is offered for "org.example:lib" and its scope is "prod"
      When the candidate is applied to the tree
      Then both literals in "app/build.gradle" read '1.1'

    Scenario: GRDDEC-08 Declarations with different versions follow the main configuration
      Given the file "app/build.gradle" contains
        """
        dependencies {
            testImplementation 'org.example:lib:1.0'
            implementation 'org.example:lib:1.1'
        }
        """
      And Gradle reports for ":app" the declared dependencies
        | configuration      | dependency          |
        | testImplementation | org.example:lib:1.0 |
        | implementation     | org.example:lib:1.1 |
      And the repositories hold the versions "1.0", "1.1" and "1.2" of "org.example:lib"
      When ":app" is scanned
      Then exactly one candidate is offered for "org.example:lib"
      And its current range is "1.1", its new range is "1.2" and its scope is "prod"
      When the candidate is applied to the tree
      Then both literals in "app/build.gradle" read '1.2'

    Scenario Outline: GRDDEC-09 Platforms, enforced platforms and constraints are offered
      Given the file "app/build.gradle" contains
        """
        dependencies {
            <declaration>
        }
        """
      And Gradle reports for ":app" the declared dependency "org.example:bom:1.0" in the configuration "implementation" with the flag "<flag>"
      When ":app" is scanned
      Then the candidate for "org.example:bom" has the declaration kind "<kind>"

      Examples:
        | declaration                                                           | flag              | kind                  |
        | implementation platform('org.example:bom:1.0')                        | platform          | dependency            |
        | implementation enforcedPlatform('org.example:bom:1.0')                | enforced-platform | dependency            |
        | constraints { implementation('org.example:bom:1.0') { because 'x' } } | constraint        | dependency-management |

    Scenario: GRDDEC-10 A coordinate declared as dependency and as constraint is one candidate with two locations
      Given the file "app/build.gradle" contains
        """
        dependencies {
            implementation 'org.example:lib:1.0'
            constraints { implementation 'org.example:lib:1.0' }
        }
        """
      And Gradle reports for ":app" the declared dependencies
        | configuration  | dependency          | flags      |
        | implementation | org.example:lib:1.0 |            |
        | implementation | org.example:lib:1.0 | constraint |
      When ":app" is scanned
      Then exactly one candidate is offered for "org.example:lib"
      When the candidate is applied to the tree
      Then both literals in "app/build.gradle" read '1.1'

    Scenario: GRDDEC-11 Classpath dependencies of a buildscript block are plugin-scoped
      Given the file "app/build.gradle" contains
        """
        buildscript {
            dependencies { classpath 'org.example:gradle-plugin:1.0' }
        }
        """
      And Gradle reports for ":app" no declared dependencies
      And Gradle reports for ":app" the buildscript dependency "org.example:gradle-plugin:1.0"
      When ":app" is scanned
      Then the candidate for "org.example:gradle-plugin" has the scope "plugin" and the declaration kind "dependency"

    Scenario: GRDDEC-12 A dependency declared for all subprojects is found in the parent's script
      Given the file "build.gradle" contains
        """
        subprojects { dependencies { testImplementation 'org.example:lib:1.0' } }
        """
      And the file "app/build.gradle" contains
        """
        plugins { id 'java' }
        """
      And Gradle reports for ":app" the declared dependency "org.example:lib:1.0" in the configuration "testImplementation"
      When ":app" is scanned
      Then the candidate for "org.example:lib" has its declaration in "build.gradle"
      And its scope is "test"

  Rule: A version written as a name is searched where the name is defined

    The value of the name must be a single string literal in one of these forms
    and exactly the version Gradle reports:

      | Where                | Forms                                                                                                                |
      | gradle.properties    | `jacksonVersion=2.15.0` `jacksonVersion = 2.15.0`                                                                    |
      | Groovy script        | `def v = '1.0'` `String v = '1.0'` `final String v = '1.0'` `ext.v = '1.0'` `project.ext.v = '1.0'` `ext { v = '1.0' }` |
      | Kotlin script        | `val v = "1.0"` `var v = "1.0"` `val v: String = "1.0"` `extra["v"] = "1.0"` `val v by extra("1.0")`                |

    gradle.properties is searched first in the directory of the module, then in
    the root directory of its build (Gradle reads both and the module's wins,
    fact 33); script values in the module's script, then in the scripts of the
    parent projects, nearest first. A name that is defined twice at the same
    level is ambiguous.

    Scenario: GRDDEC-13 A version from the gradle.properties of the build
      Given the tree contains
        """
        gradle.properties              jacksonVersion=1.0
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation "org.example:lib:$jacksonVersion" }
        """
      When ":app" is scanned
      Then the candidate for "org.example:lib" has its declaration in "gradle.properties" with the kind "property" and the property "jacksonVersion"
      When the candidate is applied to the tree
      Then "gradle.properties" contains "jacksonVersion=1.1"
      And "app/build.gradle" is byte-for-byte unchanged

    Scenario: GRDDEC-14 The gradle.properties of the module wins over the one of the build
      Given the tree contains
        """
        gradle.properties              v=0.9
        app/
          gradle.properties            v=1.0
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation "org.example:lib:${v}" }
        """
      When ":app" is scanned
      Then the candidate for "org.example:lib" has its declaration in "app/gradle.properties"

    Scenario Outline: GRDDEC-15 A variable or ext value of the script is found
      Given the file "app/<file>" contains
        """
        <definition>
        <reference>
        """
      When ":app" is scanned
      Then the candidate for "org.example:lib" has the declaration kind "property" and the property "v"
      When the candidate is applied to the tree
      Then the first line of "app/<file>" is the definition with "1.0" replaced by "1.1"
      And the second line is unchanged

      Examples:
        | file             | definition             | reference                                                                          |
        | build.gradle     | def v = '1.0'          | dependencies { implementation "org.example:lib:$v" }                               |
        | build.gradle     | String v = '1.0'       | dependencies { implementation "org.example:lib:${v}" }                             |
        | build.gradle     | ext.v = '1.0'          | dependencies { implementation "org.example:lib:$v" }                               |
        | build.gradle     | ext { v = '1.0' }      | dependencies { implementation "org.example:lib:$v" }                               |
        | build.gradle     | def v = '1.0'          | dependencies { implementation group: 'org.example', name: 'lib', version: v }     |
        | build.gradle.kts | val v = "1.0"          | dependencies { implementation("org.example:lib:$v") }                              |
        | build.gradle.kts | val v: String = "1.0"  | dependencies { implementation("org.example:lib:${v}") }                            |
        | build.gradle.kts | extra["v"] = "1.0"     | dependencies { implementation("org.example:lib:$v") }                              |
        | build.gradle.kts | val v by extra("1.0")  | dependencies { implementation("org.example:lib:$v") }                              |

    Scenario: GRDDEC-16 A name defined in the script of a parent project is found
      Given the file "build.gradle" contains
        """
        ext { v = '1.0' }
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation "org.example:lib:$v" }
        """
      When ":app" is scanned
      Then the candidate for "org.example:lib" has its declaration in "build.gradle" with the kind "property" and the property "v"

    Scenario: GRDDEC-17 The nearest definition wins
      Given the file "build.gradle" contains
        """
        ext { v = '0.9' }
        """
      And the file "app/build.gradle" contains
        """
        ext { v = '1.0' }
        dependencies { implementation "org.example:lib:$v" }
        """
      When ":app" is scanned
      Then the candidate for "org.example:lib" has its declaration in "app/build.gradle"

    Scenario: GRDDEC-18 A name shared by several dependencies is shown and written once
      Given the tree contains
        """
        gradle.properties              jacksonVersion=1.0
        """
      And the file "app/build.gradle" contains
        """
        dependencies {
            implementation "org.example:core:$jacksonVersion"
            implementation "org.example:databind:$jacksonVersion"
        }
        """
      And Gradle reports for ":app" the declared dependencies
        | configuration  | dependency               |
        | implementation | org.example:core:1.0     |
        | implementation | org.example:databind:1.0 |
      When ":app" is scanned
      Then the candidate for "org.example:core" is shared with "org.example:databind"
      And the candidate for "org.example:databind" is shared with "org.example:core"
      When both candidates are applied to the tree
      Then "gradle.properties" contains "jacksonVersion=1.1" exactly once

    Scenario: GRDDEC-19 Candidates that share a name must agree on the target
      Given the tree of scenario GRDDEC-18
      And the repositories hold the versions "1.0" and "1.2" of "org.example:databind"
      When both candidates are applied to the tree
      Then it fails with an InstallError
      And the message is
        """
        org.example:databind and org.example:core share the property $jacksonVersion in gradle.properties but target different versions (1.2 vs 1.1).
        """
      And no file of the tree is changed

    Scenario Outline: GRDDEC-20 A name without a plain definition is listed as not offered
      Given the file "app/build.gradle" contains
        """
        <definition>
        dependencies { implementation "org.example:lib:$v" }
        """
      When ":app" is scanned
      Then no candidate is offered
      And the skipped dependency is "org.example:lib" with the origin "public", the reason "declaration-mismatch" and the detail "no definition of 'v' in gradle.properties or in the build scripts of ':app' and its parent projects"
      And the repositories are not asked about "org.example:lib"

      Examples:
        | definition                    |
        |                               |
        | ext { v = computeVersion() }  |
        | ext { v = "1.${minor}" }      |
        | def v = '1.' + '0'            |

    Scenario: GRDDEC-21 A value that Gradle overrides is not edited
      Given the tree contains
        """
        gradle.properties              v=0.9
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation "org.example:lib:$v" }
        """
      When ":app" is scanned
      Then no candidate is offered
      And the skipped dependency is "org.example:lib" with the reason "declaration-mismatch" and the detail "'v' is 0.9 in gradle.properties but Gradle uses 1.0 (command line or user-level override?)"

    Scenario: GRDDEC-22 A name defined twice at the same level is ambiguous
      Given the file "app/build.gradle" contains
        """
        def v = '1.0'
        ext.v = '1.0'
        dependencies { implementation "org.example:lib:$v" }
        """
      When ":app" is scanned
      Then no candidate is offered
      And the skipped dependency is "org.example:lib" with the reason "declaration-mismatch" and the detail "'v' is defined twice in app/build.gradle"

  Rule: Plugin versions are declared in the plugins block, a parent script or the settings

    Gradle reports each `plugins { id '<id>' version '<v>' }` as the marker
    dependency `<id>:<id>.gradle.plugin:<v>`, also when the version is
    declared in a parent project or in `pluginManagement { plugins { } }` of
    the settings file (fact 10). The candidate's identifier is the plugin id,
    its coordinate has the group <id> and the artifact `<id>.gradle.plugin`,
    its scope is "plugin" and its declaration kind is "plugin". The settings
    file is searched after the scripts (step 2).

    Scenario Outline: GRDDEC-23 The plugins block of both DSLs is recognised
      Given the file "app/<file>" contains
        """
        <line>
        """
      And Gradle reports for ":app" no declared dependencies
      And Gradle reports for ":app" the plugin "org.example.plugin" at version "1.0"
      When ":app" is scanned
      Then exactly one candidate is offered for "org.example.plugin"
      And its identifier is "org.example.plugin", its scope is "plugin" and its declaration kind is "plugin"
      When the candidate is applied to the tree
      Then "app/<file>" differs from the original only in the text "1.0" being replaced by "1.1"

      Examples:
        | file             | line                                                       |
        | build.gradle     | plugins { id 'org.example.plugin' version '1.0' }           |
        | build.gradle     | plugins { id("org.example.plugin") version("1.0") }         |
        | build.gradle.kts | plugins { id("org.example.plugin") version "1.0" }          |

    Scenario: GRDDEC-24 A Kotlin plugin shorthand stands for its full id
      Given the file "app/build.gradle.kts" contains
        """
        plugins { kotlin("jvm") version "1.0" }
        """
      And Gradle reports for ":app" no declared dependencies
      And Gradle reports for ":app" the plugin "org.jetbrains.kotlin.jvm" at version "1.0"
      When ":app" is scanned
      Then the candidate for "org.jetbrains.kotlin.jvm" has its declaration in "app/build.gradle.kts"

    Scenario: GRDDEC-25 A plugin version declared in the parent script is found from the module
      Given the file "build.gradle" contains
        """
        plugins { id 'org.example.plugin' version '1.0' apply false }
        """
      And the file "app/build.gradle" contains
        """
        plugins { id 'org.example.plugin' }
        """
      And Gradle reports for ":app" no declared dependencies
      And Gradle reports for ":app" the plugin "org.example.plugin" at version "1.0"
      When ":app" is scanned
      Then the candidate for "org.example.plugin" has its declaration in "build.gradle"

    Scenario: GRDDEC-26 A plugin version declared in pluginManagement of the settings is found
      Given the tree contains
        """
        settings.gradle                pluginManagement { plugins { id 'org.example.plugin' version '1.0' } }; include 'app'
        """
      And the file "app/build.gradle" contains
        """
        plugins { id 'org.example.plugin' }
        """
      And Gradle reports for ":app" no declared dependencies
      And Gradle reports for ":app" the plugin "org.example.plugin" at version "1.0"
      When ":app" is scanned
      Then the candidate for "org.example.plugin" has its declaration in "settings.gradle"

    Scenario: GRDDEC-27 Plugins without a version, and plugins of the settings file, are not subjects
      Given the file "app/build.gradle" contains
        """
        plugins { id 'java'; id 'org.example.versionless' }
        """
      And Gradle reports for ":app" no declared dependencies
      And Gradle describes the settings plugin "org.example.settings" at version "1.0" for the build
      When ":app" is scanned
      Then no candidate is offered
      And nothing is listed as skipped

  Rule: What is not a plain version is listed, never rewritten

    Scenario Outline: GRDDEC-28 Dynamic versions are the declaration, not a version
      Given the file "app/build.gradle" contains
        """
        dependencies { implementation 'org.example:lib:<version>' }
        """
      And Gradle reports for ":app" the declared dependency "org.example:lib:<version>" in the configuration "implementation"
      When ":app" is scanned
      Then no candidate is offered
      And the skipped dependency is "org.example:lib" with the origin "public", the reason "version-constraint" and the detail "dynamic version '<version>'"
      And the repositories are not asked about "org.example:lib"

      Examples:
        | version          |
        | 1.+              |
        | +                |
        | 1.0.+            |
        | latest.release   |
        | latest.integration |
        | [1.0,2.0)        |
        | (1.0,]           |
        | ]1.0,2.0]        |

    Scenario Outline: GRDDEC-29 A version with strictly, reject or prefer is not edited
      Given the file "app/build.gradle" contains
        """
        dependencies { implementation('org.example:lib:1.0') { version { <rule> } } }
        """
      And Gradle reports for ":app" the declared dependency "org.example:lib:1.0" in the configuration "implementation" with the flag "<flag>"
      When ":app" is scanned
      Then no candidate is offered
      And the skipped dependency is "org.example:lib" with the reason "version-constraint" and the detail "<detail>"

      Examples:
        | rule             | flag          | detail         |
        | strictly '1.0'   | strictly=1.0  | strictly '1.0' |
        | reject '1.1'     | reject=1.1    | reject '1.1'   |
        | prefer '1.0'     | prefer=1.0    | prefer '1.0'   |

    Scenario Outline: GRDDEC-30 A version that is computed is listed as not offered
      Given the file "app/build.gradle" contains
        """
        <line>
        """
      When ":app" is scanned
      Then no candidate is offered
      And the skipped dependency is "org.example:lib" with the origin "public", the reason "declaration-mismatch" and the detail "no declaration of org.example:lib:1.0 found in app/build.gradle or in the build scripts of its parent projects"
      And the repositories are not asked about "org.example:lib"

      Examples:
        | line                                                                |
        | dependencies { implementation "org.example:lib:${versions.lib}" }   |
        | dependencies { implementation "org.example:lib:${project.version}" }|
        | dependencies { implementation "org.example:lib:$v-jre" }            |
        | dependencies { implementation "org.example:lib:" + lib() }          |
        | dependencies { implementation(libraries.lib) }                       |

    Scenario: GRDDEC-31 A version that only a convention plugin declares is listed as not offered
      Given the tree contains
        """
        buildSrc/
          src/
            main/
              groovy/
                conventions.gradle     dependencies { implementation 'org.example:lib:1.0' }
        """
      And the file "app/build.gradle" contains
        """
        plugins { id 'conventions' }
        """
      When ":app" is scanned
      Then no candidate is offered
      And the skipped dependency is "org.example:lib" with the reason "declaration-mismatch" and the detail "no declaration of org.example:lib:1.0 found in app/build.gradle or in the build scripts of its parent projects"

    Scenario: GRDDEC-32 A literal in a comment is not a declaration
      Given the file "app/build.gradle" contains
        """
        // dependencies { implementation 'org.example:lib:1.0' }
        /* implementation 'org.example:lib:1.0' */
        dependencies { implementation 'org.example:lib:1.0' }
        """
      When ":app" is scanned
      And the candidate is applied to the tree
      Then only the third line of "app/build.gradle" changes

    Scenario: GRDDEC-33 A rule that names the same coordinate and version moves along
      Given the file "app/build.gradle" contains
        """
        dependencies { implementation 'org.example:lib:1.0' }
        configurations.all { resolutionStrategy { force 'org.example:lib:1.0' } }
        """
      When ":app" is scanned
      And the candidate is applied to the tree
      Then both literals read '1.1'

  Rule: Only the version text changes

    Scenario Outline: GRDDEC-34 Layout, quotes and line endings are preserved
      Given the file "app/build.gradle" is written with <style>
        """
        // header
        dependencies {
            implementation 'org.example:lib:1.0'   // keep
        }
        """
      When ":app" is scanned
      And the candidate is applied to the tree
      Then the file differs from the original only in the text "1.0" being replaced by "1.1"

      Examples:
        | style                                             |
        | tabs and LF line endings                          |
        | spaces and CRLF line endings and a final line break |
        | a byte order mark and no final line break         |

    Scenario: GRDDEC-35 A file that changed since the scan is not overwritten
      Given the file "app/build.gradle" contains
        """
        dependencies { implementation 'org.example:lib:1.0' }
        """
      And ":app" was scanned
      And the file "app/build.gradle" is then changed to
        """
        dependencies { implementation 'org.example:lib:1.0.1' }
        """
      When the candidate is applied to the tree
      Then it fails with an InstallError whose message starts with "app/build.gradle: "
      And the message contains "changed since it was scanned"
      And "app/build.gradle" is byte-for-byte what the second step wrote

    Scenario: GRDDEC-36 Every edit is computed before the first file is written
      Given the tree contains
        """
        gradle.properties              v=1.0
        """
      And the file "app/build.gradle" contains
        """
        dependencies {
            implementation "org.example:lib:$v"
            implementation 'org.example:other:1.0'
        }
        """
      And Gradle reports for ":app" the declared dependencies
        | configuration  | dependency            |
        | implementation | org.example:lib:1.0   |
        | implementation | org.example:other:1.0 |
      And ":app" was scanned
      And the file "app/build.gradle" is then changed so that it no longer contains "org.example:other:1.0"
      When both candidates are applied to the tree
      Then it fails with an InstallError
      And "gradle.properties" is byte-for-byte unchanged

  Rule: What a candidate says about where its version is written

    Scenario Outline: GRDDEC-37 The JSON of the command line and of the MCP server names the declaration
      Given a candidate whose version is written <where>
      When the candidate is converted to JSON
      Then "declaredIn" is <json>

      Examples:
        | where                                              | json                                                                                              |
        | in the build script of ":app"                      | {"file": "app/build.gradle", "kind": "dependency"}                                                |
        | in a constraint of the build script of ":app"      | {"file": "app/build.gradle", "kind": "dependency-management"}                                     |
        | in the property jacksonVersion of gradle.properties | {"file": "gradle.properties", "kind": "property", "property": "jacksonVersion"}                  |
        | in the plugins block of the build script of ":app" | {"file": "app/build.gradle", "kind": "plugin"}                                                    |
        | in the version "guava" of the catalog "libs"       | {"file": "gradle/libs.versions.toml", "kind": "catalog", "catalog": "libs", "entry": "versions.guava"} |

    Scenario: GRDDEC-38 A candidate with several locations lists the others
      Given the candidate of scenario GRDDEC-10
      When the candidate is converted to JSON
      Then "declaredIn" is {"file": "app/build.gradle", "kind": "dependency"}
      And "alsoDeclaredIn" is [{"file": "app/build.gradle", "kind": "dependency-management"}]

    Scenario: GRDDEC-39 The scan output names the file when it is not the build script of the module
      Given the candidates for "org.example:a" in "app/build.gradle", "org.example:b" in the property jacksonVersion of "gradle.properties" and "org.example:c" in the version "guava" of "gradle/libs.versions.toml"
      When "elevate scan --ecosystem=gradle" prints the module ":app"
      Then the lines of the candidates are
        """
           • [MINOR]   org.example:a                        1.0          ➔ 1.1
           • [MINOR]   org.example:b                        1.0          ➔ 1.1  (in gradle.properties ${jacksonVersion})
           • [MINOR]   org.example:c                        1.0          ➔ 1.1  (in gradle/libs.versions.toml versions.guava)
        """

    Scenario: GRDDEC-40 The new reason is explained in both languages
      The skip reasons of specs/05, 07 and 09 keep their texts; Gradle adds
      "version-constraint". The exhaustive switches over `SkipReason` in
      `describeSkip` and in `Translations.list.skipReason` make the compiler
      enforce that all three places know it.

      Given a skipped dependency "org.example:lib" with the reason "version-constraint" and the detail "dynamic version '1.+'"
      Then the English description for the command line and the MCP server is "version is a selector or constraint, not a plain version (dynamic version '1.+')"
      And the label of the dashboard in English is "version is a selector or constraint, not a plain version"
      And the label of the dashboard in German is "Version ist ein Selektor oder eine Einschränkung, keine feste Version"

  Rule: Version catalogs: the entries of gradle/libs.versions.toml

    Gradle reads `gradle/libs.versions.toml` of a build as the catalog "libs"
    and exposes its entries as `libs.<alias>`. A dependency that comes from it
    is flagged by Gradle (fact 16), also inside `platform(...)` and for the
    members of a bundle. Elevate reads the file as TOML and matches the
    dependency to an entry by coordinates: the entry whose `module` (or
    `group` and `name`) is the dependency's group and name and whose effective
    version, after resolving `version.ref`, is exactly the version Gradle
    reports. The entry is offered only because a scanned module uses it. The
    forms of an entry:

      | Entry                                                            | Where the version text is                       |
      | `guava = { module = "g:a", version.ref = "guava" }`             | the `[versions]` key `guava`                    |
      | `guava = { module = "g:a", version = { ref = "guava" } }`       | the `[versions]` key `guava`                    |
      | `guava = { group = "g", name = "a", version = "1.0" }`          | the entry itself                                |
      | `guava = "g:a:1.0"`                                              | the entry itself (the part after the last colon) |
      | `[versions]` `guava = "1.0"` or `guava = { require = "1.0" }`   | the string                                      |
      | `[plugins]` `p = { id = "x", version.ref = "k" }` and the same forms with `version = "1.0"` or `"x:1.0"` | like a library |

    Entries with `strictly`, `prefer` or `reject`, or without a version, are
    not offered (the first are listed as "version-constraint"). Bundles hold
    aliases only; their members are offered as libraries. Only
    `gradle/libs.versions.toml` in the directory of the build is read: other
    catalogs, declared in the settings with `versionCatalogs { }`, are not.
    Included builds have their own file.

    Scenario: GRDCAT-01 A library whose version is a reference is offered at the version entry
      Given the file "gradle/libs.versions.toml" contains
        """
        [versions]
        guava = "1.0"

        [libraries]
        guava = { module = "org.example:guava", version.ref = "guava" }
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation libs.guava }
        """
      And Gradle reports for ":app" the declared dependency "org.example:guava:1.0" in the configuration "implementation" from the catalog
      When ":app" is scanned
      Then exactly one candidate is offered for "org.example:guava"
      And its declaration is the catalog "libs" in "gradle/libs.versions.toml" with the entry "versions.guava"
      When the candidate is applied to the tree
      Then "gradle/libs.versions.toml" differs from the original only in the text "1.0" being replaced by "1.1"

    Scenario Outline: GRDCAT-02 The other forms of a library entry are recognised
      Given the file "gradle/libs.versions.toml" contains
        """
        [versions]
        other = "9.9"

        [libraries]
        <entry>
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation libs.lib }
        """
      And Gradle reports for ":app" the declared dependency "org.example:lib:1.0" in the configuration "implementation" from the catalog
      When ":app" is scanned
      Then the candidate for "org.example:lib" has the catalog entry "<entry id>"
      When the candidate is applied to the tree
      Then "gradle/libs.versions.toml" differs from the original only in the text "1.0" being replaced by "1.1"

      Examples:
        | entry                                                                      | entry id      |
        | lib = { module = "org.example:lib", version = "1.0" }                      | libraries.lib |
        | lib = { group = "org.example", name = "lib", version = "1.0" }             | libraries.lib |
        | lib = "org.example:lib:1.0"                                                | libraries.lib |
        | lib = { module = "org.example:lib", version = { require = "1.0" } }        | libraries.lib |

    Scenario: GRDCAT-03 A version entry in the rich form with require is offered
      Given the file "gradle/libs.versions.toml" contains
        """
        [versions]
        lib = { require = "1.0" }

        [libraries]
        lib = { module = "org.example:lib", version.ref = "lib" }
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation libs.lib }
        """
      And Gradle reports for ":app" the declared dependency "org.example:lib:1.0" in the configuration "implementation" from the catalog
      When ":app" is scanned
      Then the candidate for "org.example:lib" has the catalog entry "versions.lib"

    Scenario Outline: GRDCAT-04 Entries with strictly, prefer or reject are listed as not offered
      Given the file "gradle/libs.versions.toml" contains
        """
        [versions]
        lib = { <rule> }

        [libraries]
        lib = { module = "org.example:lib", version.ref = "lib" }
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation libs.lib }
        """
      And Gradle reports for ":app" the declared dependency "org.example:lib:1.0" in the configuration "implementation" from the catalog with the flag "<flag>"
      When ":app" is scanned
      Then no candidate is offered
      And the skipped dependency is "org.example:lib" with the reason "version-constraint" and the detail "<detail>"

      Examples:
        | rule                      | flag         | detail         |
        | strictly = "1.0"          | strictly=1.0 | strictly '1.0' |
        | require = "1.0", reject = ["1.1"] | reject=1.1 | reject '1.1' |

    Scenario: GRDCAT-05 Members of a bundle are offered as libraries
      Given the file "gradle/libs.versions.toml" contains
        """
        [libraries]
        a = "org.example:a:1.0"
        b = "org.example:b:1.0"

        [bundles]
        both = ["a", "b"]
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation libs.bundles.both }
        """
      And Gradle reports for ":app" the declared dependencies
        | configuration  | dependency          | flags   |
        | implementation | org.example:a:1.0   | catalog |
        | implementation | org.example:b:1.0   | catalog |
      When ":app" is scanned
      Then candidates are offered for "org.example:a" and "org.example:b"
      And their declarations are the entries "libraries.a" and "libraries.b"

    Scenario: GRDCAT-06 A library without a version is no subject
      Given the file "gradle/libs.versions.toml" contains
        """
        [libraries]
        managed = { module = "org.example:managed" }
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation libs.managed }
        """
      And Gradle reports for ":app" the declared dependency "org.example:managed" in the configuration "implementation" from the catalog
      When ":app" is scanned
      Then no candidate is offered
      And nothing is listed as skipped

    Scenario: GRDCAT-07 A version entry that several libraries refer to is shown and written once
      Given the file "gradle/libs.versions.toml" contains
        """
        [versions]
        slf4j = "1.0"

        [libraries]
        api = { module = "org.example:slf4j-api", version.ref = "slf4j" }
        simple = { module = "org.example:slf4j-simple", version.ref = "slf4j" }
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation libs.api; implementation libs.simple }
        """
      And Gradle reports for ":app" the declared dependencies
        | configuration  | dependency                  | flags   |
        | implementation | org.example:slf4j-api:1.0    | catalog |
        | implementation | org.example:slf4j-simple:1.0 | catalog |
      When ":app" is scanned
      Then the candidate for "org.example:slf4j-api" is shared with "org.example:slf4j-simple"
      And the candidate for "org.example:slf4j-simple" is shared with "org.example:slf4j-api"
      When both candidates are applied to the tree
      Then "gradle/libs.versions.toml" contains the version "1.1" exactly once

    Scenario: GRDCAT-08 An entry that no scanned module uses is not offered
      Given the file "gradle/libs.versions.toml" contains
        """
        [libraries]
        unused = "org.example:unused:1.0"
        """
      And the file "app/build.gradle" contains
        """
        plugins { id 'java' }
        """
      And Gradle reports for ":app" no declared dependencies
      When ":app" is scanned
      Then no candidate is offered
      And nothing is listed as skipped
      And the repositories are not asked about "org.example:unused"

    Scenario: GRDCAT-09 Two modules that use the same entry both offer it
      Given the file "gradle/libs.versions.toml" contains
        """
        [libraries]
        lib = "org.example:lib:1.0"
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation libs.lib }
        """
      And the file "build.gradle" contains
        """
        dependencies { implementation libs.lib }
        """
      And Gradle reports for ":" and for ":app" the declared dependency "org.example:lib:1.0" in the configuration "implementation" from the catalog
      When ":" and ":app" are scanned
      Then each of them offers one candidate for "org.example:lib" with the declaration "libraries.lib"

    Scenario: GRDCAT-10 A literal and a catalog entry for the same coordinate both change
      Given the file "gradle/libs.versions.toml" contains
        """
        [libraries]
        lib = "org.example:lib:1.0"
        """
      And the file "app/build.gradle" contains
        """
        dependencies {
            implementation libs.lib
            testImplementation 'org.example:lib:1.0'
        }
        """
      And Gradle reports for ":app" the declared dependencies
        | configuration      | dependency          | flags   |
        | implementation     | org.example:lib:1.0 | catalog |
        | testImplementation | org.example:lib:1.0 |         |
      When ":app" is scanned
      Then exactly one candidate is offered for "org.example:lib"
      When the candidate is applied to the tree
      Then "gradle/libs.versions.toml" and "app/build.gradle" both read '1.1' where they read '1.0'

    Scenario: GRDCAT-11 Two entries with the same coordinate and version are ambiguous
      Given the file "gradle/libs.versions.toml" contains
        """
        [libraries]
        lib = "org.example:lib:1.0"
        lib-again = { module = "org.example:lib", version = "1.0" }
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation libs.lib }
        """
      And Gradle reports for ":app" the declared dependency "org.example:lib:1.0" in the configuration "implementation" from the catalog
      When ":app" is scanned
      Then no candidate is offered
      And the skipped dependency is "org.example:lib" with the reason "declaration-mismatch" and the detail "2 entries of gradle/libs.versions.toml declare org.example:lib:1.0: lib, lib-again"

    Scenario: GRDCAT-12 A catalog that is not gradle/libs.versions.toml is not read
      Given the tree contains no file "gradle/libs.versions.toml"
      And the file "app/build.gradle" contains
        """
        dependencies { implementation libs.lib }
        """
      And Gradle reports for ":app" the declared dependency "org.example:lib:1.0" in the configuration "implementation" from the catalog
      When ":app" is scanned
      Then no candidate is offered
      And the skipped dependency is "org.example:lib" with the reason "declaration-mismatch" and the detail "no entry for org.example:lib:1.0 in gradle/libs.versions.toml (other catalogs are not read)"

    Scenario: GRDCAT-13 An included build has its own catalog
      Given Gradle describes the included build "build-logic" in "build-logic"
      And the file "build-logic/gradle/libs.versions.toml" contains
        """
        [libraries]
        lib = "org.example:lib:1.0"
        """
      And the file "gradle/libs.versions.toml" contains
        """
        [libraries]
        lib = "org.example:lib:0.9"
        """
      And Gradle reports for ":build-logic" the declared dependency "org.example:lib:1.0" in the configuration "implementation" from the catalog
      When ":build-logic" is scanned
      Then the candidate for "org.example:lib" has its declaration in "build-logic/gradle/libs.versions.toml"

    Scenario: GRDCAT-14 A version accessor inside a string is resolved to the version entry
      Given the file "gradle/libs.versions.toml" contains
        """
        [versions]
        lib = "1.0"
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation "org.example:lib:${libs.versions.lib.get()}" }
        """
      When ":app" is scanned
      Then the candidate for "org.example:lib" has its declaration in "gradle/libs.versions.toml" with the entry "versions.lib"

    Scenario Outline: GRDCAT-15 Plugin entries are offered
      Given the file "gradle/libs.versions.toml" contains
        """
        [versions]
        retry = "1.0"

        [plugins]
        <entry>
        """
      And the file "app/build.gradle" contains
        """
        plugins { alias(libs.plugins.retry) }
        """
      And Gradle reports for ":app" no declared dependencies
      And Gradle reports for ":app" the plugin "org.example.retry" at version "1.0"
      When ":app" is scanned
      Then the candidate for "org.example.retry" has the scope "plugin" and the catalog entry "<entry id>"

      Examples:
        | entry                                                          | entry id      |
        | retry = { id = "org.example.retry", version.ref = "retry" }    | versions.retry |
        | retry = { id = "org.example.retry", version = "1.0" }          | plugins.retry |
        | retry = "org.example.retry:1.0"                                | plugins.retry |

    Scenario Outline: GRDCAT-16 Comments, spacing and order of the catalog are untouched
      Given the file "gradle/libs.versions.toml" is written with <style>
        """
        # versions of the build
        [versions]
        lib   = "1.0"   # keep me
        other = "2.0"

        [libraries]
        lib = { module = "org.example:lib", version.ref = "lib" }
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation libs.lib }
        """
      And Gradle reports for ":app" the declared dependency "org.example:lib:1.0" in the configuration "implementation" from the catalog
      When ":app" is scanned
      And the candidate is applied to the tree
      Then "gradle/libs.versions.toml" differs from the original only in the text "1.0" being replaced by "1.1"

      Examples:
        | style                                                |
        | LF line endings                                      |
        | CRLF line endings and a final line break             |
        | a byte order mark and no final line break            |

    Scenario: GRDCAT-17 A catalog that changed since the scan is not overwritten
      Given the file "gradle/libs.versions.toml" contains
        """
        [libraries]
        lib = "org.example:lib:1.0"
        """
      And the file "app/build.gradle" contains
        """
        dependencies { implementation libs.lib }
        """
      And Gradle reports for ":app" the declared dependency "org.example:lib:1.0" in the configuration "implementation" from the catalog
      And ":app" was scanned
      And the file "gradle/libs.versions.toml" is then changed to
        """
        [libraries]
        lib = "org.example:lib:1.0.1"
        """
      When the candidate is applied to the tree
      Then it fails with an InstallError whose message starts with "gradle/libs.versions.toml: "
      And the message contains "changed since it was scanned"

    @integration
    Scenario: GRDCAT-18 A real Gradle uses the version that was written to the catalog
      Given Gradle is installed
      And a copy of the fixture "gradle-catalog" whose repository is a local file repository holding "org.example:lib" in 1.0 and 1.1
      When ":app" is scanned and the offered candidate is applied with the update workflow
      Then the summary is not rolled back and its verification status is "clean"
      And "gradle/libs.versions.toml" reads "1.1" where it read "1.0"
      And a real Gradle resolves "org.example:lib" to 1.1 in ":app"
