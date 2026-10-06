# 🪶 Elevate — Deutsche Dokumentation

> **Interaktives Terminal-Dashboard (TUI) zur sicheren, selektiven und transparenten Aktualisierung von Abhängigkeiten in Polyglot-Monorepos.**  
> *Entwickelt und gepflegt von **Dennis Répa**.*

---

## 🌟 Übersicht

**Elevate** ist ein interaktives Terminal-Dashboard (TUI) zur sicheren, selektiven und transparenten Aktualisierung von Abhängigkeiten in **Polyglot-Monorepos** (Node/npm & Java/Maven) sowie Einzelprojekten.

* **Feder-Symbolik (`🪶`) & Orange-Brand (`#FF8800`):** Leicht, modern und übersichtlich im Terminal.
* **Polyglot-Fähig:** Unterstützt gleichzeitig Frontend-Projekte (`package.json` mit npm Workspaces) und Backend-Projekte (`pom.xml` mit Maven).
* **Release Channels:** Filtert Vorabversionen (Beta, RC, Alpha, Milestone, Snapshot) standardmäßig heraus und schlägt ausschließlich produktionsreife Releases vor.
* **Animiertes Begleiter-Hühnchen („Pip“ 🐣):** Begleitet den Entwickler dezent im Terminal und reagiert auf Aktionen.
* **Bilinguales i18n:** Jederzeit umschaltbar zwischen Deutsch und Englisch via Taste **`[L]`**.

---

## ✨ Features & Highlights

1. **🌐 Polyglot Monorepo Support (npm & Maven):**
   * **Node / npm:** Löst Workspaces genau wie npm auf (inklusive Glob-Mustern wie `packages/**`), berechnet SemVer-Diffs, aktualisiert `package.json`, führt `npm install` aus und prüft das Lockfile.
   * **Java / Maven:** Findet jede `pom.xml` (auch die Root-POM), lässt Maven die Effective POM berechnen, sucht neuere Versionen über die Repositories des Builds (Mirrors, Nexus/Artifactory, Zugangsdaten aus der `settings.xml`) und prüft die betroffenen Module mit `mvn test-compile`.
   * **Live-Wechsel:** Ein Tastendruck auf **`[E]`** schaltet im laufenden Betrieb zwischen Frontend- und Backend-Modulen um.

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
* **Maven:** Hängt ein Modul mit abweichender Version von einem Modul *desselben Reactors* ab (z. B. `1.0.0`, während das Modul auf `1.1.0-SNAPSHOT` steht), bietet Elevate das Angleichen an. Verweise über `${project.version}` brauchen kein Angleichen.
* Der Release Channel gilt beim Angleichen nicht: Ziel ist die lokale Version — auch `-SNAPSHOT` —, weil die Module eines Repositorys zusammen gebaut und getestet werden.

### Private Registries & Dependency Confusion

* Interne Pakete werden nie in einer öffentlichen Registry abgefragt. Löst die Registry eines internen npm-Pakets zu `registry.npmjs.org` auf, wird es mit Begründung als *nicht angeboten* aufgeführt, statt abgefragt zu werden — genau diese Anfrage nach einem internen Namen nutzt ein Dependency-Confusion-Angriff aus.
* npm-Abfragen verwenden die npm-Konfiguration (`npm config`), Maven-Abfragen Maven selbst — Mirrors, private Repositories und Zugangsdaten gelten ohne eigene Elevate-Konfiguration, und Elevate fasst nie Zugangsdaten an.

### Wohin Maven-Versionen geschrieben werden

Die Effective POM sagt, welche Version gilt, nicht wo sie steht. Elevate sucht die deklarierende Stelle — `<version>` einer Abhängigkeit, ein Eintrag im `<dependencyManagement>`, eine Property (auch in einer Parent-POM) oder ein externer `<parent>` — und ändert genau diesen Text; Formatierung und Kommentare bleiben erhalten. Vor dem Schreiben wird der Wert mit der effektiven Version abgeglichen. Weichen sie ab (aktive Profile, Properties von der Kommandozeile) oder stammt die Version aus einem externen Parent/BOM, wird die Abhängigkeit mit Begründung als *nicht angeboten* aufgeführt. Artefakte, die sich eine Versions-Property teilen, werden gekennzeichnet; widersprüchliche Zielversionen für eine gemeinsame Property werden abgelehnt.

