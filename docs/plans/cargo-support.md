# Cargo als dritter Package Manager — Implementierungsplan

> **Status:** Entwurf zur Entscheidung · **Stand:** 2026-11-04 · **Basis:** Elevate 1.3.0
> **Recherche-Umgebung:** Cargo 1.97.0, Node 22.23.4, Live-Zugriff auf `index.crates.io`.
> Die Doku-Hosts `doc.rust-lang.org` und `docs.rs` waren aus der Recherche-Umgebung **nicht erreichbar**. Alles, was ich nicht selbst ausgeführt habe, steht in Abschnitt 3.2 als *nicht verifiziert* und ist vor dem Phase-1-Gate zu prüfen.

---

## 1. Kurzfassung

Cargo passt sauber in die bestehende Hexagonal-Architektur: Es braucht einen neuen Adapter-Ordner `src/adapters/cargo/` mit den fünf bekannten Ports, eine neue `EcosystemStrategy` und eine Zeile in der `EcosystemFactory`. `update-workflow`, Snapshots/Rollback, Origin-Klassifizierung, CLI und MCP bleiben im Kern unverändert.

Aufwand: etwa so groß wie der Maven-Adapter (~1.800–2.000 Zeilen Adapter-Code, plus Tests). Grobe Schätzung: **12–16 Arbeitstage** für eine Person, verteilt auf vier Phasen (Abschnitt 7).

**Die wichtigsten Empfehlungen** (Details und Alternativen in Abschnitt 4):

| # | Frage | Empfehlung |
| :-- | :--- | :--- |
| D1 | Was gilt als „Update"? | npm-Parität: Anforderung in `Cargo.toml` anheben, **mit Erhalt der Präzision** (`"1"` → `"2"`, `"1.0.100"` → `"1.0.229"`). Reine Lockfile-Updates als Folgeausbau. |
| D2 | Woher kommen die Versionen? | **Sparse-Index direkt per HTTP** (alle Versionen, `yanked`, `rust_version`) + eigener, schmaler Config-Reader. Authentifizierte Registries werden in v1 mit klarer Meldung abgelehnt; Elevate fasst keine Zugangsdaten an. |
| D3 | Wie wird `Cargo.toml` geschrieben? | **Eigener formatbewahrender Text-Splice** auf Basis von `toml-eslint-parser`. `cargo add` ist ungeeignet (belegt, siehe 3.1 Nr. 7). |
| D4 | Wo wird Cargo gefunden/gestartet? | `cargo` auf dem `PATH`, `cwd` = Workspace-Root, nie Pfade auf der Kommandozeile (wie bei Maven). |
| D5 | Discovery | **Baum-Scan** nach `Cargo.toml` (wie Maven), nicht nur Root — sonst fehlen z. B. Tauri-Projekte unter `apps/x/src-tauri`. |
| D6 | Verifikation | `cargo check --all-targets` für geänderte Member **plus abhängige Member**; bei geändertem Root-Manifest der ganze Workspace. |
| D7 | Neue Laufzeit-Abhängigkeit | `toml-eslint-parser` (MIT, 1 Dependency). Schafft **keinen zusätzlichen** Engine-Bruch: `@npmcli/map-workspaces@6` verlangt schon heute strengere Node-Versionen als `engines` deklariert (3.1 Nr. 14). |

**Drei Dinge, die ihr entscheiden müsst** (Abschnitt 9): D1 (Semantik), D2 (HTTP-Index statt Cargo-Delegation) und ob Lockfile-only-Updates zum Umfang von v1 gehören. Unabhängig von Cargo gefunden: die `engines`-Angabe in `package.json` ist bereits jetzt unzutreffend (Q6).

---

## 2. Ist-Analyse: wie „Polyglot" heute funktioniert

### 2.1 Schichten

```
EcosystemFactory ──► EcosystemStrategy (npm | maven)
                       ├─ discovery : ModuleDiscoveryPort   (discover, findRoot?)
                       ├─ registry  : RegistryPort          (resolveEndpoint, getLatestVersion, getAllVersions)
                       ├─ reader    : DependencyReaderPort  (scan, scanMany?)
                       ├─ updater   : DependencyUpdaterPort (affectedFiles, applyUpdates, resync)
                       └─ verifier  : VerificationPort      (verify)

application/update-workflow.ts : Snapshot → (Baseline-Verify) → apply → Integrität → Verify → Rollback bei Fehler
application/scan.ts, update-selection.ts, version-lookup.ts : von TUI, CLI und MCP gemeinsam genutzt
domain/origin.ts : workspace | private | public  (Dependency-Confusion-Schutz)
```

Der Kern (`update-workflow`, `FileSnapshot`, `origin`, `scan`) ist bereits ecosystem-neutral. Maven hat gezeigt, dass das Modell auch ein Ökosystem trägt, in dem die Version nicht im Modul-Manifest steht (`VersionDeclaration`, `affectedFiles`, `aggregatorDir`).

### 2.2 Kopplungspunkte (hier ist `'npm' | 'maven'` hart verdrahtet)

| Datei | Heute | Änderung für Cargo |
| :--- | :--- | :--- |
| `domain/models.ts` | `Ecosystem = 'npm' \| 'maven'` | `+ 'cargo'`; Kommentare zu `aggregatorDir`, `scope` verallgemeinern; `DependencyCoordinate.registry?`; `SkipReason + 'incompatible-rust-version'` |
| `domain/ecosystem-factory.ts` | `if maven … else npm`; `['npm','maven']` | dritter Zweig, `getAvailableEcosystems()` |
| `domain/ecosystem-strategy.ts` | – | **Neu (Phase 0):** `versioning: VersionPolicy` und `parseIdentifier()` (siehe unten) |
| `app.tsx` | `ecosystem === 'npm' ? 'maven' : 'npm'` (2×) | durch Rotation über `getAvailableEcosystems()` ersetzen |
| `hooks/use-packages.ts` Z. 110, 119 | `ecosystem === 'maven'/'npm'` für Ziel-Normalisierung und `newRange` | über `strategy.versioning` |
| `application/update-selection.ts` Z. 58, 94, 111, 125, 140 | Maven-/npm-Sonderfälle, `manualNpmCandidate` | über `strategy.versioning`; Cargo verhält sich wie Maven (nur gescannte Deklarationen sind schreibbar) |
| `application/version-lookup.ts` | `coordinateFromIdentifier`: Maven vs. „alles andere" | `strategy.parseIdentifier()`; für Cargo optional `registry` |
| `domain/origin.ts` | `matchesInternalScope`: Maven-Zweig, sonst npm-Regeln; `ecosystem === 'npm' && scopedRegistries` | Cargo nutzt die npm-Namensregeln (exakt / `prefix*`); explizite `registry = "x"` setzt der Cargo-Scanner selbst als `scoped-registry` |
| `cli/parser.ts` Z. 10, 71, 74, 119 | `val === 'npm' \|\| val === 'maven'` | aus Factory ableiten, Hilfetext |
| `cli/command-versions.ts` Z. 21 | `':'` ⇒ Maven, sonst npm | Cargo-Namen sind von npm-Namen nicht unterscheidbar ⇒ `--ecosystem=cargo` explizit |
| `mcp/mcp-server.ts` Z. 26, 50, 98, 175 | `enum: ['npm','maven']`, Cast | Enum aus Factory, Beschreibungen |
| `components/mascot.tsx`, `i18n/*` | `mavenChirps` | `cargoChirps` (en/de) |
| `README.md`, `docs/en.md`, `docs/de.md`, `CHANGELOG.md`, `package.json` (keywords), `cli/command-init.ts` | npm/Maven | Cargo ergänzen (Phase 3) |

