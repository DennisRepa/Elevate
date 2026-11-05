# 🪶 Elevate — Deutsche Dokumentation

> **Interaktives Terminal-Dashboard (TUI) zur sicheren, selektiven und transparenten Aktualisierung von Abhängigkeiten in Polyglot-Monorepos.**  
> *Entwickelt und gepflegt von **Dennis Répa**.*

---

## 🌟 Übersicht

**Elevate** ist ein interaktives Terminal-Dashboard (TUI) zur sicheren, selektiven und transparenten Aktualisierung von Abhängigkeiten in **Polyglot-Monorepos** (Node/npm, Java/Maven, Rust/Cargo & Java/Gradle) sowie Einzelprojekten.

* **Feder-Symbolik (`🪶`) & Orange-Brand (`#FF8800`):** Leicht, modern und übersichtlich im Terminal.
* **Polyglot-Fähig:** Unterstützt gleichzeitig Frontend-Projekte (`package.json` mit npm Workspaces) und Backend-Projekte (`pom.xml` mit Maven, `build.gradle` mit Gradle, `Cargo.toml` mit Cargo).
* **Release Channels:** Filtert Vorabversionen (Beta, RC, Alpha, Milestone, Snapshot) standardmäßig heraus und schlägt ausschließlich produktionsreife Releases vor.
* **Animiertes Begleiter-Hühnchen („Pip“ 🐣):** Begleitet den Entwickler dezent im Terminal und reagiert auf Aktionen.
* **Bilinguales i18n:** Jederzeit umschaltbar zwischen Deutsch und Englisch via Taste **`[L]`**.

---

## ✨ Features & Highlights

1. **🌐 Polyglot Monorepo Support (npm, pnpm, Maven, Cargo & Gradle):**
   * **Node / npm:** Löst Workspaces genau wie npm auf (inklusive Glob-Mustern wie `packages/**`), berechnet SemVer-Diffs, aktualisiert `package.json`, führt `npm install` aus und prüft das Lockfile.
   * **Node / pnpm** (9 – 12): Dasselbe für pnpm-Repositories — Workspaces aus `pnpm-workspace.yaml`, das `workspace:`-Protokoll, `catalog:`-Einträge, `pnpm install` und eine Lockfile-Prüfung. Repositories mit Yarn oder Bun werden abgelehnt.
   * **Java / Maven:** Findet jede `pom.xml` (auch die Root-POM), lässt Maven die Effective POM berechnen, sucht neuere Versionen über die Repositories des Builds (Mirrors, Nexus/Artifactory, Zugangsdaten aus der `settings.xml`) und prüft die betroffenen Module mit `mvn test-compile`.
   * **Java / Gradle:** Findet die Builds des Repositories (Groovy- und Kotlin-DSL, Included Builds, `buildSrc`), fragt Gradle selbst, welche Abhängigkeiten gelten, sucht neuere Versionen über die Repositories des Builds (Mirrors, Nexus/Artifactory, Zugangsdaten), schreibt jede neue Version dorthin, wo ihr Text steht — Build-Skripte, `gradle.properties`, `ext`-Werte, der Version Catalog `gradle/libs.versions.toml`, der `plugins`-Block —, frischt Dependency Locks auf und prüft die betroffenen Projekte mit `testClasses`.
   * **Live-Wechsel:** Ein Tastendruck auf **`[E]`** schaltet im laufenden Betrieb zwischen Node/npm-, Java/Maven-, Rust/Cargo- und Java/Gradle-Modulen um.

2. **🔍 Version gezielt heraussuchen (`[V]`):**
   * Man muss nicht zwingend auf die `latest` Version aktualisieren: Taste **`[V]`** öffnet ein interaktives Such-Modal für das aktuell ausgewählte Paket.
   * Lädt alle jemals veröffentlichten Versionen aus der npm- oder Maven-Registry.
   * Ermöglicht Echtzeit-Filterung während des Tippens (z. B. `3.2` oder `25`), Pfeiltasten-Navigation und Übernahme mit `Enter`.
   * Manuell ausgewählte Versionen werden im Dashboard mit einem `[MANUELL]`-Badge hervorgehoben.

3. **🚦 Release Channels (`stable` vs. `all`):**
   * **`channel: "stable"` (Standard):** Verhindert das unabsichtliche Installieren instabiler Vorabversionen (`-alpha`, `-beta`, `-rc`, `-m1`, `-snapshot`).
   * **`channel: "all"`:** Zeigt alle Versionen an und hebt Vorabversionen mit farbigen Warn-Badges (`[BETA]`, `[RC]`, `[ALPHA]`) in Magenta hervor.