### Rücknahme

Jedes Update läuft als ein Ablauf: **Snapshot ➔ Schreiben & Installieren ➔ Integritätsprüfung ➔ Verifikation**. Schlägt Installation, Integritätsprüfung oder Verifikation fehl, werden alle berührten Dateien (Manifeste, Lockfile, Parent-POMs) wiederhergestellt und `node_modules` neu installiert. `--keep-on-failure` (CLI) bzw. `keepOnFailure` (MCP) behält die Änderungen einer fehlgeschlagenen *Verifikation* zur Untersuchung. Die Verifikation läuft außerdem einmal *vor* dem Update: Schlägt sie schon dort fehl, wird ein Fehlschlag danach als bereits vorhanden gemeldet und das Update behalten statt zurückgenommen. Ein abstürzender Verifier zählt als fehlgeschlagene Verifikation.

### Verifikation

* **npm:** `npm ls` im Repository-Root (fehlende, ungültige oder unerfüllte Abhängigkeiten in allen Workspaces), sofern kein `postUpdateScript` gesetzt ist.
* **Maven:** `mvn test-compile -pl <geänderte Module> -amd` im Reactor — die geänderten Module *und alle Module, die von ihnen abhängen*. Eine Änderung an der Aggregator-POM baut den ganzen Reactor.

### Voraussetzungen für Maven

