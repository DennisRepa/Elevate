Feature: Gradle as an ecosystem
  Elevate manages Gradle builds as a third ecosystem next to npm and Maven:
  the value "gradle" of `--ecosystem`, of the MCP parameter and of the
  dashboard toggle, displayed as "🐘 Java / Gradle". A Gradle repository can
  live next to Maven and npm projects; each ecosystem lists its own modules.

  A Gradle build file is a program, not a manifest. Its settings file may
  compute which projects exist (`file('plugins').eachDir { include … }`),
  `gradle.properties`, `ext` values, version catalogs, convention plugins and
  command-line properties decide which versions apply, and the repositories
  come from settings, build scripts and init scripts. Parsing the files would
  be a guess. Elevate therefore asks Gradle, as it asks Maven for the
  effective POM, and uses the build files only to find where a version is
  written (specs/16). It asks with two runs of the build's own Gradle:

    | Run      | Question                                                      | Answer                      |
    | describe | which builds, projects, declared dependencies, repositories   | one JSON document per build |
    | lookup   | which versions of these coordinates do the repositories hold  | one JSON document per build |

  Both runs use a small init script that Elevate carries (`-I`); the answer is
  written to a file, never parsed from the console. The protocol is fixed in
  specs/README.md ("The probe protocol"). These are the commands Elevate runs,
  all with the directory of the Gradle build as working directory; <gradle> is
  the wrapper of the repository (`sh ./gradlew`, on Windows `.\gradlew.bat`) or
  `gradle` on the PATH (GRD-35 to GRD-38):

    | Purpose                  | Command                                                                                                                                      | Timeout |
    | Is gradle usable?        | gradle --version (only when the repository has no wrapper)                                                                                   | 30 s    |
    | Describe the build       | <gradle> -q -m --console=plain --no-configuration-cache -Delevate.mode=describe -Delevate.outDir=<out> -I <script> help                      | 5 min   |
    | Look up versions         | <gradle> -q -m --console=plain --no-configuration-cache -Delevate.mode=lookup -Delevate.plan=<plan> -Delevate.outDir=<out> -I <script> help  | 5 min   |
    | Refresh dependency locks | <gradle> -q --console=plain --no-configuration-cache <project>:dependencies … --update-locks <group:name,…> (specs/18)                       | 10 min  |
    | Default verification     | <gradle> -q --console=plain <project>:testClasses … (specs/18)                                                                               | 30 min  |

  <out>, <plan> and <script> are paths below `.gradle/elevate-<8 hex digits>/`
  of the build directory, named relative to the working directory with the
  platform's separators. The directory is Elevate's scratch space: it is
  removed when the run ends, whatever the outcome. `--no-configuration-cache`
  is required: with `org.gradle.configuration-cache=true` Gradle reuses its
  cache on the second run and then does not run the init script at all (fact 7
  in specs/README.md).

  Scanning several modules shares the runs: one describe run and one lookup
  run per Gradle build, however many modules are requested (`scanMany`, like
  Maven's). The runs use Gradle as the project configured it, daemon
  included; Elevate passes neither `--daemon` nor `--no-daemon`. A cold daemon
  costs several seconds, every further run about a second (fact 28).

  Out of scope in this version, each with its reason (specs/README.md,
  "Gradle: scope and non-goals"): updating the Gradle Wrapper itself, Android
  and Kotlin Multiplatform builds, regenerating `verification-metadata.xml`,
  Gradle older than 7.6, and everything that could not be verified (listed as
  UNVERIFIED in specs/README.md).

  Rule: Gradle is the third ecosystem

    Scenario Outline: GRD-01 The command line accepts gradle as an ecosystem
      When the arguments "<arguments>" are parsed
      Then the ecosystem option is "gradle"

      Examples:
        | arguments                         |
        | scan --ecosystem=gradle           |
        | scan -e gradle                    |
        | modules --ecosystem gradle --json |
        | update --ecosystem=gradle --all   |

    Scenario: GRD-02 An unknown ecosystem is still ignored
      When the arguments "scan --ecosystem=ant" are parsed
      Then no ecosystem option is set

    Scenario: GRD-03 The factory knows the Gradle strategy
      When the ecosystem factory is asked for its available ecosystems
      Then they are "npm", "maven" and "gradle", in this order
      When the factory creates the strategy for "gradle"
      Then its ecosystem is "gradle", its display name is "Java / Gradle" and its icon is "🐘"
      And its manifest file is "build.gradle"

    Scenario Outline: GRD-04 The dashboard cycles through the ecosystems
      When the next ecosystem after "<current>" is requested
      Then it is "<next>"
      And the header hint of the dashboard is "[E] <hint>"

      Examples:
        | current | next   | hint             |
        | npm     | maven  | ☕ Java / Maven   |
        | maven   | gradle | 🐘 Java / Gradle  |
        | gradle  | npm    | 📦 Node / npm     |

    Scenario: GRD-05 The MCP tools offer gradle
      When the tools of the MCP server are listed
      Then the "ecosystem" property of each of the five tools has the values "npm", "maven" and "gradle"
      And its description is "Target ecosystem (default: npm)"

    Scenario Outline: GRD-06 Gradle shares the coordinate handling of Maven
      Gradle names a library `group:name`, like Maven names it
      `groupId:artifactId`, and its versions look the same. Everything that
      treats Maven coordinates specially treats Gradle coordinates the same way.

      When <operation>
      Then <result>

      Examples:
        | operation                                                                                | result                                                     |
        | "isJvmEcosystem" is asked for "gradle"                                                   | it is true                                                 |
        | "isJvmEcosystem" is asked for "npm"                                                      | it is false                                                |
        | the coordinate of the identifier "com.acme:lib" is built for "gradle"                    | its group is "com.acme" and its artifact is "lib"          |
        | "com.acme.billing:core" is matched against the internal scopes "com.acme" for "gradle"   | it matches                                                 |
        | "com.acmecorp:core" is matched against the internal scopes "com.acme" for "gradle"       | it does not match                                          |
        | the version "5.10.2" is chosen by hand for a "gradle" candidate at "5.9.0"               | its new range is "5.10.2" and its diff is "minor"          |

    Scenario: GRD-07 A version query chooses its ecosystem as before
      When "elevate versions org.slf4j:slf4j-api" runs without an ecosystem option
      Then the Maven strategy answers
      When "elevate versions org.slf4j:slf4j-api --ecosystem=gradle" runs
      Then the Gradle strategy answers
      And an identifier without a colon, such as "org.springframework.boot", is a plugin id for the Gradle strategy

  Rule: The repository root of a Gradle repository

    The root detection of specs/01 is extended by a proposal of the Gradle
    ecosystem; the explicit `elevate.config.json`, the checkout boundary and
    "the outermost proposal wins" are unchanged. Gradle proposes a root from
    the start directory like this:

      1. D is the nearest directory, from the start directory upwards to the
         boundary, that contains `settings.gradle` or `settings.gradle.kts`
         (Gradle itself uses the nearest settings file, fact 14). When there
         is none, D is the start directory if it contains `build.gradle` or
         `build.gradle.kts`; otherwise Gradle proposes nothing.
      2. When D is called `buildSrc` and its parent directory, within the
         boundary, has a settings file, D becomes that parent.
      3. As long as a strict ancestor of D within the boundary has a settings
         file that includes D with `includeBuild`, D becomes the nearest such
         ancestor. A settings file includes D when, outside comments, it
         contains `includeBuild` followed by an optional `(` and a string
         literal (single or double quotes) that, resolved against the
         directory of that settings file, is D. Paths that are computed
         (`file(…)`, string concatenation, variables) are not recognised.

    Scenario: GRD-08 A subproject resolves to the root of its build
      Given the tree
        """
        settings.gradle                include 'app', 'lib'
        app/
          build.gradle                 plugins { id 'java' }
        lib/
          build.gradle                 plugins { id 'java-library' }
        """
      When the root is detected from "app"
      Then the root is the top directory of the tree

    Scenario: GRD-09 The Kotlin DSL settings file counts too
      Given the tree
        """
        settings.gradle.kts            include("app")
        app/
          build.gradle.kts             plugins { java }
        """
      When the root is detected from "app"
      Then the root is the top directory of the tree

    Scenario: GRD-10 A nested build with its own settings file is its own root
      Given the tree
        """
        settings.gradle                include 'app'
        app/
          build.gradle                 plugins { id 'java' }
        tools/
          settings.gradle              rootProject.name = 'tools'
          build.gradle                 plugins { id 'java' }
        """
      When the root is detected from "tools"
      Then the root is "tools"

    Scenario Outline: GRD-11 An included build resolves to the build that includes it
      Given the tree
        """
        settings.gradle                <settings>
        app/
          build.gradle                 plugins { id 'java' }
        build-logic/
          settings.gradle              rootProject.name = 'build-logic'
          build.gradle                 plugins { id 'groovy-gradle-plugin' }
        """
      When the root is detected from "build-logic"
      Then the root is <root>

      Examples:
        | settings                                          | root                          |
        | include 'app'; includeBuild 'build-logic'         | the top directory of the tree |
        | include("app"); includeBuild("build-logic")       | the top directory of the tree |
        | include 'app'; includeBuild('./build-logic')      | the top directory of the tree |
        | pluginManagement { includeBuild("build-logic") }  | the top directory of the tree |
        | include 'app'; includeBuild(file("build-logic"))  | "build-logic"                 |
        | def n = 'build-logic'; includeBuild(n)            | "build-logic"                 |
        | include 'app'; includeBuild("build-" + "logic")   | "build-logic"                 |
        | include 'app'; // includeBuild("build-logic")     | "build-logic"                 |
        | include 'app'; /* includeBuild('build-logic') */  | "build-logic"                 |
        | include 'app'                                     | "build-logic"                 |

    Scenario: GRD-12 Chains of included builds are climbed to the outermost
      Given the tree
        """
        settings.gradle                includeBuild 'platform'
        platform/
          settings.gradle              includeBuild 'conventions'
          conventions/
            settings.gradle            rootProject.name = 'conventions'
        """
      When the root is detected from "platform/conventions"
      Then the root is the top directory of the tree

    Scenario: GRD-13 The buildSrc directory belongs to the build around it
      Given the tree
        """
        settings.gradle                include 'app'
        app/
          build.gradle                 plugins { id 'java' }
        buildSrc/
          settings.gradle              rootProject.name = 'buildSrc'
          build.gradle                 plugins { id 'groovy' }
          src/
            main/
              groovy/
        """
      When the root is detected from "buildSrc/src/main"
      Then the root is the top directory of the tree

    Scenario: GRD-14 A build script without any settings file is its own root
      Given the tree
        """
        build.gradle                   plugins { id 'java' }
        sample/
          build.gradle                 plugins { id 'java' }
        """
      When the root is detected from "sample"
      Then the root is "sample"

    Scenario: GRD-15 Settings files above the checkout are ignored
      Given the tree
        """
        settings.gradle                include 'checkout:app'
        checkout/
          .git/HEAD
          app/
            build.gradle               plugins { id 'java' }
        """
      And the top directory of the tree has no ".git" entry
      When the root is detected from "checkout/app"
      Then the root is "checkout/app"

    Scenario: GRD-16 The outermost proposal wins when another ecosystem proposes a higher root
      Given the tree
        """
        package.json                   {"name": "mono", "workspaces": ["web"]}
        backend/
          settings.gradle              include 'service'
          service/
            build.gradle               plugins { id 'java' }
        """
      When the root is detected from "backend/service"
      Then the root is the top directory of the tree

    Scenario: GRD-17 A directory without Gradle markers gets no Gradle proposal
      Given the tree
        """
        docs/
          readme.md
        """
      When the root is detected from "docs"
      Then the Gradle ecosystem proposes no root
      And the root is "docs"

  Rule: The Gradle builds of a repository are found without running Gradle

    `discover(rootDir)` first collects the directories of Gradle builds by
    walking the tree, then asks Gradle about each of them. A directory is a
    build directory when it contains a settings file, or when it contains
    `build.gradle` or `build.gradle.kts` and neither it nor any ancestor up to
    the repository root contains a settings file (a one-project build). The
    walk starts at the repository root, is at most six levels deep and does not
    enter:

      * directories whose name starts with "." or is node_modules, target,
        build, dist or out;
      * `buildSrc` (Gradle reports it, GRD-26);
      * `src` directories whose parent contains a settings file or a build
        script: the source tree of a project, which holds fixtures and sample
        projects (like specs/03 DISC-01 and DISC-02).

    A build directory below another build directory is described in its own run
    unless the outer build includes it (its description lists it, GRD-24).

    Scenario: GRD-18 A multi-project build is one build directory
      Given the tree
        """
        settings.gradle                include 'app', 'lib'
        app/
          build.gradle                 plugins { id 'java' }
        lib/
          build.gradle                 plugins { id 'java-library' }
        """
      When the build directories are collected from the top directory of the tree
      Then they are exactly the top directory of the tree
      And no process is started

    Scenario: GRD-19 Independent builds without a common settings file are separate build directories
      Given the tree
        """
        services/
          billing/
            settings.gradle            rootProject.name = 'billing'
          shipping/
            settings.gradle.kts        rootProject.name = "shipping"
        """
      When the build directories are collected from the top directory of the tree
      Then they are "services/billing" and "services/shipping"

    Scenario: GRD-20 A lone build script without settings is a build directory
      Given the tree
        """
        tool/
          build.gradle.kts             plugins { java }
        """
      When the build directories are collected from the top directory of the tree
      Then they are exactly "tool"

    Scenario: GRD-21 Fixture and sample builds inside a source tree are not builds
      Given the tree
        """
        settings.gradle                include 'plugin'
        plugin/
          build.gradle                 plugins { id 'java-gradle-plugin' }
          src/
            functionalTest/
              fixtures/
                sample/
                  settings.gradle      rootProject.name = 'sample'
        """
      When the build directories are collected from the top directory of the tree
      Then they are exactly the top directory of the tree

    Scenario Outline: GRD-22 Build output and dependency directories are not walked
      Given the tree
        """
        settings.gradle                rootProject.name = 'app'
        <directory>/
          leftover/
            settings.gradle            rootProject.name = 'leftover'
        """
      When the build directories are collected from the top directory of the tree
      Then they are exactly the top directory of the tree

      Examples:
        | directory    |
        | node_modules |
        | build        |
        | target       |
        | dist         |
        | out          |
        | .gradle      |
        | .git         |

    Scenario: GRD-23 A directory named src that is not a project's source tree is walked
      Given the tree
        """
        src/
          backend/
            settings.gradle            rootProject.name = 'backend'
        """
      And the top directory of the tree contains no settings file and no build script
      When the build directories are collected from the top directory of the tree
      Then they are exactly "src/backend"

    Scenario: GRD-24 A build that an outer build includes is described once, by the outer build
      Given the tree
        """
        settings.gradle                includeBuild 'tools'
        tools/
          settings.gradle              rootProject.name = 'tools'
          build.gradle                 plugins { id 'java-library' }
        """
      And Gradle describes the build "root" in "."
      And Gradle describes the included build "tools" in "tools"
      When Gradle modules are discovered from the top directory of the tree
      Then exactly one describe run is started and its working directory is the top directory of the tree
      And the modules include one with the id ":tools"

    Scenario: GRD-25 A nested build that no outer build includes is described in its own run
      Given the tree
        """
        settings.gradle                include 'app'
        app/
          build.gradle                 plugins { id 'java' }
        examples/
          demo/
            settings.gradle            rootProject.name = 'demo'
            build.gradle               plugins { id 'java' }
        """
      And Gradle describes the build "root" in "." with the projects
        | path | dir | build file       | group | version |
        | :    | .   | -                |       |         |
        | :app | app | app/build.gradle |       |         |
      And in the run in "examples/demo" Gradle describes the build "demo" in "examples/demo"
      When Gradle modules are discovered from the top directory of the tree
      Then two describe runs are started, with the top directory and with "examples/demo" as working directory
      And the module ids are ":", ":app" and ":demo"

    Scenario: GRD-26 buildSrc is described by Gradle, not found by the walk
      Given the tree
        """
        settings.gradle                include 'app'
        buildSrc/
          build.gradle                 plugins { id 'groovy' }
        """
      When the build directories are collected from the top directory of the tree
      Then they are exactly the top directory of the tree

  Rule: Gradle's description of the build decides which projects are modules

    A module is the root project of every build and every project that has a
    build script (`build.gradle` or `build.gradle.kts`). Directories that
    Gradle makes projects without a build script (such as `:libs` in
    `include 'libs:core'`) are not modules. The fields of a module:

      | Field       | Value                                                                                                   |
      | id          | the Gradle path of the project: ":" for the root project, ":app", ":libs:core" in the primary build; in every other build (an included build, buildSrc, an independent build in a subdirectory) the name of the build comes first: ":build-logic", ":build-logic:conventions", ":buildSrc", ":demo". The primary build is the one whose directory is the repository root. An id that is already taken gets "@" and the relPath appended |
      | name        | the project's name; for the root project of a build the name of the build (`rootProject.name`)          |
      | path        | the absolute project directory, as Gradle reports it                                                    |
      | relPath     | the project directory relative to the repository root, forward slashes; "Root" for the repository root itself |
      | isRoot      | true for the root project of the build in the repository root directory                                 |
      | version     | the project's version, unless Gradle reports "unspecified" or nothing                                   |
      | buildDir    | the absolute directory Gradle is run in for this module: the directory of the root build that contains it |
      | buildRoot   | the absolute directory of the build the project belongs to; equal to buildDir except for the projects of an included build or of buildSrc |
      | buildKind   | "root" (the build Gradle was started in), "included" or "buildSrc"                                      |
      | coordinates | "group:name" when the project has a group                                                               |

    The root project of the repository comes first, the others are sorted by
    relPath like the modules of the other ecosystems. The ecosystem of every
    module is "gradle".

    Background:
      Given Gradle itself is replaced by a test double that answers describe runs with the builds given below

    Scenario: GRD-27 Projects with a build script are modules
      Given Gradle describes the build "mono" in "." with the projects
        | path       | dir       | build file                 | group    | version |
        | :          | .         | build.gradle               | com.acme | 1.0.0   |
        | :app       | app       | app/build.gradle           | com.acme | 1.0.0   |
        | :libs      | libs      | -                          | com.acme | 1.0.0   |
        | :libs:core | libs/core | libs/core/build.gradle.kts | com.acme | 1.0.0   |
      When Gradle modules are discovered from the top directory of the tree
      Then the modules are, in this order
        | id         | name | relPath   | isRoot | version | buildKind | coordinates   |
        | :          | mono | Root      | yes    | 1.0.0   | root      | com.acme:mono |
        | :app       | app  | app       | no     | 1.0.0   | root      | com.acme:app  |
        | :libs:core | core | libs/core | no     | 1.0.0   | root      | com.acme:core |
      And every module has the ecosystem "gradle"

    Scenario: GRD-28 The directory of a project comes from Gradle, not from its path
      Given Gradle describes the build "mono" in "." with the projects
        | path | dir            | build file                  | group | version |
        | :    | .              | -                           |       |         |
        | :api | modules/api-v2 | modules/api-v2/build.gradle |       |         |
      When Gradle modules are discovered from the top directory of the tree
      Then the module ":api" has the relPath "modules/api-v2"

    Scenario: GRD-29 The root project is a module even without a build script
      Given Gradle describes the build "mono" in "." with the projects
        | path | dir | build file | group | version     |
        | :    | .   | -          |       | unspecified |
      When Gradle modules are discovered from the top directory of the tree
      Then the only module is ":" named "mono" with the relPath "Root"
      And it has no version and no coordinates

    Scenario Outline: GRD-30 An unspecified version is no version
      Given Gradle describes the build "mono" in "." with the projects
        | path | dir | build file   | group   | version   |
        | :    | .   | build.gradle | <group> | <version> |
      When Gradle modules are discovered from the top directory of the tree
      Then the module ":" has the version <shown> and the coordinates <coordinates>

      Examples:
        | group    | version     | shown      | coordinates     |
        | com.acme | 2.1.0       | "2.1.0"    | "com.acme:mono" |
        | com.acme | unspecified | no version | "com.acme:mono" |
        |          | 2.1.0       | "2.1.0"    | none            |
        |          |             | no version | none            |

    Scenario: GRD-31 Included builds and buildSrc contribute their projects
      Given Gradle describes the build "mono" in "." with the projects
        | path | dir | build file   | group    | version |
        | :    | .   | build.gradle | com.acme | 1.0.0   |
      And Gradle describes the included build "build-logic" in "build-logic" with the projects
        | path | dir         | build file                   | group          | version |
        | :    | build-logic | build-logic/build.gradle.kts | com.acme.logic | 0.5.0   |
      And Gradle describes buildSrc in "buildSrc" with the projects
        | path | dir      | build file            | group | version     |
        | :    | buildSrc | buildSrc/build.gradle |       | unspecified |
      When Gradle modules are discovered from the top directory of the tree
      Then the modules are, in this order
        | id           | name        | relPath     | buildKind | buildDir | buildRoot   | coordinates                |
        | :            | mono        | Root        | root      | .        | .           | com.acme:mono              |
        | :build-logic | build-logic | build-logic | included  | .        | build-logic | com.acme.logic:build-logic |
        | :buildSrc    | buildSrc    | buildSrc    | buildSrc  | .        | buildSrc    |                            |

    Scenario: GRD-32 An included build outside the repository is not a module
      Given Gradle describes the build "mono" in "." with the projects
        | path | dir | build file   | group | version |
        | :    | .   | build.gradle |       |         |
      And Gradle describes the included build "ext-lib" in "../ext-lib" with the projects
        | path | dir        | build file              | group   | version |
        | :    | ../ext-lib | ../ext-lib/build.gradle | org.ext | 7.0     |
      When Gradle modules are discovered from the top directory of the tree
      Then the only module is ":"

    Scenario: GRD-33 Gradle older than 7.6 is refused
      Given Gradle reports the version "6.9.4" in its description
      When Gradle modules are discovered from the top directory of the tree
      Then it fails with a GradleVersionError
      And the message is
        """
        Gradle 6.9.4 is not supported: Elevate needs Gradle 7.6 or newer (checked with 7.6.6, 8.14.3 and 9.8.1).
        """

    Scenario: GRD-34 A repository without a Gradle build has no modules and starts no process
      Given the tree
        """
        pom.xml                        g:app:1, no parent
        """
      When Gradle modules are discovered from the top directory of the tree
      Then there are no modules
      And no process is started

  Rule: Elevate runs the Gradle the project uses

    The wrapper closest to the working directory is used, searching upwards
    but never above the repository root. It pins the Gradle version the
    project is built with, like the Maven Wrapper does. A wrapper on POSIX is
    started as `sh ./gradlew` (the executable bit may be lost in a checkout),
    named relative to the working directory; on Windows `.\gradlew.bat`
    through the command shell, with the argument safety of specs/06. Without a
    wrapper `gradle` from the PATH is used, after one `gradle --version`
    (30 seconds) per process.

    Background:
      Given Gradle itself is replaced by a test double that answers describe runs with the builds given below

    Scenario: GRD-35 The wrapper of the repository is preferred
      Given the tree
        """
        settings.gradle                include 'app'
        gradlew
        gradlew.bat
        gradle/wrapper/gradle-wrapper.properties
        app/
          build.gradle                 plugins { id 'java' }
        """
      And `gradle` is also on the PATH
      When the build in the top directory of the tree is described
      Then the command is the wrapper, addressed as "./gradlew" on POSIX and ".\gradlew.bat" on Windows
      And `gradle --version` was not started

    Scenario: GRD-36 A wrapper above the repository root is not used
      Given the tree
        """
        gradlew
        repo/
          .git/HEAD
          settings.gradle              rootProject.name = 'repo'
        """
      And the repository root is "repo"
      And `gradle` is not on the PATH
      When the build in "repo" is described
      Then it fails with a GradleUnavailableError

    Scenario: GRD-37 Without a wrapper gradle on the PATH is used and checked once
      Given the tree
        """
        settings.gradle                rootProject.name = 'app'
        """
      And `gradle --version` succeeds
      When the build in the top directory of the tree is described twice
      Then both runs use the command "gradle"
      And `gradle --version` was started exactly once

    Scenario Outline: GRD-38 Gradle is not usable
      Given the tree
        """
        settings.gradle                rootProject.name = 'app'
        """
      And `gradle --version` <behaviour>
      When the build in the top directory of the tree is described
      Then it fails with a GradleUnavailableError
      And the message is
        """
        <message>
        """

      Examples:
        | behaviour                                                                                                                           | message                                                                                              |
        | cannot be started (the program does not exist)                                                                                      | Gradle is not available: no Gradle Wrapper (gradlew) in the repository and no `gradle` on the PATH.  |
        | exits with code 1 and prints "ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH." on the standard error | Gradle could not be started: ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH. |
        | does not answer within 30 seconds                                                                                                   | Gradle could not be started: gradle --version timed out.                                             |

    @posix
    Scenario: GRD-39 The describe run has exactly these arguments
      Given the tree
        """
        settings.gradle                rootProject.name = 'app'
        gradlew
        """
      When the build in the top directory of the tree is described
      Then the working directory of the run is the top directory of the tree
      And the command is "sh" with the first argument "./gradlew"
      And the other arguments are, in this order
        | argument                               |
        | -q                                     |
        | -m                                     |
        | --console=plain                        |
        | --no-configuration-cache               |
        | -Delevate.mode=describe                |
        | -Delevate.outDir=.gradle/elevate-<id>/out |
        | -I                                     |
        | .gradle/elevate-<id>/probe.init.gradle |
        | help                                   |
      And "<id>" is eight hexadecimal digits, the same in both places
      And the timeout of the run is 5 minutes

    Scenario: GRD-40 The scratch directory is Elevate's own and is removed afterwards
      Given the tree
        """
        settings.gradle                rootProject.name = 'app'
        gradlew
        """
      And the directory ".gradle" does not exist in the tree
      When the build in the top directory of the tree is described
      Then during the run the directory ".gradle/elevate-<id>" holds "probe.init.gradle"
      And after the run ".gradle/elevate-<id>" does not exist
      And Elevate removed nothing else
      When the build is described again and the run fails
      Then after the run ".gradle/elevate-<id>" does not exist

    Scenario: GRD-41 The directory the repository lives in never appears on the command line
      Given a Gradle repository in a directory whose path contains "R&D"
      And the process boundary is replaced by a test double that records every command and argument
      When the build in its top directory is described
      Then the working directory handed to the process is the top directory
      And neither the command nor any argument contains "R&D"

    Scenario: GRD-42 A failed run is reported with Gradle's own words
      The details are Gradle's standard error without the line "Picked up …"
      that every Java start prints when JAVA_TOOL_OPTIONS is set, cut before
      the line starting with "* Try:" and limited to the last 30 lines. When
      the standard error is empty the standard output is used instead.

      Given the tree
        """
        settings.gradle                rootProject.name = 'app'
        gradlew
        """
      And the describe run exits with code 1 and prints on the standard error
        """
        Picked up JAVA_TOOL_OPTIONS: -Xmx1g
        FAILURE: Build failed with an exception.

        * Where:
        Build file '/work/app/build.gradle' line: 2

        * What went wrong:
        Could not compile build file '/work/app/build.gradle'.

        * Try:
        > Run with --stacktrace option to get the stack trace.
        """
      When the build in the top directory of the tree is described
      Then it fails with a GradleCommandError
      And the message is
        """
        Gradle could not describe the build:
        FAILURE: Build failed with an exception.

        * Where:
        Build file '/work/app/build.gradle' line: 2

        * What went wrong:
        Could not compile build file '/work/app/build.gradle'.
        """

    Scenario: GRD-43 A missing JDK is reported as Gradle reports it
      Given the tree
        """
        settings.gradle                rootProject.name = 'app'
        gradlew
        """
      And the describe run exits with code 1 and prints on the standard error
        """

        ERROR: JAVA_HOME is set to an invalid directory: /opt/missing

        Please set the JAVA_HOME variable in your environment to match the
        location of your Java installation.
        """
      When the build in the top directory of the tree is described
      Then the message of the GradleCommandError contains "ERROR: JAVA_HOME is set to an invalid directory: /opt/missing"

    Scenario: GRD-44 A Gradle too old for the JDK is reported as it is
      Given the tree
        """
        settings.gradle                rootProject.name = 'app'
        gradlew
        """
      And the describe run exits with code 1 and prints on the standard error
        """
        FAILURE: Build failed with an exception.

        * What went wrong:
        Could not open settings generic class cache for settings file '/work/app/settings.gradle' (/home/dev/.gradle/caches/7.6.6/scripts/3barciagj5xj60syqa7gxq6no).
        > BUG! exception in phase 'semantic analysis' in source unit '_BuildScript_' Unsupported class file major version 65

        * Try:
        > Run with --stacktrace option to get the stack trace.
        """
      When the build in the top directory of the tree is described
      Then the message of the GradleCommandError contains "Unsupported class file major version 65"
      And it does not contain "Run with --stacktrace"

    Scenario: GRD-45 A wrapper that cannot download Gradle is named as such
      Given the tree
        """
        settings.gradle                rootProject.name = 'app'
        gradlew
        gradle/wrapper/gradle-wrapper.properties   distributionUrl=https\://downloads.gradle.org/distributions/gradle-8.14.3-bin.zip
        """
      And the describe run exits with code 1 and prints on the standard error
        """
        Exception in thread "main" java.io.IOException: Unable to tunnel through proxy. Proxy returns "HTTP/1.1 403 Forbidden"
        	at java.base/sun.net.www.protocol.http.HttpURLConnection.doTunneling0(HttpURLConnection.java:2326)
        	at org.gradle.wrapper.Install.forceFetch(SourceFile:2)
        	at org.gradle.wrapper.GradleWrapperMain.main(SourceFile:67)
        """
      When the build in the top directory of the tree is described
      Then it fails with a GradleCommandError
      And the message is
        """
        The Gradle Wrapper could not download Gradle from https://downloads.gradle.org/distributions/gradle-8.14.3-bin.zip: java.io.IOException: Unable to tunnel through proxy. Proxy returns "HTTP/1.1 403 Forbidden". Check the network connection, the proxy settings and the distributionUrl in gradle/wrapper/gradle-wrapper.properties.
        """

    Scenario: GRD-46 A describe run that does not finish is stopped and named
      Given the tree
        """
        settings.gradle                rootProject.name = 'app'
        gradlew
        """
      And the describe run does not finish within 5 minutes
      When the build in the top directory of the tree is described
      Then it fails with a GradleCommandError
      And the message is
        """
        Gradle timed out after 5 minutes while describing the build.
        """

    Scenario: GRD-47 A run that writes no description is an error, not an empty build
      Given the tree
        """
        settings.gradle                rootProject.name = 'app'
        gradlew
        """
      And the describe run exits with code 0 and writes no file
      When the build in the top directory of the tree is described
      Then it fails with a GradleCommandError
      And the message is
        """
        Gradle finished without describing the build, so Elevate cannot read its dependencies.
        """

    @integration
    Scenario: GRD-48 A real Gradle describes the fixture
      Given Gradle is installed
      And a copy of the fixture "gradle-composite", which uses core plugins only and needs no network
      When Gradle modules are discovered with real Gradle
      Then the modules are ":", ":app", ":libs:core", ":build-logic" and, with Gradle 8 or later, ":buildSrc"
      And the description of ":app" lists its declared dependencies with the groups, names and versions of its build script
      And the discovery leaves no file of Elevate behind in the fixture

  Rule: The modules are shown like those of the other ecosystems

    Scenario: GRD-49 The module listing names the ecosystem
      Given Gradle describes the build "mono" in "." with the projects
        | path | dir | build file       | group    | version |
        | :    | .   | build.gradle     | com.acme | 1.0.0   |
        | :app | app | app/build.gradle | com.acme | 1.0.0   |
      When "elevate modules --ecosystem=gradle" runs in the top directory of the tree
      Then the first line of the listing is "🪶 Discovered 🐘 Java / Gradle Modules (2):"
      And the listing has a line for "mono" with "(Root)" and "[ROOT]" and a line for "app" with "(app)"

    Scenario: GRD-50 The JSON listing carries the build of every module
      Given the build of scenario GRD-31
      When "elevate modules --ecosystem=gradle --json" runs in the top directory of the tree
      Then the output has "ecosystem": "gradle" and "count": 3
      And the module ":build-logic" has "buildKind": "included", "buildDir", "buildRoot" and "coordinates": "com.acme.logic:build-logic"

    Scenario: GRD-51 The MCP tool elevate_discover_modules reports the kind of the build
      Given the build of scenario GRD-31
      When the MCP tool "elevate_discover_modules" is called with the ecosystem "gradle"
      Then every module has "id", "name", "relPath", "isRoot", "version" and "buildKind"
      When the same tool is called with the ecosystem "npm"
      Then no module has "buildKind"

    Scenario: GRD-52 The dashboard tabs are named in the language of the user
      Given the active ecosystem is "gradle" and the scan found 12 candidates, 8 of scope "prod" and 4 of scope "test" or "plugin"
      Then the tab labels in English are "[1] All (12)", "[2] Main (8)" and "[3] Test & plugins (4)"
      And the tab labels in German are "[1] Alle (12)", "[2] Haupt (8)" and "[3] Test & Plugins (4)"

    Scenario: GRD-53 The mascot of a Gradle repository drinks coffee like the Maven one
      When the mascot is drawn for the ecosystem "gradle" in the idle state
      Then it shows the same face and chirps as for "maven"