4. **🏢 Interne Abhängigkeiten (Workspace-Module & private Registries):**
   * Workspace-Module, die voneinander abhängen, werden an ihre lokale Version angeglichen (`[Angleichen]`).
   * Interne Pakete (`internalScopes`, z. B. `@my-org/*`, `com.mycompany.*`) werden nur in privaten Registries abgefragt, nie in einer öffentlichen.
   * Details im Abschnitt [Interne Abhängigkeiten & Sicherheit](#-interne-abhängigkeiten--sicherheit).

5. **🐣 Das animierte Hühnchen („Pip“):**
   * Sitzt unten rechts im Dashboard.
   * Reagiert auf den Status:
     * *Idle:* Blinzelt sanft oder schlürft im Java-Modus Kaffee (`*kaffee schlürf* ☕`).
     * *Scan:* Sucht neugierig mit Lupe (`( ˘ө˘ )🔍`).
     * *Build:* Arbeitet emsig (`(ง •ө• )ง`).
     * *Erfolg:* Feiert das Update mit Konfetti (`\( ᵔөᵔ )/ 🎉`).

6. **🚀 Englischer Initial-Splash-Screen:**
   * Ein stylischer Startbildschirm mit animiertem Ladebalken (~3,2 Sekunden).
   * Kann jederzeit mit der `[Leertaste]` oder `[Enter]` sofort übersprungen werden.

---

## 🏢 Interne Abhängigkeiten & Sicherheit

Jede Abhängigkeit erhält eine **Herkunft**, bevor eine Registry kontaktiert wird:

| Herkunft | Erkannt an | Versionsquelle | Aktion |
| :--- | :--- | :--- | :--- |
| `workspace` | Ein Modul dieses Repositorys | Die **lokale** Version des Moduls | `align` (angleichen) |
| `private` | `internalScopes` oder eine explizite Zuordnung `@scope:registry` in der `.npmrc` | Die dafür konfigurierte private Registry | `update` |
| `public` | Alles andere | Die konfigurierte Registry | `update` |

Die URL der Registry allein entscheidet bewusst **nicht** über die Herkunft: In den meisten Unternehmen läuft jede Anfrage — auch für öffentliche Pakete — über einen Artifactory- oder Nexus-Proxy.

### Workspace-Module angleichen

* **npm:** Schließt der Versionsbereich einer Abhängigkeit die lokale Version eines Workspace-Pakets nicht ein, verlinkt npm das Workspace **nicht**, sondern installiert ein gleichnamiges Paket aus der Registry. Elevate bietet an, den Bereich anzugleichen (z. B. `^1.0.0` ➔ `^2.0.0`). Nach `npm install` prüft es die `package-lock.json`: Jede angeglichene Abhängigkeit muss `"link": true` sein, sonst wird das Update zurückgenommen. Bereiche, die npm immer verlinkt (`*`, `file:`, `workspace:`), bleiben unberührt.
* **pnpm:** pnpm verlinkt ein Workspace-Paket nur, wenn die Abhängigkeit mit dem `workspace:`-Protokoll geschrieben ist; ein einfacher Bereich wie `^1.0.0` wird aus der Registry aufgelöst — auch wenn die lokale Version ihn erfüllt. Elevate gleicht deshalb `workspace:^1.2.0` ➔ `workspace:^2.0.0` an (Protokoll und Präfix bleiben; `workspace:*`, `workspace:^`, `workspace:~` und `workspace:../lib` brauchen nichts) und führt einen einfachen Bereich auf ein Modul als *nicht verlinkt* (`not-linked`) auf, ohne den Namen je in einer Registry nachzuschlagen oder den Bereich umzuschreiben. Nach `pnpm install` liest es den Abschnitt `importers` der `pnpm-lock.yaml` (`lockfileVersion` 9.x): Jede angeglichene Abhängigkeit muss eine `version` mit `link:` haben, sonst wird das Update zurückgenommen.
* **Maven:** Hängt ein Modul mit abweichender Version von einem Modul *desselben Reactors* ab (z. B. `1.0.0`, während das Modul auf `1.1.0-SNAPSHOT` steht), bietet Elevate das Angleichen an. Verweise über `${project.version}` brauchen kein Angleichen.
* **Gradle:** Gradle ersetzt eine Abhängigkeit durch ein Projekt eines *Included Builds*, sobald Gruppe und Name passen, egal welche Version dasteht (`com.acme:lib:1.0.0` wird zum Projekt des Included Builds aufgelöst). Elevate gleicht eine solche Abhängigkeit an die Version des Projekts an und fragt den Namen nie in einem Repository ab; ein Included Build außerhalb des Repositories wird weder angeboten noch abgefragt. Ein Projekt desselben Builds wird nicht ersetzt, eine Abhängigkeit mit seinen Koordinaten ist also eine gewöhnliche.
* Der Release Channel gilt beim Angleichen nicht: Ziel ist die lokale Version — auch `-SNAPSHOT` —, weil die Module eines Repositorys zusammen gebaut und getestet werden.

### Private Registries & Dependency Confusion

* Interne Pakete werden nie in einer öffentlichen Registry abgefragt. Löst die Registry eines internen npm-Pakets zu `registry.npmjs.org` auf, wird es mit Begründung als *nicht angeboten* aufgeführt, statt abgefragt zu werden — genau diese Anfrage nach einem internen Namen nutzt ein Dependency-Confusion-Angriff aus.
* npm-Abfragen verwenden die npm-Konfiguration (`npm config`), Maven- und Gradle-Abfragen Maven bzw. Gradle selbst — Mirrors, private Repositories und Zugangsdaten gelten ohne eigene Elevate-Konfiguration, und Elevate fasst nie Zugangsdaten an.
* **Gradle:** Für ein internes Paket (`internalScopes`; eine Plugin-ID zählt wie eine Gruppe) lässt Elevate Gradle dessen Gruppe beim Abfragen mit einem Content-Filter (`excludeGroupByRegex`) von jedem bekannten öffentlichen Repository fernhalten (`repo.maven.apache.org`, `repo1.maven.org`, `plugins.gradle.org`, `dl.google.com`, `jitpack.io` und einige mehr), sodass keine Anfrage nach dem internen Namen sie erreicht; ein Artifactory oder Nexus der Firma gilt als privat, auch wenn es Maven Central spiegelt. Hat der Build dafür nur öffentliche Repositories, wird die Abhängigkeit als *nicht angeboten* aufgeführt, statt abgefragt zu werden. Zugangsdaten in einer Repository-URL verlassen den Scan nie.

### Wohin Maven-Versionen geschrieben werden

Die Effective POM sagt, welche Version gilt, nicht wo sie steht. Elevate sucht die deklarierende Stelle — `<version>` einer Abhängigkeit, ein Eintrag im `<dependencyManagement>`, eine Property (auch in einer Parent-POM) oder ein externer `<parent>` — und ändert genau diesen Text; Formatierung und Kommentare bleiben erhalten. Vor dem Schreiben wird der Wert mit der effektiven Version abgeglichen. Weichen sie ab (aktive Profile, Properties von der Kommandozeile) oder stammt die Version aus einem externen Parent/BOM, wird die Abhängigkeit mit Begründung als *nicht angeboten* aufgeführt. Artefakte, die sich eine Versions-Property teilen, werden gekennzeichnet; widersprüchliche Zielversionen für eine gemeinsame Property werden abgelehnt.

### Rücknahme

Jedes Update läuft als ein Ablauf: **Snapshot ➔ Schreiben & Installieren ➔ Integritätsprüfung ➔ Verifikation**. Schlägt Installation, Integritätsprüfung oder Verifikation fehl, werden alle berührten Dateien (Manifeste, Lockfile, Parent-POMs) wiederhergestellt und `node_modules` neu installiert. `--keep-on-failure` (CLI) bzw. `keepOnFailure` (MCP) behält die Änderungen einer fehlgeschlagenen *Verifikation* zur Untersuchung. Die Verifikation läuft außerdem einmal *vor* dem Update: Schlägt sie schon dort fehl, wird ein Fehlschlag danach als bereits vorhanden gemeldet und das Update behalten statt zurückgenommen. Ein abstürzender Verifier zählt als fehlgeschlagene Verifikation.

### Verifikation

* **npm:** `npm ls` im Repository-Root (fehlende, ungültige oder unerfüllte Abhängigkeiten in allen Workspaces), sofern kein `postUpdateScript` gesetzt ist.
* **Maven:** `mvn test-compile -pl <geänderte Module> -amd` im Reactor — die geänderten Module *und alle Module, die von ihnen abhängen*. Eine Änderung an der Aggregator-POM baut den ganzen Reactor.
* **Gradle:** `testClasses` (sonst `assemble`) der Projekte, die die geänderten Dateien betreffen können: ein Projekt und jedes Projekt, das über `project(...)` von ihm abhängt; eine Änderung am Root-Projekt (Root-Skript, `gradle.properties`, Settings, `gradle/libs.versions.toml`) betrifft jedes Projekt. Tasks werden mit dem Projektpfad benannt (`:app:testClasses`), ein Modul eines Included Builds über den Namen seines Builds; ohne jeden Task läuft `help`, das den Build konfiguriert und `buildSrc` kompiliert.

### Cargo (Rust)

Elevate startet `cargo` aus dem `PATH` (`cargo metadata --no-deps`, `cargo update`, `cargo check`); fehlt es, schlagen Cargo-Scans mit einer klaren Meldung fehl. Untersucht wird jede `Cargo.toml` außerhalb von `target`, `node_modules`, `vendor`, versteckten Ordnern und `src`; jeder Workspace wird einmal gelesen.

* **Wo Versionen geschrieben werden.** Elevate ändert nur den Versionstext der deklarierenden Stelle — in der `Cargo.toml` der Crate oder bei `workspace = true` in `[workspace.dependencies]` der Wurzel. Kommentare, Anführungszeichen und Zeilenenden bleiben. `cargo add` wird nicht verwendet, weil es `workspace = true` ersetzt.
* **Anforderungen.** Ein nacktes `1.2.3` bedeutet `^1.2.3`. Die neue Anforderung behält Operator und Anzahl der Komponenten: `"1"` → `"2"`, `"1.0.100"` → `"1.0.229"`. `0.x`-Updates, die die erste Komponente ungleich null ändern, gelten als *major*.
* **Registries.** Versionen kommen aus dem Sparse-Index, den deine Cargo-Konfiguration nennt (`.cargo/config.toml` in Elternverzeichnissen, `$CARGO_HOME`, `include`). Eine Crate aus einer alternativen Registry wird nur dort abgefragt. Eine Quellen-Ersetzung, die Elevate nicht lesen kann (Verzeichnis, lokale Registry, Git), stoppt die Abfrage. Registries mit Authentifizierung werden als fehlgeschlagene Abfrage gemeldet.
* **Proxy.** Registry-Abfragen nutzen Nodes `fetch`, das `HTTP_PROXY`/`HTTPS_PROXY` nur beachtet, wenn der Prozess mit `NODE_USE_ENV_PROXY=1` gestartet wird (mit Node 22.23 geprüft). Hinter einem Proxy: `NODE_USE_ENV_PROXY=1 elevate …`; eine fehlgeschlagene Abfrage weist darauf hin. Cargos eigene Einstellungen `http.proxy` und `http.cainfo` werden nicht gelesen; für eine private CA `NODE_EXTRA_CA_CERTS` verwenden.
* **Reine Lockfile-Updates.** Eine Anforderung wie `itoa = "1"` erlaubt schon jede 1.x-Version, die Manifest-Datei ändert sich also nie, während `Cargo.lock` zurückliegen kann. Ist die gelockte Version einer *direkten* Abhängigkeit älter als die neueste Version, die die Anforderung erlaubt (zurückgezogene Versionen, Channel und `rust-version` beachtet), bietet Elevate sie als `[Lock]` an: Die gelockte Version rückt vor, `Cargo.toml` bleibt unverändert, und `cargo update -p name@gelockt --precise ziel` legt das Ergebnis fest. Eine Crate mit einem Manifest-Update erscheint nur mit diesem Kandidaten; solange ein Manifest-Update ansteht, wird für dieselbe Crate kein kompatibles Lock-Update angeboten, auch wenn du das Manifest-Update (etwa ein Major) nicht übernehmen würdest — es erscheint, sobald die Anforderung angehoben wurde oder es keine neuere Version außerhalb davon gibt. Eine gelockte, zurückgezogene Version ohne erlaubten Ersatz wird als übersprungen gemeldet (`locked-version-yanked`). Ohne `Cargo.lock` wird nichts angeboten, transitive Crates ebenfalls nicht. Ein reines Lock-Update wird mit `cargo check` auf dem ganzen Workspace geprüft.
* **Lockfile.** Nach der Änderung wird `Cargo.lock` mit `cargo update -p` aktualisiert und bei einer älteren Wunschversion mit `--precise` festgelegt. Ein Repository ohne `Cargo.lock` bekommt keine.
* **Verifikation.** `cargo check --all-targets` für die geänderten Crates und die davon abhängigen; ändert sich die Workspace-Wurzel, wird der ganze Workspace geprüft. Build-Skripte der neuen Versionen laufen dabei.

### Voraussetzungen für Maven

Elevate verwendet den Maven Wrapper des Projekts (`mvnw` / `mvnw.cmd`), sonst `mvn` aus dem `PATH`. Fehlt beides, bricht der Maven-Scan mit einer klaren Meldung ab, statt zu raten. Die Plugin-Versionen sind für reproduzierbare Ergebnisse festgelegt (`maven-help-plugin` 3.5.2, `versions-maven-plugin` 2.22.0) und lassen sich je Repository mit `mavenPlugins` in der `elevate.config.json` ersetzen (siehe [Maven-Plugin-Versionen](#maven-plugin-versionen)). Scans schreiben temporäre Dateien nur nach `target/.elevate-*` und entfernen sie danach.

### Wohin Gradle-Versionen geschrieben werden

Eine Gradle-Build-Datei ist ein Programm, deshalb parst Elevate sie nicht. Es fragt Gradle, was gilt — die Abhängigkeiten jedes Projekts mit der Version, die sie nach Ausführung aller Skripte haben — und sucht dann in den Dateien des Builds nach dem Text, der diese Version trägt. Eine Fundstelle zählt nur, wenn dort genau die von Gradle gemeldete Version steht. Was sich nicht sicher finden lässt, wird nicht geraten, sondern mit Begründung als *nicht angeboten* aufgeführt.

Der Text wird für die Abhängigkeiten eines Moduls (ein Projekt mit Build-Skript) in dieser Reihenfolge gesucht:

1. String- und Map-Notation im Build-Skript des Moduls selbst;
2. hat dieses Skript kein solches Literal, die Build-Skripte der Eltern-Projekte desselben Builds, das nächste zuerst (dort stehen `subprojects { }` und `allprojects { }`). Das erste Skript mit einem Treffer gewinnt, alle seine Treffer werden geschrieben;
3. ist die Version ein Name (`"g:a:$v"`, `version: v`): die Definition dieses Namens — zuerst `gradle.properties` (die Datei des Moduls, dann die des Builds), dann `def`-, `ext`- und `extra`-Werte im Skript des Moduls und seiner Eltern. Ein Wert, den Gradle überschreibt, eine mehrdeutige Definition oder eine, die kein einzelnes String-Literal ist, wird *nicht angeboten*;
4. markiert Gradle die Abhängigkeit als aus einem Version Catalog stammend: `gradle/libs.versions.toml` des Builds.

Nicht durchsucht werden Convention-Plugins in `buildSrc` oder einem Included Build, mit `apply from:` eingebundene Skripte, Init-Skripte und die `gradle.properties` des Benutzers. Beide DSLs werden nach denselben Regeln gelesen — außerhalb von Kommentaren ist jedes String-Literal ein Kandidat:

| Form | Groovy | Kotlin |
| :--- | :--- | :--- |
| String-Notation | `implementation 'g:a:1.0'`, `"g:a:1.0"`, `implementation('g:a:1.0')` | `implementation("g:a:1.0")` |
| Classifier, Extension | `'g:a:1.0:sources@jar'` (nur `1.0` ändert sich) | `"g:a:1.0:sources@jar"` |
| Map-Notation | `group: 'g', name: 'a', version: '1.0'` (beliebige Reihenfolge) | `group = "g", name = "a", version = "1.0"` |
| Name als Version | `"g:a:$v"`, `"g:a:${v}"`, `version: v` | `"g:a:$v"`, `"g:a:${v}"`, `version = v` |
| Plugin | `id 'x' version '1.0'`, `id('x') version('1.0')` | `id("x") version "1.0"`, `kotlin("jvm") version "1.9.20"` |

Eine Koordinate, die ein Modul mehrfach deklariert (in mehreren Konfigurationen, als Constraint, in einem Catalog), ist ein Kandidat, und die neue Version wird an jede Deklaration geschrieben. Ihr Scope ist der erste aus *prod*, *test* und *plugin* unter ihnen; eine Konfiguration ist eine Test-Konfiguration, wenn eines der Wörter ihres camelCase-Namens `test` ist. Platforms, Enforced Platforms und die Mitglieder eines Bundles werden wie Bibliotheken angeboten, ebenso Constraints (`dependencies { constraints { } }`). Abhängigkeiten, die sich eine Versions-Property oder einen Catalog-Eintrag teilen, werden markiert, und widersprüchliche Ziele für einen gemeinsamen Text werden abgelehnt. Edits ersetzen nur den Versionstext und verweigern eine Datei, in der er oder die Zeichen daneben sich seit dem Scan geändert haben (`1.0` wird zu `1.0.1`).

Als *nicht angeboten* aufgeführt wird:

| Grund | Wann |
| :--- | :--- |
| `version-constraint` | die Version ist ein Selektor oder trägt eine Einschränkung: `1.+`, `latest.release`, `[1.0,2.0)`, `strictly`, `reject`, `prefer` — eine geänderte Zahl würde die Bedeutung ändern |
| `declaration-mismatch` | der Text der Version lässt sich nicht sicher finden: berechnete Versionen, ein Convention-Plugin, ein `apply from:`-Skript, ein anderer Catalog als `gradle/libs.versions.toml`, ein von Gradle überschriebener Wert |
| `invalid-name` | ein externes Modul ohne Gruppe |
| `lookup-failed` | ein Repository-Fehler (Gradles eigene Worte, ohne Zugangsdaten) oder ein Build ohne deklariertes Repository |
| `private-on-public-registry` | ein internes Paket, dessen Repositories alle öffentlich sind |

### Version Catalogs

Gradle liest `gradle/libs.versions.toml` eines Builds als Catalog `libs`. Elevate liest die Datei als TOML und ordnet eine Abhängigkeit einem Eintrag über die Koordinaten zu: der Eintrag, dessen `module` (oder `group` und `name`) die der Abhängigkeit sind und dessen wirksame Version nach Auflösung von `version.ref` genau die von Gradle gemeldete ist. Der Versionstext wird an Ort und Stelle geändert — der `[versions]`-Schlüssel bei `version.ref`, sonst der Eintrag selbst (`"g:a:1.0"`, `version = "1.0"`, `version = { require = "1.0" }`) —, und Kommentare, Abstände, Reihenfolge, Zeilenenden und eine Byte-Order-Mark bleiben. Plugin-Einträge (`[plugins]`) werden genauso behandelt, Bundles enthalten nur Aliase und ihre Mitglieder werden als Bibliotheken angeboten, und ein `[versions]`-Schlüssel, auf den mehrere Bibliotheken verweisen, wird als gemeinsam markiert und einmal geschrieben. Einträge mit `strictly`, `prefer` oder `reject` werden als *nicht angeboten* aufgeführt. Gelesen wird nur die Datei des Builds selbst: in den Settings mit `versionCatalogs { }` deklarierte Catalogs nicht, und ein Included Build hat seine eigene Datei.

### Die Gradle-Läufe, die Elevate startet

Elevate parst Build-Dateien nie, um zu erfahren, was gilt, und kontaktiert nie selbst ein Repository. Es startet das Gradle des Builds — den Wrapper, der dem Modul am nächsten liegt, aufwärts gesucht, aber nie oberhalb des Repository-Roots (`sh ./gradlew`, unter Windows `.\gradlew.bat`), sonst `gradle` aus dem `PATH` — im Verzeichnis des Gradle-Builds des Moduls:

| Zweck | Befehl | Timeout |
| :--- | :--- | :--- |
| Build beschreiben (Projekte, deklarierte Abhängigkeiten, Repositories) | `-q -m --console=plain --no-configuration-cache -Delevate.mode=describe -Delevate.outDir=… -I <Skript> help` | 5 Min. |
| neuere Versionen abfragen | dasselbe mit `-Delevate.mode=lookup -Delevate.plan=…` | 5 Min. |
| Dependency Locks auffrischen | `-q --console=plain --no-configuration-cache :app:dependencies … --update-locks g:a,…` | 10 Min. |
| verifizieren | `-q --console=plain :app:testClasses …` | 30 Min. |

Die beiden Probe-Läufe nutzen ein kleines Groovy-Init-Skript, das Elevate mitbringt; die Antworten sind JSON-Dateien unter `.gradle/elevate-<id>/` des Builds, das nach dem Lauf in jedem Fall entfernt wird — die Standardausgabe trägt keine Antwort. `--no-configuration-cache` ist nötig: Bei aktiviertem Configuration Cache nutzt Gradle ihn im zweiten Lauf, und das Init-Skript würde nicht laufen. Weder `--daemon` noch `--no-daemon` wird übergeben: Die Läufe nutzen Gradle so, wie das Projekt es konfiguriert hat; ein kalter Daemon kostet einmal ein paar Sekunden, jeder weitere Lauf etwa eine. Ein Scan teilt sich je Gradle-Build einen Describe- und einen Lookup-Lauf, egal wie viele Module angefragt sind. Gradle älter als 7.6 wird mit einer Meldung abgelehnt.

### Dependency Locking und Dependency Verification

* **Locks.** Mit `dependencyLocking { lockAllConfigurations() }` liegt in jedem Projektverzeichnis eine `gradle.lockfile`, und eine angehobene Version lässt den Build scheitern, bis der Lock aufgefrischt ist. Nach dem Update einer Bibliothek frischt Elevate die Lock-Dateien des Root-Builds mit `gradle :app:dependencies :core:dependencies … --update-locks <Koordinaten>` auf — alle gemeinsam, denn ein veralteter Lock schlägt nicht immer fehl: Eine niedrigere deklarierte Version wird stillschweigend auf die gesperrte aufgelöst. Die Lock-Dateien gehören zum Snapshot, ein fehlgeschlagenes Auffrischen oder Verifizieren stellt sie wieder her. Locks von `buildSrc`, von Included Builds, vom `buildscript`-Classpath und von den Settings werden nicht aufgefrischt: Ein Update in einem Included Build oder in `buildSrc`, der Lock-Dateien hat, wird abgelehnt, bevor sich etwas ändert.
* **Dependency Verification.** Ein Build mit `gradle/verification-metadata.xml` verweigert die Artefakte einer neuen Version. Elevate erzeugt diese Datei nie neu (`--write-verification-metadata` würde die Prüfsumme dessen festhalten, was gerade geladen wurde, und ihren Zweck aushebeln): Das Update wird mit Gradles Meldung zurückgenommen, und du entscheidest.

### Voraussetzungen für Gradle

Ein JDK, das das Gradle des Builds unterstützt, Gradle 7.6 oder neuer und entweder ein Gradle Wrapper im Repository oder `gradle` im `PATH`; fehlt beides, bricht der Gradle-Scan mit einer klaren Meldung ab, statt zu raten. Auf welchem JDK eine Gradle-Version läuft, bestimmt Gradle (Gradle 7.6.6 läuft zum Beispiel nicht auf JDK 21). Die Integrationstests laufen gegen Gradle 7.6.6 (JDK 17), 8.14.3 und 9.8.1 (JDK 21). Nicht abgedeckt: das Aktualisieren des Gradle Wrappers selbst, Android- und Kotlin-Multiplatform-Builds (nicht verifiziert), Windows (spezifiziert, nicht verifiziert) und Plugins aus `settings.gradle`.

### Repository-Root

Elevate verhält sich gleich, egal wo im Repository es gestartet wird. Der Root wird so bestimmt:

1. Das nächste Verzeichnis (vom Startverzeichnis aufwärts) mit einer `elevate.config.json` ist der Root.
2. Sonst schlägt npm das nächste Verzeichnis vor, dessen `package.json` `workspaces` deklariert, Maven das obere Ende der zusammenhängenden POM-Kette (ein `<parent>`, der über `<relativePath>` gefunden wird, und jeder Aggregator, der das Projekt in `<modules>` aufführt) und Gradle das nächste Verzeichnis mit einer `settings.gradle(.kts)` (`buildSrc` gehört zum umgebenden Build, und ein Build, den eine äußere Settings-Datei mit einem literalen `includeBuild` einbindet, löst zu diesem äußeren Build auf). Der äußerste Vorschlag gewinnt.
3. Ohne jede Markierung ist das Startverzeichnis der Root.

Die Suche verlässt nie den Checkout der Versionsverwaltung: Sie endet im nächsten Verzeichnis, das einen `.git`-Eintrag enthält. Eine verirrte `package.json` oder `pom.xml` oberhalb des Repositorys wird daher nie für dessen Root gehalten. Manifeste, die sich nicht lesen lassen, werden übersprungen.

### Paketmanager-Schutz (Yarn und Bun)

Elevate unterstützt für Node.js npm und pnpm. In einem Repository, das Yarn oder Bun verwaltet, verweigert es Scan und Änderungen, weil jedes der beiden Werkzeuge ein zweites Lockfile und ein `node_modules`-Layout anlegen würde, das das Projekt nicht nutzt. Der Paketmanager wird vom Repository-Root aus erkannt, in dieser Reihenfolge: Feld `packageManager` der `package.json` (`npm@`, `pnpm@`, `yarn@`, `bun@`), dann `package-lock.json` / `npm-shrinkwrap.json`, `pnpm-lock.yaml` / `pnpm-workspace.yaml`, `yarn.lock` / `.yarnrc.yml`, `bun.lock` / `bun.lockb`; ohne Treffer gilt das Repository als npm. Startet Elevate innerhalb eines Workspace-Pakets, wird in den übergeordneten Verzeichnissen bis zum Checkout (nächstes Verzeichnis mit `.git`) weitergesucht. Die Ablehnung nennt den Paketmanager und die entscheidende Datei. Maven-Module im selben Repository, lesende Versionsabfragen (`elevate versions`) und ein eigenes `postUpdateScript` sind nicht betroffen.

### pnpm-Workspaces und Catalogs

* **Workspace-Datei.** In einem pnpm-Repository bestimmt die Liste `packages` der `pnpm-workspace.yaml` (nicht das Feld `workspaces` der `package.json`) die Module; Muster mit `*`, `**` und `!` funktionieren wie bei npm, der Root ist immer ein Modul, `node_modules` enthält nie Module. Eine `pnpm-workspace.yaml` markiert auch den Repository-Root, selbst ohne `packages`. Eine Datei, die kein gültiges YAML ist, gilt als nicht vorhanden.
* **Catalogs.** Eine Abhängigkeit mit `catalog:` / `catalog:default` / `catalog:<name>` wird mit dem Bereich aus dem Catalog angeboten; der neue Bereich wird in genau diesen Eintrag der `pnpm-workspace.yaml` geschrieben (Kommentare, Anführungszeichen, Schreibweise und Zeilenenden bleiben; die `package.json` des Moduls wird nicht umgeschrieben). Eine nicht auflösbare Referenz erscheint als `catalog-unresolved`. Die JSON-Ausgabe nennt den Ort: `"declaredIn": {"file": "pnpm-workspace.yaml", "kind": "catalog", "catalog": "default"}`.
* **Overrides** (`pnpm.overrides`, `overrides` in der `pnpm-workspace.yaml`, `resolutions`) und `peerDependencies` werden nie geändert.

### Befehle, die Elevate für pnpm ausführt

Alle im Repository-Root mit dem `pnpm` aus dem `PATH` (Version über `packageManager`/Corepack). Zuerst läuft `pnpm --version`; scheitert es, bricht die Operation mit einer Erklärung ab, bevor etwas verändert wird.

| Zweck | Befehl | Timeout |
| :--- | :--- | :--- |
| pnpm benutzbar? | `pnpm --version` | 15 s |
| Installation nach dem Schreiben der Bereiche | `pnpm install --no-frozen-lockfile` | 10 min |
| Wiederherstellung nach Rollback | `pnpm install --frozen-lockfile` | 10 min |
| Standard-Verifikation (Lockfile-Konsistenz, ersetzt `npm ls`) | `pnpm install --frozen-lockfile --lockfile-only` | 10 min |
| Schwachstellen-Zusammenfassung | `pnpm audit --json` | 60 s |
| Versionen eines Pakets | `pnpm view <name> <field> --json` | 15 s |
| Registry-Konfiguration | `pnpm config list --json` | 15 s |

`--no-frozen-lockfile` wird ausdrücklich übergeben, weil `pnpm install` bei gesetztem `CI` implizit eingefroren ist und am gerade geänderten Manifest scheitern würde. `pnpm ls` taugt nicht zur Verifikation: Es endet auch bei fehlenden Abhängigkeiten mit 0. Die Schwachstellen-Zusammenfassung stammt aus `pnpm audit --json`; ein Audit ohne Ergebnis ist eine Warnung, nie ein Grund für ein Rollback. pnpm-Einstellungen wie `minimumReleaseAge` oder die Freigabe von Build-Skripten liest Elevate nicht; lehnt pnpm deshalb ab, wird mit pnpms eigener Meldung zurückgenommen.

### Abhängigkeitsbereiche (npm)

| Bereich | Gescannt | Geschrieben |
| :--- | :---: | :---: |
| `dependencies`, `devDependencies`, `optionalDependencies` | ja | ja |
| `peerDependencies`, `overrides`, `bundleDependencies` | nein | nie |

Ein Peer-Bereich sagt Verbrauchern, mit welchen Versionen ein Paket funktioniert; ihn anzuheben, nur weil es eine neuere Version gibt, wäre ein Breaking Change, den niemand beschlossen hat. Ein Name, der in mehreren gescannten Bereichen steht, erhält den neuen Bereich in jedem davon; zur Anzeige haben `optionalDependencies` Vorrang vor `dependencies` (wie bei npm), und ein Name, der auch Entwicklungsabhängigkeit ist, wird als solche angezeigt.

### Angleichen innerhalb des Reactors (Maven)

Eine Abhängigkeit von einem anderen Modul wird nur dann an dessen lokale Version angeglichen, wenn beide Module vom selben äußersten Aggregator gebaut werden (derselbe Reactor). Außerhalb eines Reactors löst Maven die Abhängigkeit wie jedes andere Artefakt aus einem Repository auf, auch wenn irgendwo im Checkout ein Projekt mit denselben Koordinaten liegt (ein Beispiel, eine Testdatei, eine alte Kopie). Eine solche Abhängigkeit wird daher abgefragt und als gewöhnliches Update angeboten — `private`, wenn sie zu `internalScopes` passt, sonst `public`. POM-Dateien unterhalb des `src`-Verzeichnisses eines Projekts (Testdateien, `maven-invoker-plugin`-Projekte, Archetype-Vorlagen) sowie unterhalb von `node_modules`, `target`, `build`, `dist`, `out` oder versteckten Verzeichnissen sind keine Module, es sei denn, ein `<modules>`-Abschnitt nennt sie.

### Maven-Plugin-Versionen

Elevate startet zwei Maven-Plugins: `maven-help-plugin` (liest die Effective POM, Standard `3.5.2`) und `versions-maven-plugin` (fragt neuere Versionen ab, Standard `2.22.0`). Bietet dein Repository-Manager diese Versionen nicht an, lege mit `mavenPlugins` in der `elevate.config.json` andere fest. Ein Wert muss mit einer Ziffer beginnen und darf nur Buchstaben, Ziffern, `.` und `-` enthalten (höchstens 64 Zeichen); alles andere wird durch den Standard ersetzt und als Warnung gemeldet. Kann Maven ein Plugin nicht herunterladen, sagt Elevate das, nennt das Plugin und die Einstellung, mit der sich seine Version ersetzen lässt, und hängt Mavens eigene Fehlerzeilen an.

### Windows-Pfade

Unter Windows sind `npm`, `mvn` und der Maven Wrapper Batch-Dateien, die über `cmd.exe` laufen. Dieses deutet `" % ! ^ & | < >` selbst innerhalb von Anführungszeichen; Elevate setzt kein Argument mit einem dieser Zeichen auf eine Kommandozeile. Das Verzeichnis, in dem das Repository liegt, wird dem Prozess als Arbeitsverzeichnis übergeben, Projektdateien werden relativ dazu benannt — ein Pfad wie `C:\R&D\shop` funktioniert also. Namen *innerhalb* des Repositorys, die auf einer Kommandozeile landen (etwa ein Modulverzeichnis für `-pl`), dürfen diese Zeichen weiterhin nicht enthalten; die Fehlermeldung nennt das Argument und die Abhilfe.

---

## 🏗️ Domain-Driven Clean Architecture

Elevate ist strikt nach den Prinzipien des **Domain-Driven Design (DDD)** und der **Hexagonalen Architektur (Ports & Adapters)** aufgebaut. UI und Hooks hängen niemals direkt von Paketmanagern ab:

```text
src/
├── domain/                      # 🧠 DOMAIN CORE (Reine Fachlogik, zero I/O)
│   ├── models.ts                #   Entities & Value Objects (ProjectModule, UpdateCandidate, DependencyOrigin, …)
│   ├── origin.ts                #   Herkunft (workspace / private / public)
│   ├── versions.ts              #   Erkennung von Vorabversionen & Versionshilfen
│   ├── ports.ts                 #   Domain Ports (ModuleDiscoveryPort, RegistryPort, etc.)
│   ├── ecosystem-strategy.ts    #   Strategy Pattern: Plattform-agnostisches Interface
│   └── ecosystem-factory.ts     #   Factory Pattern: Liefert die npm-, Maven- oder Gradle-Strategie
│
├── adapters/                    # 🔌 ADAPTERS (Konkrete Implementierungen)
│   ├── shared/                  #   🧰 XML (positionsgenau), Prozesse, Snapshots, Pooling
│   │
│   ├── npm/                     #   📦 Node / npm Adapter
│   │   ├── npm-config.ts        #     Effektive npm-Konfiguration (Registry je Scope)
│   │   ├── npm-discovery.ts     #     Workspaces über @npmcli/map-workspaces
│   │   ├── npm-registry.ts      #     npm-view-Abfragen & Dist-Tags
│   │   ├── npm-scanner.ts       #     Herkunft, Angleichen, SemVer-Diffs
│   │   ├── npm-lockfile.ts      #     Prüfung der Workspace-Verlinkung im Lockfile
│   │   ├── npm-commands.ts      #     Befehle je Paketmanager (npm / pnpm)
│   │   ├── npm-protocols.ts     #     Bereichs-Protokolle workspace: / catalog:
│   │   ├── pnpm-workspace.ts    #     pnpm-workspace.yaml: Pakete, Catalogs, Änderung an Ort und Stelle
│   │   ├── pnpm-lockfile.ts     #     Verlinkungsprüfung in der pnpm-lock.yaml
│   │   ├── pnpm-audit.ts        #     Zusammenfassung von pnpm audit --json
│   │   ├── npm-updater.ts       #     Aktualisiert package.json & npm install
│   │   ├── npm-verifier.ts      #     npm ls / eigene Verifikation
│   │   └── npm-strategy.ts      #     NpmEcosystemStrategy
│   │
│   ├── maven/                   #   ☕ Java / Maven Adapter
│   │   ├── maven-command.ts     #     Aufruf über Maven Wrapper / mvn
│   │   ├── maven-pom.ts         #     Rohes POM-Modell mit editierbaren Textbereichen
│   │   ├── maven-project.ts     #     Alle POMs des Repos, Parent-Ketten, Reactors
│   │   ├── maven-discovery.ts   #     Module inkl. Root-POM, Versionen, Aggregator
│   │   ├── maven-resolution.ts  #     Effective POM & Report des versions-maven-plugin
│   │   ├── maven-locator.ts     #     Findet die Stelle, an der eine Version steht
│   │   ├── maven-scanner.ts     #     Herkunft, Angleichen, Update-Kandidaten
│   │   ├── maven-registry.ts    #     `elevate versions` über Maven (jeder Nexus/Artifactory)
│   │   ├── maven-updater.ts     #     Formatierungserhaltende POM-Änderungen
│   │   ├── maven-verifier.ts    #     mvn test-compile -pl … -amd
│   │   └── maven-strategy.ts    #     MavenEcosystemStrategy
│
│   └── gradle/                  #   🐘 Java / Gradle Adapters
│       ├── gradle-command.ts    #     Aufruf über Wrapper / gradle, Gradles eigene Fehlertexte
│       ├── gradle-init-script.ts #    Das Groovy-Init-Skript, das Describe-/Lookup-Läufe beantwortet
│       ├── gradle-probe.ts      #     runDescribe / runLookup und das Scratch-Verzeichnis
│       ├── gradle-discovery.ts  #     Build-Verzeichnisse, Repository-Root, Module aus den beschriebenen Builds
│       ├── gradle-versions.ts   #     Gradles Versionsreihenfolge
│       ├── gradle-repositories.ts #   Wirksame Repositories, öffentliche Hosts, Lookup-Plan, Schutz interner Gruppen
│       ├── gradle-text.ts       #     String-Literale außerhalb von Kommentaren, formatierungserhaltende Edits
│       ├── gradle-catalog.ts    #     gradle/libs.versions.toml: Einträge und der Text einer Version
│       ├── gradle-locator.ts    #     Findet, wo eine Version deklariert ist
│       ├── gradle-scanner.ts    #     Herkunft, Angleichen an Included Builds, Update-Kandidaten
│       ├── gradle-registry.ts   #     `elevate versions` über Gradle (jeder Nexus/Artifactory)
│       ├── gradle-locks.ts      #     gradle.lockfile finden und --update-locks
│       ├── gradle-updater.ts    #     Formatierungserhaltende Edits, Lock-Auffrischung
│       ├── gradle-verifier.ts   #     testClasses / assemble der betroffenen Projekte
│       └── gradle-strategy.ts   #     GradleEcosystemStrategy
│
├── application/                 # 🧭 ANWENDUNGSFÄLLE für TUI, CLI und MCP
│   ├── scan.ts                  #     Scan-Kontext, Modulsuche, JSON-Ausgabe
│   ├── update-selection.ts      #     Guardrails für angeforderte Updates
│   ├── update-workflow.ts       #     Snapshot ➔ Installation ➔ Integrität ➔ Verifikation ➔ Rücknahme
│   └── version-lookup.ts        #     Versionshistorie ohne öffentliche Abfrage interner Namen
│
├── hooks/                       # 🎣 APPLICATION HOOKS (Verwenden ausschließlich Ports)
│   ├── use-workspaces.ts        #     Modulverwaltung über ModuleDiscoveryPort
│   ├── use-packages.ts          #     Scan & Filterung über DependencyReaderPort
│   └── use-updater.ts           #     Führt den gemeinsamen Update-Ablauf aus
│
├── components/                  # 🎨 PRESENTATIONAL UI (Reine Darstellung mit Ink)
│   ├── header.tsx               #     Ökosystem [E], Channel [stable], Sprache [L], Autor
│   ├── workspace-bar.tsx        #     Aktives Modul mit statischem Schutzhinweis
│   ├── mascot.tsx               #     🐣 Animiertes Begleiter-Hühnchen ("Pip")
│   ├── status-bar.tsx           #     Wackelfreie Statusleiste mit Zählern & Pip
│   ├── tab-bar.tsx              #     Ökosystem-spezifische Tabs
│   ├── package-list.tsx         #     Scrollbare Liste im Orange-Design
│   ├── package-row.tsx          #     Zeile mit Badges ([Patch], [Minor], [MAJOR], [BETA])
│   ├── controls-bar.tsx         #     Tastaturkürzel
│   ├── workspace-modal.tsx      #     Modalauswahl für Module
│   ├── version-modal.tsx        #     🔍 Modale Version-Suche & Picker
│   ├── splash-screen.tsx        #     Initialer Start-Screen
│   ├── updating-view.tsx        #     Fortschrittsanzeige während des Updates
│   └── summary-view.tsx         #     Ergebnisbericht nach Abschluss
│
├── cli/                         # 💻 HEADLESS CLI SUBCOMMANDS (für CI/CD & Shell-Agents)
│   ├── parser.ts                #     Befehlszeilen-Parser (node:util.parseArgs)
│   ├── command-modules.ts       #     `elevate modules`
│   ├── command-scan.ts          #     `elevate scan`
│   ├── command-versions.ts      #     `elevate versions`
│   └── command-update.ts        #     `elevate update`
│
├── mcp/                         # 🤖 MODEL CONTEXT PROTOCOL (MCP Server)
│   └── mcp-server.ts            #     Standardisierter stdio MCP-Server mit 5 Tools
│
├── i18n/                        # 🌍 Sprachverwaltung (de.ts / en.ts)
├── config.ts                    # ⚙️ Konfigurations-Loader
├── theme.ts                     # 🎨 Farb-Tokens & Icons
├── app.tsx                      # 📱 App-Shell (Container)
└── index.tsx                    # 🏁 Universeller Einstiegspunkt (TUI / CLI / MCP)
```

---

## 🤖 Agentic & CI/CD Nutzung (Headless CLI & MCP)

Elevate kann von KI-Agenten (Claude Code, Antigravity, Cursor, Copilot) sowie automatisierten CI/CD-Pipelines nahtlos angesteuert werden.

### 1. Headless CLI-Befehle (`--json`)

```bash
# Module im Monorepo auflisten
node tools/updater/elevate/index.mjs modules --json

# Abhängigkeiten aller Module scannen
# (Exit-Code 0 = aktuell, 1 = Updates verfügbar, 3 = ein Modul konnte nicht gescannt werden)
node tools/updater/elevate/index.mjs scan --channel=stable --all-modules --json

# Vollständige Versionshistorie eines Pakets abfragen
node tools/updater/elevate/index.mjs versions chalk --json

# Updates mit Guardrails simulieren (--dry-run)
node tools/updater/elevate/index.mjs update --module=apps/e2e-cockpit --packages=chalk@5.6.2 --dry-run --json

# Major-Updates gezielt anwenden (--allow-major erforderlich)
node tools/updater/elevate/index.mjs update --module=apps/e2e-cockpit --packages=pinia@4.0.3 --allow-major --json

# Änderungen behalten, wenn die Verifikation fehlschlägt (Standard: Rücknahme)
node tools/updater/elevate/index.mjs update --module=apps/web --all --keep-on-failure
```

`scan --json` liefert je Modul die `updates` (mit `action`, `origin` und bei Maven und Gradle `declaredIn`, bei Gradle außerdem `alsoDeclaredIn`, wenn eine Version an mehreren Stellen steht) und die übersprungenen Abhängigkeiten unter `skipped` mit `reason`. `update` endet mit Exit-Code `2`, wenn das Update fehlschlug und zurückgenommen wurde.

### 2. Model Context Protocol (MCP) Server

Elevate bietet einen vollwertigen, stdio-basierten MCP-Server:
```bash
node tools/updater/elevate/index.mjs mcp
```

In der MCP-Konfiguration hinterlegen (z. B. `claude_desktop_config.json` oder Antigravity MCP):
```json
{
  "mcpServers": {
    "elevate": {
      "command": "npx",
      "args": ["-y", "@dennisrepa/elevate", "mcp"]
    }
  }
}
```

#### Verfügbare MCP-Tools für LLMs:
| Tool | Funktion |
| :--- | :--- |
| `elevate_discover_modules` | Erkennt alle Monorepo-Module und Workspaces für npm, Maven, Cargo oder Gradle (Gradle-Module nennen die Art ihres Builds) |
| `elevate_scan` | Scannt ein Modul (oder alle Module) nach Updates und anzugleichenden internen Abhängigkeiten; nennt übersprungene Abhängigkeiten mit Grund |
| `elevate_get_versions` | Ruft die Versionshistorie aus der Registry ab (keine öffentliche Abfrage interner Pakete) |
| `elevate_apply_updates` | Wendet Updates mit Verifikation, Major-Guardrail und Rücknahme an (`keepOnFailure` optional) |
| `elevate_verify` | Führt modulspezifische Build- und Test-Checks aus |

---

## ⌨️ Tastatur-Steuerung (Interaktive TUI)

| Taste | Aktion |
| :--- | :--- |
| **`E`** | **Ökosystem umschalten (📦 Node/npm → ☕ Java/Maven → 🦀 Rust/Cargo → 🐘 Java/Gradle)** |
| **`W`** | Modul- / Workspace-Auswahl öffnen |
| **`V`** | **Version heraussuchen (Interaktiver Such- & Filterdialog)** |
| **`L`** | Sprache umschalten (Deutsch ⇄ English) |
| **`↑` / `↓`** *(oder `k`/`j`)* | In der Liste navigieren |
| **`Space`** | Markierung des fokussierten Eintrags umschalten |
| **`A`** | Alle sichtbaren Einträge im aktuellen Tab umschalten |
| **`Tab`** *(oder `1`, `2`, `3`)* | Zwischen Tabs wechseln |
| **`U`** | Update für alle ausgewählten Einträge starten |
| **`R`** | Aktuelles Modul neu scannen |
| **`Q`** | Elevate beenden |

---

## ⚙️ Konfiguration (`elevate.config.json`)

Im Wurzelverzeichnis deines Repositories kann optional eine `elevate.config.json` angelegt werden:

```json
{
  "author": "Dennis Répa",
  "channel": "stable",
  "locale": "de",
  "internalScopes": ["@my-org", "com.mycompany"],
  "mavenPlugins": { "help": "3.5.2", "versions": "2.22.0" },
  "postUpdateScript": "npm test",
  "postUpdateLabel": "Test-Suite ausführen"
}
```

* **`author`:** Optionaler Name, der oben rechts im Header erscheint.
* **`channel`:** `"stable"` (Standard, schließt Betas/RCs aus) oder `"all"` (zeigt auch Vorabversionen).
* **`locale`:** `"de"` (Deutsch), `"en"` (Englisch) oder `"auto"` (automatische Erkennung).
* **`internalScopes`:** Interne npm-Scopes und Maven-/Gradle-groupId-Präfixe (bei Gradle auch Plugin-IDs). `@my-org` trifft `@my-org/*`; `com.mycompany` trifft `com.mycompany` und `com.mycompany.*` (nicht `com.mycompanyx`). Passende Pakete werden nur in privaten Registries abgefragt. *Früher `excludeScopes`; der alte Name wird weiter gelesen und als veraltet gemeldet.*
* **`mavenPlugins`:** Optionale Versionen der Maven-Plugins, die Elevate startet: `help` (`maven-help-plugin`, Standard `3.5.2`) und `versions` (`versions-maven-plugin`, Standard `2.22.0`). Nutze es, wenn dein Repository-Manager die Standardversionen nicht anbietet. Ungültige Werte fallen mit einer Warnung auf den Standard zurück.
* **`postUpdateScript`:** Optionaler Befehl, der die Standard-Verifikation (`npm ls` / `mvn test-compile`) ersetzt. Läuft im Repository-Root (npm), im Modulverzeichnis (Maven) bzw. im Verzeichnis des Gradle-Builds des Moduls (Gradle).

---

## 📦 Installation & Bereitstellung

Elevate bietet maximale Flexibilität für jede Entwickler-Umgebung:

### 1. ⚡ Sofortstart ohne Installation via `npx` (Empfohlen)
Startet Elevate sofort, ohne Klonen oder npm-Installationen:
```bash
npx @dennisrepa/elevate
```
> **Für autonome KI-Agenten (Claude Code, Cursor, Antigravity):**  
> Direkt in der MCP-Konfiguration hinterlegen:
> ```json
> {
>   "mcpServers": {
>     "elevate": {
>       "command": "npx",
>       "args": ["-y", "@dennisrepa/elevate", "mcp"]
>     }
>   }
> }
> ```

---

### 2. 🪟 Standalone Executable (Komplett ohne Node.js)
Für reine Java-Entwickler, Systemadministratoren oder CI-Server ohne Node-Installation:
1. `elevate.exe` (Windows) oder `elevate-linux` aus den **[GitHub Releases](https://github.com/dennisrepa/elevate/releases)** herunterladen.
2. Direkt im Terminal oder per Doppelklick starten:
   ```powershell
   .\elevate.exe
   ```

---

### 3. 🌍 Globale System-Installation
Installiert den Befehl `elevate` dauerhaft in jedem Terminal:
```bash
npm install -g @dennisrepa/elevate
```
Danach überall einfach aufrufen:
```bash
elevate
```

---

### 4. 🏢 Monorepo- & Projekt-Integration
Als devDependency im eigenen Monorepo hinterlegen:
```bash
npm install -D @dennisrepa/elevate
```
Skript in die Root-`package.json` einfügen:
```json
{
  "scripts": {
    "elevate": "elevate"
  }
}
```
Jedes Teammitglied kann das Dashboard nun starten mit:
```bash
npm run elevate
```

---

### 5. 🛠️ Lokale Entwicklung & Mitwirken (In diesem Repo)
```bash
cd tools/updater/elevate
npm run build
npm link
```
Direkt aus dem Root-Verzeichnis ausführen:
```powershell
.\elevate.exe
# oder
node tools/updater/elevate/dist/cli.js
```

---

## ☕ Projekt unterstützen (Ko-fi & Sponsoring)

Elevate ist Open-Source und wird mit Leidenschaft entwickelt. Wenn dir das Tool gefällt und es dir oder deinem Team Zeit spart, kannst du die Weiterentwicklung gerne unterstützen:

[![Dennis Répa auf Ko-fi unterstützen](https://img.shields.io/badge/Ko--fi-Support%20Dennis%20R%C3%A9pa-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/dennisrepa)

* ☕ **[Dennis Répa auf Ko-fi einen Kaffee spendieren](https://ko-fi.com/dennisrepa)**
* 💻 Oder im Terminal: `npm fund @dennisrepa/elevate`

