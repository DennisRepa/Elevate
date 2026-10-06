Feature: Versions of the Maven plugins Elevate runs
  Elevate asks Maven two questions and uses one plugin for each:

    | Key      | Plugin                                         | Used to                 | Default |
    | help     | org.apache.maven.plugins:maven-help-plugin     | read the effective POM  | 3.5.2   |
    | versions | org.codehaus.mojo:versions-maven-plugin        | look up newer versions  | 2.22.0  |

  The versions are pinned so results are reproducible. Which versions a
  company's repository manager offers differs from site to site; a pinned
  version that is not available there must be replaceable, and a missing
  plugin must be reported as what it is.

  Rule: The versions can be set per repository in elevate.config.json

    The setting is the object "mavenPlugins" with the optional keys "help" and
    "versions". A value is accepted when it is a string of 1 to 64 characters
    that starts with a digit and otherwise contains only letters, digits, "."
    and "-". Anything else is replaced by the default, with a warning:

      `mavenPlugins.<key>` is not a valid version (<value as JSON>); using the default <default>.

    Unknown keys inside "mavenPlugins" are ignored. A "mavenPlugins" value
    that is not an object is ignored without a warning.

    Scenario: PLUG-01 Without the setting the defaults apply
      Given an elevate.config.json with the content {}
      When the configuration is resolved
      Then the help plugin version is "3.5.2"
      And the versions plugin version is "2.22.0"
      And there are no warnings

    Scenario: PLUG-03 One key can be set on its own
      Given an elevate.config.json with the content {"mavenPlugins": {"versions": "2.16.2"}}
      When the configuration is resolved
      Then the help plugin version is "3.5.2"
      And the versions plugin version is "2.16.2"
      And there are no warnings

    Scenario Outline: PLUG-04 An invalid version is replaced by the default with a warning
      Given an elevate.config.json whose "mavenPlugins" is {"help": <value>}
      When the configuration is resolved
      Then the help plugin version is "3.5.2"
      And the warnings are exactly
        """
        `mavenPlugins.help` is not a valid version (<value>); using the default 3.5.2.
        """

      Examples:
        | value              |
        | ""                 |
        | "latest"           |
        | "RELEASE"          |
        | "3.4.0 & calc"     |
        | "3.4.0\"; rm -rf"  |
        | 3                  |
        | null               |
        | ["3.4.0"]          |

    Scenario: PLUG-09 A mavenPlugins value that is not an object is ignored
      Given an elevate.config.json with the content {"mavenPlugins": "2.16.2"}
      When the configuration is resolved
      Then the help plugin version is "3.5.2"
      And the versions plugin version is "2.22.0"
      And there are no warnings

  Rule: The configured versions are the ones Maven is asked to run

    Background:
      Given Maven itself is replaced by a test double that records its arguments

    Scenario: PLUG-02 A scan uses the configured versions
      Given the ecosystem factory is configured with the plugin versions help "3.4.0" and versions "2.16.2"
      And a Maven project with one dependency
      When the project is scanned with the Maven strategy from the factory
      Then Maven is asked to run the goal "org.apache.maven.plugins:maven-help-plugin:3.4.0:effective-pom"
      And Maven is asked to run the goal "org.codehaus.mojo:versions-maven-plugin:2.16.2:dependency-updates-report"

    Scenario: PLUG-08 A version query uses the configured versions
      Given the ecosystem factory is configured with the plugin versions help "3.4.0" and versions "2.16.2"
      And a directory with a pom.xml
      When all versions of "com.google.guava:guava" are requested through the Maven strategy from the factory
      Then Maven is asked to run the goal "org.apache.maven.plugins:maven-help-plugin:3.4.0:effective-pom"
      And Maven is asked to run the goal "org.codehaus.mojo:versions-maven-plugin:2.16.2:dependency-updates-report"

    Scenario: PLUG-10 An unconfigured factory uses the defaults
      Given the ecosystem factory is configured with no plugin versions
      And a Maven project with one dependency
      When the project is scanned with the Maven strategy from the factory
      Then Maven is asked to run the goal "org.apache.maven.plugins:maven-help-plugin:3.5.2:effective-pom"
      And Maven is asked to run the goal "org.codehaus.mojo:versions-maven-plugin:2.22.0:dependency-updates-report"

  Rule: A plugin that cannot be downloaded is reported as such

    A Maven run counts as "plugin unavailable" when it failed and a line of
    its output contains the plugin's "groupId:artifactId" together with one of
    (case-insensitive): "could not be resolved", "could not find artifact",
    "failed to read artifact descriptor", "could not transfer artifact".

    The error is a MavenPluginUnavailableError. Its message is, on one line,

      Maven could not download <groupId>:<artifactId>:<version>, which Elevate
      uses to <purpose>. Make this plugin available in the repository or mirror
      your Maven is configured with, or choose a version that is available
      there with "mavenPlugins": { "<key>": "<version>" } in elevate.config.json.

    followed by a line break and Maven's own error lines. The final
    `"<version>"` in the hint is the literal text `<version>`, a placeholder
    for the reader.

    Background:
      Given Maven itself is replaced by a test double

    Scenario: PLUG-05 The help plugin is missing from the mirror
      Given Maven fails with the output
        """
        [ERROR] Plugin org.apache.maven.plugins:maven-help-plugin:3.5.2 or one of its dependencies could not be resolved:
        [ERROR] 	The following artifacts could not be resolved: org.apache.maven.plugins:maven-help-plugin:pom:3.5.2 (absent): Could not find artifact org.apache.maven.plugins:maven-help-plugin:pom:3.5.2 in corp-mirror (https://nexus.corp.example/repository/maven-public/)
        [ERROR] -> [Help 1]
        """
      When the effective POM of a project is read
      Then it fails with a MavenPluginUnavailableError
      And the message starts with
        """
        Maven could not download org.apache.maven.plugins:maven-help-plugin:3.5.2, which Elevate uses to read the effective POM. Make this plugin available in the repository or mirror your Maven is configured with, or choose a version that is available there with "mavenPlugins": { "help": "<version>" } in elevate.config.json.
        """
      And the message contains "corp-mirror"

    Scenario: PLUG-06 The versions plugin is missing from the mirror
      Given the versions plugin version is "2.16.2"
      And Maven fails with the output
        """
        [ERROR] Failed to read artifact descriptor for org.codehaus.mojo:versions-maven-plugin:jar:2.16.2: Could not transfer artifact org.codehaus.mojo:versions-maven-plugin:pom:2.16.2 from/to corp-mirror (https://nexus.corp.example/repository/maven-public/): status code: 403
        """
      When newer versions are looked up
      Then it fails with a MavenPluginUnavailableError
      And the message starts with
        """
        Maven could not download org.codehaus.mojo:versions-maven-plugin:2.16.2, which Elevate uses to look up newer versions. Make this plugin available in the repository or mirror your Maven is configured with, or choose a version that is available there with "mavenPlugins": { "versions": "<version>" } in elevate.config.json.
        """

    Scenario: PLUG-07 Any other Maven failure keeps its own message
      Given Maven fails with the output
        """
        [ERROR] Non-resolvable parent POM for com.acme:app:1.0.0: Could not find artifact com.acme:parent:pom:9.9.9 in central (https://repo.maven.apache.org/maven2)
        """
      When the effective POM of a project is read
      Then it fails with a MavenCommandError that is not a MavenPluginUnavailableError
      And the message starts with "Maven could not build the effective POM:"
      And the message contains "Non-resolvable parent POM"
