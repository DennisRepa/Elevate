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
   * **Node / npm:** Erkennt Root- und Workspace-Pakete, berechnet SemVer-Diffs, aktualisiert `package.json` und führt `npm install` aus.
   * **Java / Maven:** Durchsucht das Projekt nach allen `pom.xml`-Dateien (Spring-Boot-Services, Libraries etc.), fragt Maven Central ab und prüft Quellcode mit `mvn test-compile`.
   * **Live-Wechsel:** Ein Tastendruck auf **`[E]`** schaltet im laufenden Betrieb zwischen Frontend- und Backend-Modulen um.

2. **🔍 Version gezielt heraussuchen (`[V]`):**
   * Man muss nicht zwingend auf die `latest` Version aktualisieren: Taste **`[V]`** öffnet ein interaktives Such-Modal für das aktuell ausgewählte Paket.
   * Lädt alle jemals veröffentlichten Versionen aus der npm- oder Maven-Registry.
   * Ermöglicht Echtzeit-Filterung während des Tippens (z. B. `3.2` oder `25`), Pfeiltasten-Navigation und Übernahme mit `Enter`.
   * Manuell ausgewählte Versionen werden im Dashboard mit einem `[MANUELL]`-Badge hervorgehoben.

3. **🚦 Release Channels (`stable` vs. `all`):**
   * **`channel: "stable"` (Standard):** Verhindert das unabsichtliche Installieren instabiler Vorabversionen (`-alpha`, `-beta`, `-rc`, `-m1`, `-snapshot`).
   * **`channel: "all"`:** Zeigt alle Versionen an und hebt Vorabversionen mit farbigen Warn-Badges (`[BETA]`, `[RC]`, `[ALPHA]`) in Magenta hervor.

4. **🛡️ Monorepo-Schutz für interne Pakete:**
   * Schützt interne Pakete (z. B. `@my-org/*`, `com.mycompany.*`) davor, versehentlich durch fremde Bibliotheken aus öffentlichen Registries überschrieben zu werden.

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

## 🏗️ Domain-Driven Clean Architecture

Elevate ist strikt nach den Prinzipien des **Domain-Driven Design (DDD)** und der **Hexagonalen Architektur (Ports & Adapters)** aufgebaut. UI und Hooks hängen niemals direkt von Paketmanagern ab:

```text
src/
├── domain/                      # 🧠 DOMAIN CORE (Reine Fachlogik, zero I/O)
│   ├── models.ts                #   Entities & Value Objects (ProjectModule, UpdateCandidate, etc.)
│   ├── ports.ts                 #   Domain Ports (ModuleDiscoveryPort, RegistryPort, etc.)
│   ├── ecosystem-strategy.ts    #   Strategy Pattern: Plattform-agnostisches Interface
│   └── ecosystem-factory.ts     #   Factory Pattern: Liefert npm- oder Maven-Strategie
│
├── adapters/                    # 🔌 ADAPTERS (Konkrete Implementierungen)
│   ├── npm/                     #   📦 Node / npm Adapter
│   │   ├── npm-discovery.ts     #     Liest workspaces aus Root-package.json
│   │   ├── npm-registry.ts      #     npm-Registry-Abfragen & Dist-Tags
│   │   ├── npm-scanner.ts       #     Parst dependencies & SemVer-Diffs
│   │   ├── npm-updater.ts       #     Aktualisiert package.json & npm install
│   │   ├── npm-verifier.ts      #     Konsistenzchecks & Build-Tests
│   │   └── npm-strategy.ts      #     NpmEcosystemStrategy
│   │
│   └── maven/                   #   ☕ Java / Maven Adapter
│       ├── maven-discovery.ts   #     Findet alle pom.xml im Projektbaum
│       ├── maven-registry.ts    #     Maven Central Metadata & Release-Filter
│       ├── maven-scanner.ts     #     Parst dependencies, Deduplizierung & Properties
│       ├── maven-updater.ts     #     Aktualisiert pom.xml & mvn dependency:resolve
│       ├── maven-verifier.ts    #     mvn test-compile Quellcode-Verifikation
│       └── maven-strategy.ts    #     MavenEcosystemStrategy
│
├── hooks/                       # 🎣 APPLICATION HOOKS (Verwenden ausschließlich Ports)
│   ├── use-workspaces.ts        #     Modulverwaltung über ModuleDiscoveryPort
│   ├── use-packages.ts          #     Scan & Filterung über DependencyReaderPort
│   └── use-updater.ts           #     Update & Verifikation über Updater-/Verifier-Ports
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

# Abhängigkeiten aller Module scannen (Exit-Code 1 wenn Updates verfügbar)
node tools/updater/elevate/index.mjs scan --channel=stable --all-modules --json

# Vollständige Versionshistorie eines Pakets abfragen
node tools/updater/elevate/index.mjs versions chalk --json

# Updates mit Guardrails simulieren (--dry-run)
node tools/updater/elevate/index.mjs update --module=apps/e2e-cockpit --packages=chalk@5.6.2 --dry-run --json

# Major-Updates gezielt anwenden (--allow-major erforderlich)
node tools/updater/elevate/index.mjs update --module=apps/e2e-cockpit --packages=pinia@4.0.3 --allow-major --json
```

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
| `elevate_scan` | Scannt ein Modul (oder alle Module) nach verfügbaren Updates |
| `elevate_get_versions` | Ruft die Versionshistorie direkt aus der Registry ab |
| `elevate_apply_updates` | Wendet Updates mit Guardrails und Verifikations-Builds an |
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
  "excludeScopes": ["@my-org", "com.mycompany"],
  "postUpdateScript": "npm test",
  "postUpdateLabel": "Test-Suite ausführen"
}
```

* **`author`:** Optionaler Name, der oben rechts im Header erscheint.
* **`channel`:** `"stable"` (Standard, schließt Betas/RCs aus) oder `"all"` (zeigt auch Vorabversionen).
* **`locale`:** `"de"` (Deutsch), `"en"` (Englisch) oder `"auto"` (automatische Erkennung).
* **`excludeScopes`:** Liste interner Paket-Präfixe, die vor externen Registry-Abfragen geschützt werden.
* **`postUpdateScript`:** Optionaler Konsistenz- oder Testbefehl nach einem npm-Update.

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