`config.findRepositoryRoot` iteriert bereits über `getAvailableEcosystems()` und braucht **keine** Änderung — Cargo liefert nur `discovery.findRoot`.

**Phase-0-Refactoring (verhaltenserhaltend).** Die Versionslogik pro Ökosystem steckt heute in mindestens drei Aufrufstellen als `if (ecosystem === …)`. Ein drittes Ökosystem würde jede davon verdoppeln. Vorschlag:

```ts
interface VersionPolicy {
  /** Zielversion → vergleichbare SemVer-Zahl (npm: semver.valid, Maven: cleanJavaVersion, Cargo: semver.valid) */
  normalize(version: string): string | null;
  /** Schreibweise der neuen Anforderung aus alter Anforderung + Zielversion */
  rewrite(currentRange: string, target: string): string;
  /** patch | minor | major — Cargo zählt 0.x-Minor als „major" (breaking) */
  diff(current: string, target: string): VersionDiff;
  /** Dürfen Pakete ohne anstehendes Update manuell auf eine Version gesetzt werden? (nur npm) */
  readonly allowsManualTargets: boolean;
}
```

Alle bestehenden Tests müssen danach unverändert grün sein. Das ist der risikoärmste erste Schritt und nützt auch ohne Cargo.

---

## 3. Recherche: wie Cargo sich tatsächlich verhält

### 3.1 Verifiziert (selbst ausgeführt, Cargo 1.97.0)

Testaufbau: virtueller Workspace mit Members `a`, `b`, `c`; Vererbung über `[workspace.dependencies]`; Umbenennung (`sj = { package = "serde_json" }`); `[target.'cfg(unix)'.dependencies]`; Dev-/Build-Deps; Path-Dep mit `version`; Git-Dep; Alt-Registry. Befehle in Anhang A.

