Feature: Special characters in paths on Windows
  On Windows, `npm`, `mvn` and the Maven Wrapper are batch files and can only
  be started through cmd.exe. cmd.exe interprets `" % ! ^ & | < >` even inside
  quotes, so Elevate refuses to put an argument containing one of them on a
  command line rather than risk running something else.

  That protection must not make Elevate unusable in an ordinary directory such
  as `C:\R&D\shop`. The working directory is handed to the process directly,
  never through the command line. Elevate therefore names the project's own
  files relative to the working directory, so the directory the repository
  lives in never appears in an argument.

  Rule: Files inside the working directory are named relative to it

    `relativeToCwd(cwd, file)` returns the path of `file` relative to `cwd`
    with the platform's separators. A file that cannot be expressed relative
    to `cwd` (another drive on Windows) is returned unchanged.

    Scenario Outline: WIN-06 Paths are made relative to the working directory
      Given the working directory "<cwd>"
      When the path "<file>" is prepared for the command line
      Then the argument is "<argument>"

      @windows
      Examples:
        | cwd             | file                                      | argument                        |
        | C:\R&D\shop     | C:\R&D\shop\pom.xml                       | pom.xml                         |
        | C:\R&D\shop\app | C:\R&D\shop\mvnw.cmd                      | ..\mvnw.cmd                     |
        | C:\R&D\shop     | C:\R&D\shop\target\.elevate-1a2b\out.xml  | target\.elevate-1a2b\out.xml    |
        | C:\R&D\shop     | D:\cache\pom.xml                          | D:\cache\pom.xml                |

      @posix
      Examples:
        | cwd              | file                                     | argument                        |
        | /work/R&D/shop   | /work/R&D/shop/pom.xml                   | pom.xml                         |
        | /work/R&D/shop/a | /work/R&D/shop/mvnw                      | ../mvnw                         |

    Scenario: WIN-01 Reading the effective POM does not put the project directory on the command line
      Given a Maven project in a directory whose path contains "R&D"
      And the process boundary is replaced by a test double that records every command and argument
      When the effective POM of the project is read with the project directory as working directory
      Then the working directory handed to the process is the project directory
      And the POM is passed as "-f" followed by "pom.xml"
      And the output file is passed as "-Doutput=" followed by a path relative to the project directory
      And neither the command nor any argument contains "R&D"

    Scenario: WIN-02 Looking up newer versions does not put the project directory on the command line
      Given a Maven project in a directory whose path contains "R&D"
      And the process boundary is replaced by a test double that records every command and argument
      When newer versions are looked up with the project directory as working directory
      Then the probe POM is passed as "-f" followed by a path relative to the project directory
      And neither the command nor any argument contains "R&D"

    Scenario: WIN-07 The Maven Wrapper is started by its relative path
      Given a repository in a directory whose path contains "R&D" with a Maven Wrapper in its top directory
      And a module directory "app" below it
      And the process boundary is replaced by a test double that records every command and argument
      When Maven is run with the module directory as working directory
      Then the wrapper is addressed as the path from the module directory to the wrapper file
      And neither the command nor any argument contains "R&D"

    @integration @windows
    Scenario: WIN-03 A Maven project below a directory named R&D can be scanned
      Given a copy of the fixture "maven-reactor" inside a directory named "R&D"
      And Maven is installed
      When the module "app" is scanned with real Maven
      Then the scan succeeds
      And a candidate is offered for "com.google.guava:guava"
      And the scan leaves no "target" directory behind in "app"

  Rule: An argument that is unsafe for cmd.exe is rejected with an explanation

    @windows
    Scenario: WIN-04 The message names the argument, the characters and a remedy
      Given the platform is Windows
      When a command is run with the argument "a&b"
      Then it fails with an UnsafeArgumentError
      And the message is
        """
        Cannot pass "a&b" to the Windows command shell: it contains one of the characters " % ! ^ & | < > or a line break, which cmd.exe would interpret. If this is part of a directory or file name, rename it or move the project to a path without these characters.
        """
      And no process is started

    Scenario: WIN-08 The message is the same on every platform
      When an UnsafeArgumentError is created for the argument "50%"
      Then its name is "UnsafeArgumentError"
      And its message starts with
        """
        Cannot pass "50%" to the Windows command shell:
        """

  Rule: Other platforms pass arguments without a shell and without restriction

    @posix
    Scenario: WIN-05 An argument with shell metacharacters reaches the program unchanged
      When the command "node" is run with the arguments "-e", "process.stdout.write(process.argv[1])" and "a&b|c"
      Then the exit code is 0
      And the output is "a&b|c"