Elevate verwendet den Maven Wrapper des Projekts (`mvnw` / `mvnw.cmd`), sonst `mvn` aus dem `PATH`. Fehlt beides, bricht der Maven-Scan mit einer klaren Meldung ab, statt zu raten. Die Plugin-Versionen sind für reproduzierbare Ergebnisse festgelegt (`maven-help-plugin` 3.5.2, `versions-maven-plugin` 2.22.0) und lassen sich je Repository mit `mavenPlugins` in der `elevate.config.json` ersetzen (siehe [Maven-Plugin-Versionen](#maven-plugin-versionen)). Scans schreiben temporäre Dateien nur nach `target/.elevate-*` und entfernen sie danach.

### Repository-Root

Elevate verhält sich gleich, egal wo im Repository es gestartet wird. Der Root wird so bestimmt:

1. Das nächste Verzeichnis (vom Startverzeichnis aufwärts) mit einer `elevate.config.json` ist der Root.
2. Sonst schlägt npm das nächste Verzeichnis vor, dessen `package.json` `workspaces` deklariert, und Maven das obere Ende der zusammenhängenden POM-Kette (ein `<parent>`, der über `<relativePath>` gefunden wird, und jeder Aggregator, der das Projekt in `<modules>` aufführt). Der äußerste Vorschlag gewinnt.
3. Ohne jede Markierung ist das Startverzeichnis der Root.

Die Suche verlässt nie den Checkout der Versionsverwaltung: Sie endet im nächsten Verzeichnis, das einen `.git`-Eintrag enthält. Eine verirrte `package.json` oder `pom.xml` oberhalb des Repositorys wird daher nie für dessen Root gehalten. Manifeste, die sich nicht lesen lassen, werden übersprungen.

### Paketmanager-Schutz (npm)

Elevates Node.js-Unterstützung steuert npm. In einem Repository, das pnpm, Yarn oder Bun verwaltet, weigert sich Elevate, die npm-Module zu scannen oder zu ändern, denn `npm install` würde ein zweites Lockfile und ein `node_modules`-Layout anlegen, das das Projekt nicht verwendet. Der Paketmanager wird am Repository-Root in dieser Reihenfolge erkannt: Feld `packageManager` der `package.json` (`npm@`, `pnpm@`, `yarn@`, `bun@`), dann `package-lock.json` / `npm-shrinkwrap.json`, `pnpm-lock.yaml` / `pnpm-workspace.yaml`, `yarn.lock` / `.yarnrc.yml`, `bun.lock` / `bun.lockb`; ohne eines davon gilt das Repository als npm. Startet Elevate in einem Workspace-Paket, läuft die Suche in den übergeordneten Verzeichnissen weiter bis zum Checkout (nächstes Verzeichnis mit `.git`-Eintrag); ohne Checkout wird nur das Verzeichnis selbst geprüft. Die Ablehnung nennt den Paketmanager und die Datei, die entschieden hat. Maven-Module im selben Repository, lesende Versionsabfragen (`elevate versions`) und ein eigenes `postUpdateScript` bleiben unberührt.

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
│   └── ecosystem-factory.ts     #   Factory Pattern: Liefert npm- oder Maven-Strategie
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
│   │   ├── npm-updater.ts       #     Aktualisiert package.json & npm install
│   │   ├── npm-verifier.ts      #     npm ls / eigene Verifikation
│   │   └── npm-strategy.ts      #     NpmEcosystemStrategy
│   │
│   └── maven/                   #   ☕ Java / Maven Adapter
│       ├── maven-command.ts     #     Aufruf über Maven Wrapper / mvn
│       ├── maven-pom.ts         #     Rohes POM-Modell mit editierbaren Textbereichen
│       ├── maven-project.ts     #     Alle POMs des Repos, Parent-Ketten, Reactors
│       ├── maven-discovery.ts   #     Module inkl. Root-POM, Versionen, Aggregator
│       ├── maven-resolution.ts  #     Effective POM & Report des versions-maven-plugin
│       ├── maven-locator.ts     #     Findet die Stelle, an der eine Version steht
│       ├── maven-scanner.ts     #     Herkunft, Angleichen, Update-Kandidaten
│       ├── maven-registry.ts    #     `elevate versions` über Maven (jeder Nexus/Artifactory)
│       ├── maven-updater.ts     #     Formatierungserhaltende POM-Änderungen
│       ├── maven-verifier.ts    #     mvn test-compile -pl … -amd
│       └── maven-strategy.ts    #     MavenEcosystemStrategy
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

`scan --json` liefert je Modul die `updates` (mit `action`, `origin` und bei Maven `declaredIn`) und die übersprungenen Abhängigkeiten unter `skipped` mit `reason`. `update` endet mit Exit-Code `2`, wenn das Update fehlschlug und zurückgenommen wurde.

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
| `elevate_discover_modules` | Erkennt alle Monorepo-Module und Workspaces für npm oder Maven |
| `elevate_scan` | Scannt ein Modul (oder alle Module) nach Updates und anzugleichenden internen Abhängigkeiten; nennt übersprungene Abhängigkeiten mit Grund |
| `elevate_get_versions` | Ruft die Versionshistorie aus der Registry ab (keine öffentliche Abfrage interner Pakete) |
| `elevate_apply_updates` | Wendet Updates mit Verifikation, Major-Guardrail und Rücknahme an (`keepOnFailure` optional) |
| `elevate_verify` | Führt modulspezifische Build- und Test-Checks aus |

---

## ⌨️ Tastatur-Steuerung (Interaktive TUI)

| Taste | Aktion |
| :--- | :--- |
| **`E`** | **Ökosystem umschalten (📦 Node/npm ⇄ ☕ Java/Maven)** |
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
* **`internalScopes`:** Interne npm-Scopes und Maven-groupId-Präfixe. `@my-org` trifft `@my-org/*`; `com.mycompany` trifft `com.mycompany` und `com.mycompany.*` (nicht `com.mycompanyx`). Passende Pakete werden nur in privaten Registries abgefragt. *Früher `excludeScopes`; der alte Name wird weiter gelesen und als veraltet gemeldet.*
* **`mavenPlugins`:** Optionale Versionen der Maven-Plugins, die Elevate startet: `help` (`maven-help-plugin`, Standard `3.5.2`) und `versions` (`versions-maven-plugin`, Standard `2.22.0`). Nutze es, wenn dein Repository-Manager die Standardversionen nicht anbietet. Ungültige Werte fallen mit einer Warnung auf den Standard zurück.
* **`postUpdateScript`:** Optionaler Befehl, der die Standard-Verifikation (`npm ls` / `mvn test-compile`) ersetzt. Läuft im Repository-Root (npm) bzw. im Modulverzeichnis (Maven).

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