| # | Befund | Konsequenz für Elevate |
| :-- | :--- | :--- |
| 1 | `cargo metadata --no-deps --format-version 1` läuft **ohne Netz**, **ohne Cargo.lock** und legt keine an. Es löst `workspace = true` auf (`serde = { workspace = true }` ⇒ `req: "^1.0.100"`). Pro Dependency: `name`, `req` (normalisiert: `"1"` ⇒ `^1`, `'0.4.10'` ⇒ `^0.4.10`), `kind` (`null`/`dev`/`build`), `rename`, `source` (`registry+https://github.com/rust-lang/crates.io-index`, `sparse+<url>`, `git+…`, `null` bei Path), `registry` (nur Alt-Registry), `path`, `target` (cfg-String), `optional`. Pro Package: `version` (auch aus `version.workspace = true`), `rust_version`, `manifest_path`, `publish`. | Beste Quelle für Discovery **und** Scan-Eingabe — kein TOML-Parsing der Semantik nötig. |
| 2 | Metadata liefert **nicht**, *wo* die Version steht (lokal vs. `workspace = true`) und **nicht** die Originalschreibweise (`"1"` und `"^1"` sind ununterscheidbar). | Für das Schreiben braucht es zusätzlich die TOML-Quelle (D3). |
| 3 | **Ein** Fehler bricht alles ab: eine Dependency mit unbekannter `registry = "corp"` ⇒ `cargo metadata` endet mit Exit 101 (`registry index was not found in any configuration: 'corp'`) — für den **ganzen** Workspace. | Discovery braucht eine definierte Fehlerpolitik (Abschnitt 5.2, Q3). |
| 4 | Path-Dep mit `version`, die die lokale Version nicht erfüllt, ist ein **harter Build-Fehler** (`failed to select a version for the requirement 'y = "^0.1.0"' … candidate versions found which didn't match: 0.2.0`). | Anders als npm gibt es hier **keinen** stillen Registry-Fallback. „Alignment" wird zur *Reparatur* eines kaputten Builds; der `integrityViolations`-Mechanismus ist nicht nötig, `cargo check` fängt es. |
| 5 | `cargo update --breaking` ist in 1.97 **weiterhin nightly-only** („unstable"). `cargo config get` ebenfalls. | Keine stabile CLI, um „Updates aufzulisten" oder „effektive Config zu lesen". |
| 6 | `cargo update --dry-run -v` meldet z. B. `Unchanged itoa v0.4.8 (available: v1.0.18)` — **Freitext**, nur die neueste Version, nur relativ zur Lock-Datei. `cargo info` ⇒ `version: 0.4.8 (latest 1.0.18)` (Freitext). `cargo add --dry-run` gibt nur die Anforderung aus. `cargo search` liefert nur die neueste Version und nutzt die Web-API. | Keines davon liefert die **vollständige Versionsliste**, die `[V]`, `elevate versions` und `channel: all` brauchen. |
| 7 | **`cargo add serde@1.0.200 -p a` hat `serde = { workspace = true }` durch `serde = "1.0.200"` ersetzt** — Vererbung und das geerbte `features = ["derive"]` gehen verloren. Außerdem lädt `cargo add` alle Quellen des Workspace und scheiterte hier an einer unerreichbaren Git-Dependency. | `cargo add` scheidet als Schreiber aus. |
| 8 | **Sparse-Index** (`https://index.crates.io`): Pfad `1/n`, `2/nn`, `3/n/nnn`, ab 4 Zeichen `ab/cd/name` (alles lowercase; falscher Pfad ⇒ 404). Eine JSON-Zeile je Version mit `name, vers, deps, cksum, features, yanked, rust_version, pubtime`. `config.json` = `{ "dl": …, "api": … }` (crates.io: kein `auth-required`). Header: `etag`, `cache-control: public,max-age=600`; bedingte Anfrage mit `If-None-Match` ⇒ **304** (mit Node-`fetch` bestätigt). | Liefert alles, was Elevate braucht, inkl. MSRV-Filter und Yank-Filter, mit einem Request pro Crate. |
| 9 | Kein Bindestrich/Unterstrich-Fuzzing: `serde-json = "1"` ⇒ Cargo meldet *„no matching package named `serde-json` … similar names: serde_json"*; der Index-Pfad `serde-json` ist 404. | Exakter Name genügt, keine Varianten-Suche. |
| 10 | Config: `.cargo/config.toml` wird aus **Elternverzeichnissen** des `cwd` gefunden; `include = ["extra.toml"]` funktioniert; Env-Override `CARGO_REGISTRIES_MY_CORP_INDEX` für Registry `my-corp` (Bindestrich ⇒ `_`, Großbuchstaben). **Source-Replacement ist in `cargo metadata` unsichtbar** (`source` bleibt `registry+…crates.io-index`, obwohl `replace-with` aktiv war). | Elevate muss `[source]`-Ersetzung und `[registries]` **selbst** aus der Config lesen (analog `NpmConfigReader`, nur ohne stabile CLI dafür). |
| 11 | **Lockfile-Rezept.** Nach Manifest-Edit `itoa 0.4` ⇒ `1.0.15` wählt `cargo check` die *neueste* passende Version (1.0.18), nicht die gewählte. `cargo update -p itoa --precise 1.0.15` **allein ignoriert** den Wunsch (der alte Lock-Eintrag passt nicht mehr, Cargo löst erst neu auf). Funktionierende Folge: ① `cargo update -p itoa` ② `cargo update -p itoa@1.0.18 --precise 1.0.15` ⇒ Lock = 1.0.15, danach besteht `cargo check --locked`. Ohne `Cargo.lock` erzeugt jedes `cargo check` eine neue. | Updater braucht einen Lock-Reader und diese Zwei-Schritt-Pinnung, damit „Targeted Version Selection" auch im Lockfile gilt (D1). |
| 12 | **TOML-Prototyp:** `toml-eslint-parser@1.0.3` liefert exakte Quell-Ranges für *alle* Deklarationsformen: `a = "1"`, `a = '0.4.10'`, Inline-Table, dotted keys (`a.version = "2.0"`, `a.workspace = true`), `[dependencies.a]`, `[target.'cfg(unix)'.dependencies]`, `[target."cfg(windows)".build-dependencies]`, `[workspace.dependencies]`. | Formatbewahrender Splice (Kommentare, Quotes, Einrückung, CRLF bleiben) ist machbar. |
| 13 | Node-`fetch` akzeptiert in 22.23 `NODE_USE_ENV_PROXY=1` (Warnung: *EnvHttpProxyAgent is experimental*). Die Sandbox leitet transparent weiter, daher ist **nicht belegt**, dass das Flag einen Proxy erzwingt. | Proxy-Unterstützung für HTTP-Lookups ist ein Spike in Phase 1 (D2, Risiko R2). |
| 14 | Engines laut `npm view`: `toml-eslint-parser@1.0.3` (über `eslint-visitor-keys@5`) `^20.19.0 \|\| ^22.13.0 \|\| >=24`; `undici@8` `>=22.19.0`; **bereits vorhandene** Abhängigkeiten: `@npmcli/map-workspaces@6.0.0` `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`, `vitest@5.0.3` (dev) `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`, `ink@6` `>=20`. Elevate deklariert `engines.node: >=20.0.0`. | Die deklarierte Untergrenze stimmt schon heute nicht (die Laufzeit-Abhängigkeit `@npmcli/map-workspaces` ist strenger). `toml-eslint-parser` ist weniger restriktiv ⇒ kein neuer Bruch durch Cargo (D7). `undici` nicht als Dependency. |

### 3.2 Nicht verifiziert (vor dem Phase-1-Gate prüfen)

Die Quellen waren gesperrt oder die Aussage stammt aus Suchergebnis-Auszügen bzw. Vorwissen.

1. **Index-Format-Details:** Bedeutung von `v`/`features2`, Verhalten bei unbekanntem `v` (Cargo Book *Registry Index*).
2. **Authentifizierung:** Suchauszüge des Cargo Book besagen: Cargo holt `config.json` zuerst, bei **401** wird mit Token wiederholt; Registries mit `auth-required: true` (seit Cargo 1.74) schützen auch Index und Downloads; Tokens kommen über Credential-Provider. Header-Format und Provider-Reihenfolge nicht gelesen.
3. **`[source.*]`-Schlüssel:** `replace-with` und `registry` habe ich nur akzeptiert gesehen (kein Fehler in `cargo metadata`); `directory`, `local-registry`, `git` und das Verhalten von `cargo vendor`-Ausgaben sind aus dem Gedächtnis.
4. **`cargo upgrade` (cargo-edit):** Suchauszüge nennen „bewahrt die Präzision der Anforderung" und „erhöht die Präzision standardmäßig nicht". Das ist die Vorlage für D1, aber nicht an der Quelle belegt.
5. **rustup:** ob `rust-toolchain.toml` eine fehlende Toolchain automatisch installiert (nach meiner Erinnerung seit rustup 1.28 nicht mehr).
6. **MSRV-Resolver:** `resolver.incompatible-rust-versions` (`allow`/`fallback`) und Defaults je Edition — nur das Index-Feld `rust_version` ist verifiziert.
7. **Windows:** `cargo.exe` direkt spawnbar vs. Batch; Verhalten von `runCommand` mit `+`/`@` in `-p name@1.0.0+meta`.
8. **GitHub-Runner:** ob Rust auf `ubuntu-latest`/`windows-latest` vorinstalliert ist (für Integrationstests).
9. **`cargo metadata` für ein Manifest *unter* einem Workspace-Root, das aber kein Member ist** (erwartet: Fehler) — nicht getestet; betrifft Fixture-Crates im Repo (CDISC-03).
10. **crates.io-Richtlinie** für direkte Index-Zugriffe (Rate-Limits, Pflicht-User-Agent). Die Web-API lieferte beim Test per `curl` 403; der Index nicht.

---

## 4. Designentscheidungen

### D1 — Update-Semantik

Cargo trennt zwei Ebenen, die npm so nicht trennt: die **Anforderung** in `Cargo.toml` (`serde = "1.0.100"` bedeutet `^1.0.100`) und die **gelockte Version** in `Cargo.lock`. Die Anforderung ist meist schon weit genug; das Lockfile entscheidet.

| Option | Beschreibung | Bewertung |
| :--- | :--- | :--- |
| **A** | npm-Parität: Anforderung anheben, **Präzision erhalten**. Kandidat nur, wenn sich der geschriebene String ändert. | Passt 1:1 auf `UpdateCandidate { currentRange → newRange }`, ist deterministisch und ohne Lockfile testbar. |
| B | Cargo-idiomatisch: kompatible Updates nur im Lockfile (`cargo update`), Manifest nur bei Breaking Changes. | „Richtiger" für Apps, aber ein anderes Datenmodell (Kandidat ohne Manifest-Änderung). |
| **C** | **A jetzt, B als Folgeausbau** | **Empfehlung** |

**Regeln für A:**

* Schreibbar sind nur einfache Anforderungen: **ein** Komparator, Operator bare/`^`/`~`/`=`. `*`, `1.*`, `>=1.2, <2` werden still ignoriert (wie `isUpgradableRange` bei npm) und unter „Scope and known limits" dokumentiert.
* **Präzision bleibt:** Zahl der Komponenten und Operator der alten Anforderung bleiben. `1` → `2`; `1.0` → `2.0`; `1.0.100` → `1.0.229`; `0.4` → `0.5`; `~1.8.0` → `~1.9.2`.
* Folge: Lockere Anforderungen (`"1"`) zeigen nur *Breaking* Updates. Voll angegebene (`"1.0.100"`) zeigen auch kompatible („Floor-Bump"). Das spiegelt Cargos Konvention, dass Bibliotheken lockere Minima behalten.
* **Diff-Klassifikation nach Cargo-Semantik:** Die Grenze „Breaking" liegt an der ersten Komponente ≠ 0. `1.2.3→1.2.4` patch, `→1.3.0` minor, `→2.0.0` major; **`0.4.2→0.4.3` minor, `0.4.2→0.5.0` major, `0.0.3→0.0.4` major.** `semver.diff` würde `0.4→0.5` nur „minor" nennen und es damit vorselektieren — das wäre für Cargo falsch.
* **Wichtig:** Node-`semver` interpretiert `1.2.3` als **exakt**, Cargo als `^1.2.3`. Eine eigene Übersetzung (`bare ⇒ ^`, Kommas ⇒ Leerzeichen) vor jedem `semver`-Aufruf ist Pflicht; sie gehört mit Tabellentest abgesichert (CREQ).
* Eine Crate, die in mehreren Abschnitten desselben Manifests steht (`[dependencies]` + `[dev-dependencies]`), ist **ein** Kandidat; die neue Anforderung geht in **alle** Deklarationen (npm-Parität, siehe `DEPENDENCY_SECTIONS`). Abweichende Alt-Anforderungen sind ein Grenzfall (R6).

### D2 — Versionsquelle und Registry-Zugriff

| Option | Vorteile | Nachteile |
| :--- | :--- | :--- |
| **A. Sparse-Index direkt (HTTP)** + Config-Reader | Vollständige Liste, `yanked`, `rust_version`, `pubtime`; 1 Request/Crate; offline testbar mit Fake-`fetch`; kein Cargo-Start pro Crate | Config-Reader nötig (Befund 10); Proxy/CA-Fragen; keine Auth |
| B. Cargo-delegiert (`cargo update -v`, `cargo info`) | Config, Mirror, Proxy, Auth „gratis" | Nur neueste Version, Freitext-Parsing (instabile Schnittstelle), keine Liste für `[V]`/`versions`, kein `channel: all` |
| **C. Hybrid** | A als Primärweg; B als Fallback für Auth-/Sonder-Registries (nur „latest") | **Empfehlung**, gestaffelt: v1 = A, v1.1 = B-Fallback |

**Begründung:** Elevates UX (`[V]`-Picker, `elevate versions`, Release-Channels, Yank-/MSRV-Schutz) *braucht* die Versionsliste, und Befund 6 zeigt, dass Cargo sie nicht stabil herausgibt. Die README-Zusage „Elevate never handles credentials" bleibt gewahrt, indem **authentifizierte Registries abgelehnt** statt bedient werden.

**Config-Reader (`cargo-config.ts`) — bewusst schmal:**

* Dateien: `.cargo/config.toml` (und Legacy `config` ohne Endung) vom Workspace-Root aufwärts bis Dateisystem-Root, dann `$CARGO_HOME/config.toml` (Default `~/.cargo`); tiefere Dateien gewinnen; `include` wird aufgelöst (Befund 10).
* Gelesen werden nur: `[registries.<name>].index`, `[registry].default`, `[source.crates-io].replace-with`, `[source.<name>].registry`; dazu Env `CARGO_REGISTRIES_<NAME>_INDEX`, `CARGO_REGISTRY_DEFAULT`, `CARGO_SOURCE_*`.
* **Fail-closed:** Ist eine Quelle ersetzt durch etwas, das der Reader nicht versteht (`directory`, `local-registry`, `git`), wird die Abfrage **verweigert** (`lookup-failed` mit Begründung) und **niemals** stillschweigend auf crates.io umgeleitet — eine Spiegel-Policy (Air-Gap) darf nicht umgangen werden. Das ist dieselbe Haltung wie `private-on-public-registry`.
* `isPublic`: Host ∈ {`index.crates.io`, `static.crates.io`, `crates.io`, `github.com/rust-lang/crates.io-index`} — analog `PUBLIC_NPM_HOSTS`.

**Index-Client (`cargo-index.ts`):** Pfadregeln (Befund 8), `User-Agent: elevate/<version> (+https://github.com/DennisRepa/Elevate)`, Zeilen-JSON tolerant parsen (unbekannte Felder ignorieren), In-Memory-Memo je Scan-Lauf (Concurrency 6, wie `mapPooled` im npm-Scanner), `401/403` ⇒ „Registry verlangt Authentifizierung; Elevate verarbeitet keine Zugangsdaten", `404` ⇒ Crate unbekannt. ETag-Cache ist für v1 nicht nötig.

### D3 — Schreiben von `Cargo.toml`

`cargo add` ist durch Befund 7 ausgeschlossen. Stattdessen, nach Vorbild `maven-pom.ts` + `applyTextEdits` (`shared/xml.ts`):

* `toml-eslint-parser` liefert Ranges (Befund 12). Ersetzt wird **nur der Inhalt zwischen den Anführungszeichen** der Versions-Literals; Quote-Stil, Kommentare, Einrückung, Zeilenenden bleiben bytegleich.
* Jede Änderung prüft `expected` (aktueller Wert des Literals), sonst `StaleEditError` ⇒ `InstallError` — wie bei Maven.
* Alle Edits werden **vor dem ersten Schreiben** berechnet (kein halb geschriebener Zustand).
* `applyTextEdits` ist an `XmlElement` gebunden. Vorschlag: generische `applyRangeEdits(source, [{start,end,expected,replacement}])` nach `adapters/shared/text-edit.ts` extrahieren; die XML-Variante ruft sie auf.

### D4 — Aufruf von Cargo

* `cargo` aus dem `PATH` (rustup-Proxy), `cwd` = Workspace-Root (`module.aggregatorDir`), **keine absoluten Pfade als Argumente** (Windows-Regeln aus `process.ts`/`WIN`).
* `CargoUnavailableError` analog `MavenUnavailableError`: fehlt `cargo`, schlagen Scans fehl mit klarer Meldung, statt zu raten. Verfügbarkeitsprüfung einmal pro Prozess (`cargo --version`).
* `cargoErrors(output)` analog `mavenErrors`: Zeilen ab `error`/`error[E…]` für kurze Fehlermeldungen.
* `cargo metadata` immer mit `--no-deps --format-version 1` (netzfrei, Befund 1).

### D5 — Discovery

* **Baum-Scan** nach `Cargo.toml` mit Ausschlüssen wie Maven: `target`, `node_modules`, `vendor`, `dist`, `build`, `out`, versteckte Ordner und alles unterhalb eines `src`-Ordners.
* Flachste Manifeste zuerst; je Manifest `cargo metadata --no-deps` (`cwd` = Manifest-Ordner). Alle `workspace_members` werden Module; deren Manifeste gelten als abgedeckt und werden übersprungen (ein Metadata-Aufruf je Workspace statt je Crate).
* `ProjectModule`: `id = name`, `path` = Manifest-Ordner, `relPath` relativ zum Repo-Root (`Root` falls identisch), `version` (aus Metadata), `aggregatorDir = workspace_root`, `isRoot` = Modul liegt im Repo-Root. Ein virtueller Workspace hat **kein** Root-Modul.
* `findRoot(startDir, boundary)`: nächstes Elternverzeichnis (bis `boundary`), dessen `Cargo.toml` `[workspace]` enthält; sonst nächstes mit `Cargo.toml`. Der äußerste Vorschlag aller Ökosysteme gewinnt weiterhin (ROOT-Regeln).
* Gemischte Repos (Tauri: `package.json` im Root, Rust unter `src-tauri/`) sind der wichtigste Praxisfall für „Polyglot" — daher kein Root-only.

### D6 — Verifikation

* Standard: `cargo check --all-targets -p <geänderte Member> -p <abhängige Member>`; abhängige = Rückwärts-Closure über Path-Dependencies im Workspace (Analogon zu Mavens `-pl … -amd`).
* Ändert sich `Cargo.lock` oder das **Root**-Manifest (`[workspace.dependencies]`), wird `--workspace` geprüft (Analogon zu „Aggregator-POM geändert").
* `--locked` nur, wenn vor dem Update eine `Cargo.lock` existierte (sonst schlägt es zwingend fehl) — es fängt unvollständiges Lock-Handling im Updater.
* `cargo check --all-targets` ist das Analogon zu `mvn test-compile`: typprüft Tests, Benches und Beispiele, ohne Codegen. Doctests, Features außer Default und Cross-Targets deckt es **nicht** ab ⇒ `postUpdateScript` bleibt der Weg für mehr.
* Label: `Cargo build (cargo check --all-targets -p a -p c)`; Timeout 30 min wie Maven; `postUpdateScript` läuft im Workspace-Root.
* Hinweis: Die Baseline-Verifikation vor dem Update (bestehende Workflow-Regel) bedeutet beim ersten Lauf einen **vollen Kaltstart-Compile**.

### D7 — Abhängigkeiten und Engines

* Neu: `toml-eslint-parser@^1.0.3` (MIT, 86 kB, 1 Dependency). Läuft in `esbuild`-Bundle/SEA-Binary vermutlich ohne Sonderbehandlung (reines JS) — in Phase 1 prüfen (R12).
* **Engines:** Cargo erzwingt keine Anhebung, weil die bestehende Abhängigkeit `@npmcli/map-workspaces@6` schon strenger ist als `engines.node: >=20.0.0` (Befund 14). Empfehlung, **getrennt vom Cargo-Thema**: `engines` auf die tatsächliche Untergrenze der Abhängigkeiten korrigieren (Frage Q6). Der Plan setzt das nicht voraus.
* `undici` wird **nicht** aufgenommen (Befund 14). Für Proxys zuerst Spike mit `http.setGlobalProxyFromEnv()` / `NODE_USE_ENV_PROXY` (Befund 13); Rückfall: dokumentierte Einschränkung.

### D8 — Abbildung auf das Modell

| Cargo | Elevate |
| :--- | :--- |
| `[dependencies]`, `[build-dependencies]` | `scope: 'prod'` (Tab „Dependencies") |
| `[dev-dependencies]` | `scope: 'dev'` (Tab „Dev") |
| `[target.'cfg(…)'.…]` | wie Art; Zusatzinfo in `qualifier` (z. B. `build`, `cfg(unix)`) |
| `workspace = true` | `declaration { file: Root-Cargo.toml, kind: 'dependency-management' }`; `sharedWith` = andere Member, die erben |
| Path-Dep auf Member | `origin: workspace`; `version`-Literal ⇒ `action: 'align'` |
| `registry = "x"` | `origin: private`, `matchedBy: 'scoped-registry'`, `registry: <Index-URL>` |
| Name passt auf `internalScopes` | `private`, `internal-scope`; löst Cargo auf crates.io auf ⇒ `private-on-public-registry` (bestehende Regel) |
| Git-Dep, Path-Dep außerhalb des Repos | wie npm: still ignoriert |
| Workspace-Member mit gleichem Namen wie eine Registry-Crate | Herkunft entscheidet `source`/`path` aus Metadata, **nicht** der Name (anders als `classifyOrigin` bei npm) |

---

## 5. Zielarchitektur

### 5.1 Neue Dateien (`src/adapters/cargo/`)

| Datei | Verantwortung | ~Zeilen |
| :--- | :--- | ---: |
| `cargo-command.ts` | `runCargo`, `CargoUnavailableError`, `cargoErrors`, Umgebungs-Hygiene (`CARGO_TERM_COLOR=never`) | 90 |
| `cargo-metadata.ts` | `cargo metadata --no-deps` ausführen, Typen, `CargoMetadataError`, Memo je Workspace | 130 |
| `cargo-toml.ts` | TOML-Modell mit Ranges: Tabellen (`dependencies`/`dev-dependencies`/`build-dependencies`/`target.*`/`workspace.dependencies`, auch Unterstrich-Schreibweisen), Deklarationsformen | 220 |
| `cargo-locator.ts` | Findet je Dependency das Versions-Literal inkl. `workspace = true` ⇒ Root; Kreuzprüfung gegen Metadata-`req` (Mismatch ⇒ `declaration-mismatch`) | 200 |
| `cargo-requirement.ts` | Cargo-Anforderung ⇄ semver-Range, Präzisions-Rewrite, `diff` nach Cargo-Semantik, `VersionPolicy` | 150 |
| `cargo-discovery.ts` | `findRoot`, Baum-Scan, Dedupe nach Workspace, Fehlerpolitik | 160 |
| `cargo-config.ts` | schmaler Config-Reader (D2), fail-closed | 200 |
| `cargo-index.ts` | Sparse-Index-Client (Pfad, Parser, Statusbehandlung, Memo) | 170 |
| `cargo-registry.ts` | `RegistryPort`: Channel-/Yank-/MSRV-Auswahl, `resolveEndpoint` | 120 |
| `cargo-scanner.ts` | `DependencyReaderPort`: Herkunft, Alignment, Kandidaten, `scanMany` | 260 |
| `cargo-lockfile.ts` | `Cargo.lock` lesen (`[[package]]` name/version/source) | 70 |
| `cargo-updater.ts` | `affectedFiles`, Edits, Lock-Refresh + Pinnung, `resync` (No-op) | 200 |
| `cargo-verifier.ts` | `planBuild` + Ausführung, `postUpdateScript` | 120 |
| `cargo-strategy.ts` | `CargoEcosystemStrategy` (`🦀`, „Rust / Cargo", `Cargo.toml`) | 45 |
| `shared/text-edit.ts` | generische Range-Edits (aus `xml.ts` extrahiert) | 60 |

Summe ≈ 2.000 Zeilen (Maven-Adapter: ≈ 1.870).

### 5.2 Abläufe

**Discovery** — Baum-Scan ⇒ pro Workspace *ein* `cargo metadata --no-deps`. **Fehlerpolitik** (Befund 3): Scheitert ein Workspace (unbekannte Registry, Syntaxfehler), werden die übrigen weiter angeboten; der Fehler muss sichtbar werden. Der Port hat dafür keinen Kanal (`discover(): Promise<ProjectModule[]>`) — Vorschlag in Q3.

**Scan (je Modul)**
1. Metadata (gecacht je Workspace) ⇒ Package ⇒ `dependencies[]`.
2. Je Dependency: Herkunft aus `source`/`path`/`registry` (D8); Git und externe Paths überspringen.
3. Path-Dep auf Member mit `version`-Literal, das die lokale Version nicht erfüllt ⇒ Alignment-Kandidat.
4. Registry-Dep: Endpoint auflösen; `private` + öffentlicher Endpoint ⇒ **nicht abfragen** (`private-on-public-registry`). Sonst Index lesen ⇒ neueste Version nach Channel, ohne `yanked`, MSRV-gefiltert (siehe unten).
5. Anforderung → Rewrite mit Präzisionserhalt (D1); Kandidat nur bei geändertem String.
6. Locator findet das Literal; Kreuzprüfung gegen `req`.
7. Sortieren wie beim npm-Scanner (major, minor, patch).

**MSRV:** Deklariert das Member `rust-version`, wird die neueste Version gewählt, deren Index-`rust_version` ≤ Member-MSRV ist. Existiert eine neuere, aber zu neue Version, entsteht kein Kandidat darauf, sondern `skipped: incompatible-rust-version` mit der Zielversion im `detail` — sichtbar statt stillschweigend veraltet.

**Update (`applyUpdates`)**
1. Edits aller betroffenen Dateien berechnen (Member-Manifest, ggf. Root-Manifest), erst dann schreiben.
2. Existiert `Cargo.lock`: je geänderter Crate `cargo update -p <name>[@<alt-gelockt>]`; liegt die gewählte Zielversion unter der neuesten passenden, danach `cargo update -p <name>@<neu-gelockt> --precise <ziel>` (Befund 11). Bei mehreren gelockten Versionen derselben Crate immer mit `name@version` spezifizieren.
3. Existierte **keine** `Cargo.lock`, wird keine zurückgelassen (der Snapshot bewahrt „nicht vorhanden").
4. `affectedFiles`: Member-Manifest, Root-Manifest (bei Vererbung), `Cargo.lock`. `target/` ist Cache und gehört nicht dazu.
5. `resync`: No-op (wie Maven) — nach Rollback sind Manifeste und Lock wiederhergestellt.
6. `auditMessage`: „N Anforderung(en) in M Cargo.toml aktualisiert; Cargo.lock aktualisiert." (`clean`). Ein `cargo audit`-Hook ist Backlog.

---

## 6. Änderungen am bestehenden Code (Checkliste)

* [ ] **Phase 0:** `VersionPolicy`/`parseIdentifier` in `EcosystemStrategy`; npm- und Maven-Strategien implementieren sie; `use-packages.ts`, `update-selection.ts`, `version-lookup.ts` umstellen. Tests unverändert grün.
* [ ] `Ecosystem` um `'cargo'` erweitern; `getAvailableEcosystems()`; Factory-Zweig.
* [ ] `app.tsx`: `[E]` rotiert durch alle Ökosysteme; Header-Hinweis zeigt das nächste.
* [ ] `parser.ts`, `mcp-server.ts`, `command-*.ts`: Ökosysteme aus der Factory, Hilfetexte, MCP-Beschreibungen (außerdem steht dort `version: '1.2.0'` statt 1.3.0).
* [ ] `models.ts`: `DependencyCoordinate.registry?`, `UpdateCandidate.qualifier?`, `SkipReason + 'incompatible-rust-version'`, Doku von `aggregatorDir`/`scope`/`sharedWith`.
* [ ] `describe.ts`: Text für den neuen `SkipReason`.
* [ ] `scan.ts#candidateToJson`: `qualifier`, bei Vererbung `declaredIn` = Root-Manifest.
* [ ] i18n (en/de): `cargoChirps`, Typ in `i18n/types.ts`; `mascot.tsx`.
* [ ] `package.json`: Keywords `cargo`, `rust`; neue Dependency; Beschreibung. (`engines`: siehe Q6, nicht Teil des Cargo-Umfangs.)
* [ ] `README.md`: Tabelle „Supported Package Managers", Shortcut `E`, „Scope and known limits"; `docs/en.md`, `docs/de.md`; `CHANGELOG.md` unter *Unreleased*; Agent-Anleitung in `command-init.ts`.
* [ ] `specs/README.md`: neue Präfixe und „Implementation contract".

---

## 7. Phasen und Abnahmekriterien

| Phase | Inhalt | Abnahme | Aufwand |
| :--- | :--- | :--- | :--- |
| **0** Refactoring | `VersionPolicy`, `parseIdentifier`, Ecosystem-Liste aus Factory, `text-edit.ts` extrahieren | `npm test` und `npm run typecheck` unverändert grün; keine Verhaltensänderung | 1–2 Tage |
| **1** Lesen | `command`, `metadata`, `toml`, `locator`, `requirement`, `discovery`, `config`, `index`, `registry`, `scanner`, `strategy`; CLI `modules`/`scan`/`versions` mit `--ecosystem=cargo` | Specs CDISC/CREQ/CDECL/CREG grün; `elevate scan --ecosystem=cargo --json` auf dem Testworkspace aus Anhang A liefert die Kandidaten aus Anhang B; **Spikes:** Bundle/SEA mit `toml-eslint-parser`, Proxy-Verhalten, Abschnitt 3.2 Nr. 1–3 | 4–5 Tage |
| **2** Schreiben | `lockfile`, `updater`, `verifier`; CLI `update`, MCP, TUI-Anbindung | Specs CUPD/CVER grün; Rollback-Test (Cargo.toml **und** Cargo.lock bytegleich); Integrationstest mit echtem Cargo gegen `itoa`/`log` | 4–5 Tage |
| **3** Politur | Tab-Labels, `qualifier`/Shared-Hinweis in der Zeile, Maskottchen, i18n, Docs en/de, README, CHANGELOG, `init`-Text | Doku-Review; manueller Lauf der TUI auf einem Tauri-artigen Mischrepo | 2 Tage |
| **4** Backlog | siehe Abschnitt 10 | – | offen |

Phase 0 kann unabhängig und sofort gemergt werden.

---

## 8. Teststrategie

Der Repo-Konvention folgend: Gherkin-Specs mit IDs, Tests tragen die ID am Titelanfang, Unit-Tests laufen offline, Integrationstests mit echten Tools getrennt.

**Test-Grenzen.** Prozess-Grenze wie in `package-manager.test.ts` (`vi.mock('…/process.js')`); HTTP-Grenze durch einen **injizierbaren `fetch`** im Index-Client (Fake liefert NDJSON-Fixtures). `makeTree` für Bäume; neue Helfer `cargoToml(body)` und `cargoModule(path, name)`.

**Fixtures.**
* `test/fixtures/cargo-workspace/` — der Testworkspace aus Anhang A (virtuell, Vererbung, Rename, Target, Path-Dep mit Versionskonflikt, Alt-Registry mit `.cargo/config.toml`).
* `test/fixtures/cargo-metadata/*.json` — echte `cargo metadata`-Ausgaben (mit Cargo 1.97 erzeugt) für Parser-Tests ohne Cargo.
* Index-Antworten als kleine NDJSON-Dateien (`itoa`, `log`, mit `yanked`, Pre-Release, hoher `rust_version`).

**Spec-Katalog (Vorschlag).**

| Datei | Präfix | Szenarien |
| :--- | :--- | :--- |
| `11-cargo-discovery.feature` | `CDISC` | 01 virtueller Workspace (Glob-Members, kein Root-Modul) · 02 Root-Package + Workspace · 03 `exclude` und Nicht-Member unter dem Root · 04 Einzelprojekt ohne `[workspace]` · 05 Rust-Workspace unter Nicht-Rust-Root, zwei unabhängige Workspaces · 06 `target`, `node_modules`, `vendor`, versteckte Ordner, `src/` werden ignoriert · 07 `version.workspace = true` · 08 `findRoot` (nächstes `[workspace]`; äußerster Vorschlag gewinnt) · 09 unbekannte Registry ⇒ klare Meldung, andere Workspaces bleiben · 10 `cargo` fehlt ⇒ `CargoUnavailableError`, kein Prozess |
| `12-cargo-requirements.feature` | `CREQ` | 01 bare = Caret · 02 Präzisions-Rewrite (Tabelle) · 03 Operator bleibt · 04 `*`/`1.*`/`>=1.2, <2` ignoriert · 05 kompatibles Latest bei lockerer Anforderung ⇒ kein Kandidat · 06 `0.x`-Klassifikation (Tabelle) · 07 Pre-Release nur bei `channel: all`, `yanked` nie · 08 MSRV: zu neue Version ⇒ `incompatible-rust-version` |
| `13-cargo-declarations.feature` | `CDECL` | 01–08 je Deklarationsform (bare, Literal-Quotes, Inline-Table, dotted, `[dependencies.x]`, Target-Tabelle, Dev/Build, Rename-Key) · 09 Vererbung ⇒ Root-Literal, `sharedWith` · 10 gleiche Crate in mehreren Abschnitten · 11 Literal ≠ Metadata-`req` ⇒ `declaration-mismatch` |
| `14-cargo-registry.feature` | `CREG` | 01 Index-Pfade (Tabelle 1/2/3/≥4 Zeichen) · 02 Yank-/Channel-Filter · 03 Crate mit `registry =` nur dort abgefragt, **nie** crates.io (kein Request dorthin) · 04 `internalScopes`-Treffer auf crates.io ⇒ `private-on-public-registry` · 05 Source-Replacement wird befolgt; unbekannte Ersetzungsart ⇒ verweigert, **kein** Request · 06 401 ⇒ `lookup-failed`, es wird kein Token gesendet · 07 Config-Auflösung (Eltern, `CARGO_HOME`, `include`, Env-Vorrang) · 08 404 |
| `15-cargo-update.feature` | `CUPD` | 01 nur der Versionstext ändert sich (Kommentare, Quotes, CRLF bytegleich) · 02 Vererbung: Root-Literal geändert, Member unberührt, `affectedFiles` enthält Root · 03 veraltetes Literal ⇒ `InstallError`, nichts geschrieben · 04 Lock-Refresh (Befehlsfolge am Fake geprüft), Pinnung bei Zielversion < neueste · 05 ohne Cargo.lock wird keine angelegt · 06 Fehler in `cargo update` ⇒ Rollback von Manifest + Lock · 07 Alignment erhält Präzision |
| `16-cargo-verification.feature` | `CVER` | 01 Plan: geänderter Member + Rückwärts-Abhängige · 02 Root-Manifest/Lock geändert ⇒ `--workspace` · 03 `--locked` nur mit vorhandener Lock · 04 `postUpdateScript` im Workspace-Root · 05 Fehlermeldung aus `error`-Zeilen · 06 vorbestehender Fehlschlag bleibt erhalten (bestehende Workflow-Regel) |

**Integration** (`test/integration/cargo-workflow.test.ts`, echtes Cargo + crates.io, getrennt wie `workflow.test.ts`): Scan → Update → `cargo check --locked` → Rollback-Bytevergleich auf einem Mini-Workspace mit `itoa`/`log`.

**CI.** `ci.yml` führt weder Integrationstests noch Rust aus; Unit-Tests brauchen Cargo nicht (Prozess-Grenze gefälscht). Integrationstests wie bisher manuell. Ob Rust auf den gehosteten Runnern vorinstalliert ist, ist nicht verifiziert (3.2 Nr. 8).

---

## 9. Risiken und offene Fragen

| # | Risiko | Gegenmaßnahme |
| :-- | :--- | :--- |
| R1 | **Config-Reader driftet von Cargo ab** (Vorrang, `include`, Env, Ersetzung) | Schmaler Funktionsumfang, **fail-closed**, Specs CREG-05/07; Integrationstest vergleicht Verhalten mit echtem Cargo |
| R2 | **Proxy/CA/Auth im Firmennetz** — Node-`fetch` kennt Cargos `http.proxy`/`http.cainfo` nicht | Spike in Phase 1; dokumentierte Einschränkung; B-Fallback (v1.1). Auth in v1 nicht unterstützt |
| R3 | **Build-Skripte führen neuen Code aus.** `cargo check` kompiliert und startet `build.rs` und Proc-Macros der *neuen* Version — dieselbe Risikoklasse wie npm-Install-Skripte | In Docs benennen; `--locked`; Review vor Merge; langfristig Option „nur Manifest/Lock, keine Verifikation" (`--skip-verification` existiert) |
| R4 | **Kaltstart-Compile** (Baseline + Verifikation) dauert Minuten und füllt `target/` | 30-min-Timeout, Doku-Hinweis, `postUpdateScript` als Alternative |
| R5 | **Toolchain:** `rust-toolchain.toml` kann rustup zu Downloads veranlassen/scheitern lassen | Fehlertext von Cargo durchreichen; Doku (3.2 Nr. 5) |
| R6 | **Mehrere Lock-Versionen derselben Crate** (`itoa 0.4.8` + `1.0.x`) machen `-p itoa` mehrdeutig; gleiche Crate mit abweichenden Anforderungen in mehreren Abschnitten | Immer `name@version` aus dem Lock-Reader; Spec-Fälle CUPD-04 und CDECL-10 |
| R7 | **Modul-`id`-Kollision** zwischen unabhängigen Workspaces (`utils` ×2) | Kollision ⇒ Suffix `name (relPath)`; Herkunftsprüfung läuft über Pfad, nicht Namen |
| R8 | **Feature-Unifikation:** `-p`-Check kann anders ausfallen als `--workspace` | Dokumentieren; Root-/Lock-Änderung ⇒ Workspace-Check (D6) |
| R9 | **Windows:** `+`/`@` in `-p name@1.0.0+meta`, `cargo.exe`-Start | Spec WIN-Muster erweitern; Quoting-Regel prüfen (3.2 Nr. 7) |
| R10 | **`engines.node` ist bereits unzutreffend** (Befund 14); Nutzer auf Node 20 können die Installation schon heute nicht sicher betreiben | Unabhängig von Cargo korrigieren, Entscheidung Q6 |
| R11 | **Doku-Fakten unverifiziert** (3.2) | Gate vor Phase 1: Abschnitt 3.2 Nr. 1–3 an der Quelle prüfen |
| R12 | **SEA-Binary/Bundle** mit `toml-eslint-parser` | Spike in Phase 1 (`npm run build:bundle`) |
| R13 | Randfälle: `[patch]`/`[replace]`, `edition = "2024"`-Schreibweisen, `rust-version` aus `[workspace.package]` | Nicht angeboten bzw. durch Metadata gedeckt; Specs bei Bedarf |

**Offene Fragen an den Maintainer**

* **Q1 (D1):** Soll `"1"` auf Wunsch auch kompatible Updates zeigen (Floor-Bump auf `1.0.229`), etwa per Config `cargo.bumpLooseRequirements`? Default: nein.
* **Q2 (D2):** Ist ein direkter HTTP-Index-Client ohne Auth für v1 akzeptabel, oder soll Cargo von Anfang an die Abfragen übernehmen (dann ohne Versionsliste und ohne `[V]`)?
* **Q3:** Wie sollen Discovery-Fehler einzelner Workspaces sichtbar werden? Vorschlag: `ModuleDiscoveryPort.discover()` darf zusätzlich `diagnostics: string[]` liefern, die CLI auf stderr schreibt (wie `config.warnings`) und die TUI im Status zeigt.
* **Q4:** Soll `[E]` nur über Ökosysteme rotieren, die Module haben? (Heute rotiert es auch durch leere.)
* **Q5:** Gehören Lockfile-only-Updates (`cargo update -p`) in 1.x? Sie sind für Anwendungen mit committeter `Cargo.lock` der häufigste echte Update-Fall.
* **Q6 (unabhängig von Cargo):** `package.json` deklariert `node: >=20.0.0`, aber `@npmcli/map-workspaces@6.0.0` verlangt `^22.22.2 || ^24.15.0 || >=26.0.0`. Soll `engines` korrigiert werden — oder soll `map-workspaces` auf eine Version gepinnt werden, die Node 20 unterstützt? (Gefunden bei der Cargo-Recherche; Folge für Cargo: keine.)

---

## 10. Nicht-Ziele und Backlog

**Nicht in v1:** Authentifizierte Registries, Lockfile-only-Updates, `cargo audit`/`cargo deny`-Anbindung, `[patch]`/`[replace]`, Änderung von `rust-version`, Aktualisierung der Toolchain, Single-File-Skripte (`cargo -Zscript`), Vendoring-Quellen.

**Backlog (nach Wert):**
1. Lockfile-only-Tab (`cargo update -p`) mit eigener Kandidatenart.
2. Cargo-delegierter Fallback für Auth-/Sonder-Registries (`cargo update --dry-run -v` parsen, „latest only").
3. `cargo audit`-Zusammenfassung im Update-Report (wenn installiert).
4. Config-Abschnitt `cargo` (z. B. `verifyArgs`, `bumpLooseRequirements`).
5. Anzeige der gelockten Version neben der Anforderung.
6. ETag-Cache für den Index auf Platte.

---

## Anhang A — Verifikationsprotokoll (reproduzierbar)

### A.1 Testworkspace (Vorlage für `test/fixtures/cargo-workspace/`)

```toml
# Cargo.toml (Root, virtuell)
[workspace]
resolver = "2"
members = ["crates/*", "tools/c"]

[workspace.package]
version = "0.3.0"
edition = "2021"

[workspace.dependencies]
serde   = { version = "1.0.100", features = ["derive"] }   # inherited
rand = "0.8.0"
b = { path = "crates/b", version = "0.1.0" }

# .cargo/config.toml  (ohne diese Zeilen scheitert `cargo metadata`, Befund 3)
[registries.corp]
index = "sparse+https://corp.invalid/index/"

# crates/a/Cargo.toml
[package]
name = "a"
version.workspace = true
edition.workspace = true

[dependencies]
serde = { workspace = true }
rand.workspace = true
b = { workspace = true }
sj = { package = "serde_json", version = "1.0.0" }
itoa = "1"
log = '0.4.10'

[dev-dependencies]
tempfile = "3.0.0"

[build-dependencies]
cc = "1.0.0"

[target.'cfg(unix)'.dependencies]
libc = "0.2.100"

[target.'cfg(windows)'.dependencies]
winapi = { version = "0.3.0", optional = true }

# crates/b/Cargo.toml
[package]
name = "b"
version = "0.2.0"          # absichtlich != "0.1.0" im Root ⇒ Alignment-Fall
edition = "2021"
[dependencies]
fastrand = "~1.8.0"

# tools/c/Cargo.toml
[package]
name = "c"
version = "1.0.0"
edition = "2021"
[dependencies]
a = { path = "../../crates/a" }
b = { path = "../../crates/b", version = "0.1.0" }
private-thing = { version = "1.0", registry = "corp" }
gitdep = { git = "https://example.invalid/x.git", branch = "main" }
```

Jedes Member braucht zusätzlich eine `src/main.rs` (`fn main(){}`). Die Fixture für Unit-Tests muss `cargo metadata` **nicht** ausführen: dafür dient die gespeicherte Ausgabe in `test/fixtures/cargo-metadata/`.

### A.2 Befehle

```bash
cargo metadata --no-deps --format-version 1 --offline          # Befunde 1–3, 10
cargo check   # in Mini-Workspace mit path+version-Konflikt      # Befund 4
cargo update --help | grep breaking                              # Befund 5 ("unstable")
cargo config get registries                                      # Befund 5 (nightly only)
cargo update --dry-run -v ; cargo info itoa ; cargo search itoa  # Befund 6
cargo add serde@1.0.200 -p a                                     # Befund 7 (ersetzt workspace = true)
curl https://index.crates.io/config.json                         # Befund 8
curl -I https://index.crates.io/it/oa/itoa                       # Befund 8 (etag, cache-control)
cargo update -p itoa ; cargo update -p itoa@1.0.18 --precise 1.0.15 ; cargo check --locked   # Befund 11
CARGO_REGISTRIES_MY_CORP_INDEX=… cargo metadata --no-deps …      # Befund 10
npm i toml-eslint-parser@1.0.3 && node scan.mjs forms.toml       # Befund 12
npm view toml-eslint-parser@1.0.3 engines                        # Befund 14
npm view @npmcli/map-workspaces@6.0.0 engines                    # Befund 14 (bestehende Abhängigkeit)
```

## Anhang B — Erwartete Kandidaten für `crates/a` (Testworkspace)

Manifest (gekürzt) → Kandidat, sofern ein neueres Release existiert. `Literal` = Stelle, die der Updater ändert.

| Zeile in `crates/a/Cargo.toml` | Literal liegt in | Anforderung → Neu (Präzision erhalten) | Hinweis |
| :--- | :--- | :--- | :--- |
| `serde = { workspace = true }` | **Root** `[workspace.dependencies]` (`"1.0.100"`) | `1.0.100` → `1.0.x` | `sharedWith`: weitere erbende Member; `features` bleiben unangetastet |
| `rand.workspace = true` | Root (`"0.8.0"`) | `0.8.0` → neueste Version (0.x-Minor-Sprung = Breaking ⇒ `major`, nicht vorselektiert) | konkrete Zielversion hängt vom aktuellen Index ab |
| `b = { workspace = true }` | Root (`path` + `version = "0.1.0"`) | `0.1.0` → `0.2.0` (lokale Version von `b`) | `action: align`; ohne Fix bricht der Build (Befund 4) |
| `sj = { package = "serde_json", version = "1.0.0" }` | Member | `1.0.0` → `1.0.x` | Schlüssel `sj`, Crate `serde_json` |
| `itoa = "1"` | Member | `1` → `2`? nur falls Breaking-Release existiert, sonst **kein** Kandidat | lockere Anforderung (D1) |
| `log = '0.4.10'` | Member (Literal mit `'`) | `0.4.10` → `0.4.x` | Quote-Stil bleibt |
| `tempfile = "3.0.0"` (dev) | Member | `3.0.0` → `3.x.y` | `scope: dev` |
| `cc = "1.0.0"` (build) | Member | `1.0.0` → `1.x.y` | `scope: prod`, `qualifier: build` |
| `libc = "0.2.100"` (`cfg(unix)`) | Member | `0.2.100` → `0.2.x` | `qualifier: cfg(unix)` |
| `winapi` (`cfg(windows)`, optional) | Member | `0.3.0` → `0.3.9` | |
| `tools/c`: `private-thing = { registry = "corp" }` | Member | nur bei erreichbarer `corp`-Registry | `origin: private`; nie crates.io |
| `tools/c`: `gitdep = { git = … }` | – | – | still ignoriert |
