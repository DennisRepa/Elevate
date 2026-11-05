# Cargo — Plan für die offenen Punkte

> **Stand:** Branch `feat/cargo` (339 Tests grün). Basis ist `cargo-support.md`; hier steht nur, was noch fehlt, in Umsetzungsreihenfolge. Vorgehen wie bisher: erst Test (RED), dann Code (GREEN), je Paket ein Commit.

## Übersicht

| # | Paket | Typ | Aufwand | Blockiert Release? |
| :-- | :--- | :--- | :--- | :--- |
| 1 | Doku-Fakten an der Quelle prüfen (Plan 3.2) | Prüfung | 0,5 Tg | **ja** |
| 2 | Discovery-Diagnosen (Q3) | Port + CLI/TUI | 1 Tg | ja |
| 3 | Bundle/SEA, User-Agent, Proxy-Spike | Build/Netz | 1 Tg | ja |
| 4 | Integrationstest mit echtem Cargo | Test | 1 Tg | ja |
| 5 | Windows-Pfade und Quoting | Test | 0,5 Tg | ja |
| 6 | TUI: `qualifier`, `sharedWith` | UI | 1 Tg | nein |
| 7 | Specs `.feature` 11–16 | Spezifikation | 1 Tg | nein, aber vor Merge |
| 8 | Härtung bekannter Randfälle (R6, R7, Pfad-Abgleich) | Code | 1,5 Tg | teils |
| 9 | Lockfile-only-Updates (Q5) | Feature | 3–4 Tg | nein (v1.x) |
| 10 | `engines`-Inkonsistenz (Q6) | Entscheidung | 0,5 Tg | unabhängig |

Reihenfolge: 1 → 2 → 3 → 4 → 5 → 8 → 6 → 7 → Merge-Review → 9 als eigener Branch.

---

## 1. Doku-Fakten prüfen (Gate)

Die Cargo-Book-Seiten waren in der Recherche gesperrt. Folgende Annahmen stecken im Code und müssen belegt oder korrigiert werden:

| Annahme im Code | Wo | Prüfen gegen |
| :--- | :--- | :--- |
| `401`/`403` ⇒ Auth nötig, kein Token senden | `cargo-index.ts` | Registry Authentication, Registry Index |
| Index-Zeilen mit unbekanntem `v` ignorieren? (heute: werden gelesen) | `parseIndex` | Registry Index |
| `[source.*]`-Schlüssel `replace-with`, `registry`, `directory`, `local-registry`, `git`; Env-Namen `CARGO_SOURCE_<NAME>_…` | `cargo-config.ts` | Source Replacement, Config |
| Rangfolge: nächste Datei gewinnt, `include` niedriger als die einbindende Datei, `CARGO_HOME` zuletzt | `cargo-config.ts` | Config |
| `--precise` wird bei veraltetem Lock-Eintrag ignoriert (Zwei-Schritt-Rezept) | `cargo-updater.ts` | **bereits mit Cargo 1.97 belegt**; auf älteren Versionen prüfen |

**Ergebnis (Cargo 1.97, empirisch; die Doku-Hosts blieben gesperrt):**

| Annahme | Ergebnis |
| :--- | :--- |
| Nächste Config-Datei gewinnt, `CARGO_HOME` zuletzt | **belegt** (Elternverzeichnis-Reihenfolge inner > outer > `CARGO_HOME`) |
| `include` hat niedrigeren Vorrang als die einbindende Datei | **belegt** |
| `CARGO_REGISTRIES_<NAME>_INDEX` schlägt die Datei | **belegt** |
| `[source.*]` aus Datei: `replace-with` + `registry` | **belegt** (lokaler Server wurde angefragt); `directory` wird akzeptiert |
| `CARGO_SOURCE_*` als Umgebungsvariable | **widerlegt:** Cargo ignoriert sie (weder allein noch gegen die Datei wirksam). Code und Test korrigiert (CCFG-05), Doku bereinigt |
| `401`/`403` ⇒ Authentifizierung, kein Token senden | **offen** (kein lokaler Auth-Server; Verhalten nur aus Suchauszügen des Cargo Book) |
| Unbekanntes Index-Feld `v` | **offen**; der Parser liest weiterhin alle Zeilen |

Offene Zeilen bleiben als „nicht an der Quelle belegt" in `docs/en.md`/`docs/de.md` zu kennzeichnen, bis die Hosts freigegeben sind.

**Abnahme:** Tabelle oben vollständig ergänzt — erfüllt bis auf die zwei offenen Zeilen.

## 2. Discovery-Diagnosen (Q3) — erledigt

Umgesetzt wie unten beschrieben; zusätzlich zeigt `useWorkspaces` jetzt auch einen *fehlgeschlagenen* Lauf (z. B. fehlendes `cargo`) an, statt ihn als „keine Module" zu behandeln.

**Problem:** Scheitert `cargo metadata` für *einen* Workspace (z. B. unbekannte Registry), verschwindet der Fehler, sobald ein anderer Workspace Module liefert.

**Lösung:** `ModuleDiscoveryPort.discover()` bleibt, dazu optional `diagnostics?(): string[]` (Meldungen des letzten Laufs). Alternative: Rückgabetyp `{ modules, diagnostics }` — verworfen, weil es Maven/npm-Adapter und alle Aufrufer ändert.

Tests zuerst:
- `CDISC-09` erweitern: Fehler eines Workspaces steht in `diagnostics()`, die übrigen Module bleiben.
- CLI `modules`/`scan` schreibt Diagnosen nach stderr (Muster `config.warnings`); `--json` enthält `diagnostics: []`.
- `useWorkspaces` reicht sie an die Statusleiste weiter (Komponententest mit `ink-testing-library`).

**Abnahme:** Kein Cargo-Fehler geht mehr verloren; npm/Maven unverändert (bestehende Tests grün).

## 3. Bundle/SEA, User-Agent, Proxy — erledigt (mit einer Einschränkung)

* **Bundle:** `npm run build` und `npm run build:bundle` laufen mit `toml-eslint-parser`; `dist/bundle.mjs` und `dist/cli.js` scannen den Beispiel-Workspace korrekt. **Das SEA-Binary ließ sich hier nicht bauen:** `node --build-sea` gibt es in Node 22.23 nicht (der Release-Workflow nutzt `node: latest`). Beim ersten Release-Lauf prüfen.
* **Version/User-Agent:** `src/version.ts` (`VERSION`), zur Build-Zeit per `define` in `tsup` und `esbuild` eingesetzt; im Bundle und in `dist/cli.js` steht `"1.3.0"`. Der MCP-Server meldet jetzt ebenfalls diese Version.
* **Proxy (gemessen mit lokalem Zähl-Proxy, Node 22.23):** Gewöhnlicher `fetch` ignoriert Proxy-Variablen. Mit `NODE_USE_ENV_PROXY=1` **beim Start** geht der Verkehr über den Proxy (`CONNECT` beim Proxy angekommen). `http.setGlobalProxyFromEnv` gibt es in dieser Version nicht, das Flag lässt sich zur Laufzeit also nicht setzen. Lösung: dokumentiert (`docs/en.md`, `docs/de.md`) und ein gezielter Hinweis bei Netzfehlern mit gesetztem Proxy (`CREG-10`). Offen: Cargos `http.proxy`/`http.cainfo` werden nicht gelesen.

## 4. Integrationstest mit echtem Cargo — erledigt

`test/integration/cargo-workflow.test.ts` (5 Tests, grün gegen Cargo 1.97 und crates.io; `describe.skipIf` ohne `cargo`): Scan mit Breaking-Update und Floor-Bump; Update inkl. `cargo check --locked` danach; Rollback von `Cargo.toml` und `Cargo.lock` byte-genau bei Build-Bruch; `CUPD-05` (keine neue `Cargo.lock`); `CCFG-06` (Verzeichnis-Quelle ⇒ Scan-Fehler, kein Zugriff auf crates.io). Läuft mit `npm run test:integration`; nicht Teil von `ci.yml`. Ob die gehosteten Runner Rust mitbringen, ist weiter ungeprüft.

## 5. Windows — erledigt, Windows-Lauf steht aus

`test/unit/cargo-paths.test.ts`: `WIN-C1` (ein Repository unter `R&D 100%` — Discovery, Update und Verifikation reichen nur `cwd` weiter, nie den Pfad; läuft auch unter Linux), `WIN-C2` (Namen/Versionen mit `+` und `@` passieren den Runner), `WIN-C3` (`@windows`, echtes Cargo, nur unter Windows). `WIN-C3` wurde **noch nicht auf Windows ausgeführt**; `ci.yml` läuft auf `windows-latest`, dort aber ohne gesicherte Rust-Installation.

## 8. Härtung — erledigt

| Randfall | Umsetzung |
| :--- | :--- |
| R6 gleiche Crate, verschiedene Anforderungen | ein Kandidat (Normal-Deklaration), dazu Hinweis in `skipped` (`declaration-mismatch`: „dev-dependencies requires ^1.2.0; it is not changed“); gleiche Anforderungen ⇒ kein Hinweis |
| R7 gleicher Name in zwei Workspaces | zweite Crate bekommt `id = "name (relPath)"` |
| Pfad-Abhängigkeit nur über Namen zugeordnet | Zuordnung über den Pfad (`CORIG-C1`); Registry-Crate mit Member-Namen bleibt Registry-Crate (`CORIG-C2`) |
| Mehrere gelockte Versionen | Test bestätigt `name@alt` über die zur Anforderung passende Version |
| Fehlende Toolchain | `cargoErrors` hängt den Hinweis auf `rustup toolchain install` an |
| `hasLock` nach dem Update | unverändert: der Updater legt nie eine Lock an, daher unkritisch |

Ursprüngliche Planung:

## 8 (Vorlage). Härtung (nach Priorität)

| Randfall | Heute | Test zuerst | Lösung |
| :--- | :--- | :--- | :--- |
| **R6** gleiche Crate in mehreren Abschnitten mit *verschiedenen* Anforderungen | Scanner nimmt die Normal-Deklaration; Updater schreibt nur gleiche Literale | beide Abschnitte, `1.0` und `1.2` | Je abweichendem Literal eigener Hinweis in `skipped` (`declaration-mismatch`), kein stilles Auslassen |
| **R7** gleicher Paketname in zwei unabhängigen Workspaces | `id = name`, `buildWorkspaceIndex` überschreibt | zwei Workspaces mit `utils` | Kollision ⇒ `id = name (relPath)` für den zweiten |
| Pfad-Abhängigkeit wird nur über den Namen dem Member zugeordnet | `context.workspace.get(name)` | Registry-Crate mit Member-Namen | Zusätzlich `dep.path` gegen `module.path` prüfen (CORIG) |
| Mehrere gelockte Versionen derselben Crate | `name@alt` aus dem Lock | `itoa 0.4.8` + `1.0.x` | Tests für `refreshLock` mit Doppeleinträgen |
| `hasLock` wird nach dem Update ausgewertet | ok, da Updater keine erzeugt | – | Absicherung: Verifier bekommt Wert aus den Snapshot-Daten des Workflows |
| `rust-toolchain.toml` mit fehlender Toolchain | Cargo-Fehler wird durchgereicht | Fake mit rustup-Text | Meldung in `cargoErrors` erkennen und Hinweis anhängen |

## 6. TUI — erledigt

Umgesetzt als `CUI-01..03`: `qualifier` (`serde (cfg(unix))`) und der Hinweis `[+2 crates]` stehen in der Namensspalte (die rechte Spalte war bei 100 Zeichen Breite schon voll; der Name wird gekürzt, nicht der Hinweis). Das Versions-Modal nennt „Also changes: api, web“. en/de übersetzt. Nicht umgesetzt: eine Bestätigungszeile bei der Auswahl.

Ursprüngliche Planung:

- `package-row.tsx`: `qualifier` hinter dem Namen (`serde  build`), `sharedWith` als `+2 weitere Crates` und eine Zeile im Versions-Modal mit den Namen.
- i18n en/de: zwei neue Texte. Komponententests (`components.test.tsx`-Muster) mit Kandidat inkl. `qualifier`/`sharedWith`.
- Der Hinweis, dass die Änderung in der Workspace-Wurzel mehrere Crates betrifft, gehört in die Auswahl-Bestätigung.

## 7. Specs — erledigt

Sechs Dateien `specs/15-` bis `20-cargo-*.feature` (11–14 sind die pnpm-Specs) (103 Szenarien) und `test/unit/cargo-specs.test.ts`, der Specs und Tests in beide Richtungen abgleicht und eindeutige IDs erzwingt. Dabei wurden uneinheitliche Test-IDs (`R6`, `WIN-C1`, …) vereinheitlicht. `specs/README.md` ist ergänzt (Tabelle, Testdateien, Implementation contract). `CVER-02` weicht wie geplant ab: nur das Wurzel-Manifest löst einen Workspace-Check aus, nicht `Cargo.lock`.

Ursprüngliche Planung:

Dateien `specs/15-cargo-discovery.feature` (`CDISC`), `16-cargo-requirements` (`CREQ`), `17-cargo-declarations` (`CDECL`), `18-cargo-registry` (`CREG`, `CCFG`), `19-cargo-update` (`CUPD`), `20-cargo-verification` (`CVER`). Die Szenario-IDs stehen bereits in den Testtiteln; aus ihnen die Gherkin-Texte ableiten und `specs/README.md` (Tabelle, Test-Dateien, „Implementation contract") ergänzen. Ein kleiner Check (Skript im Unit-Test) stellt sicher, dass jede ID in den Specs einen Test hat und umgekehrt.

Abweichung von der Planung festhalten: `CVER-02` — eine geänderte `Cargo.lock` löst *keinen* Workspace-Check aus (jedes Update ändert sie), nur das Wurzel-Manifest.

## 9. Lockfile-only-Updates (eigener Branch `feat/cargo-lock-updates`) — umgesetzt

Umgesetzt mit den vier Empfehlungen (gemischt mit `[Lock]`-Marker, nur direkte Abhängigkeiten, Manifest-Kandidat hat Vorrang, vorselektiert); Specs `21-cargo-lock-updates.feature`, `CLOCK-01` bis `CLOCK-25`.

Ursprüngliche Planung:

**Ziel:** Für Apps mit eingechecktem `Cargo.lock` die häufigste Aktualisierung abdecken: kompatible Versionen, ohne `Cargo.toml` zu ändern.

**Datenmodell:** `UpdateCandidate.action` bekommt `'lock'` (neben `update`/`align`); `declaration` entfällt, `affectedFiles` = nur `Cargo.lock`.

**Quelle der Information:** Locked-Version (`cargo-lockfile.ts`) gegen die neueste, noch von der Anforderung erlaubte Version aus dem Index (`satisfiesRequirement`). Kein Parsen von `cargo update`-Text.

**Schritte (TDD):**
1. `CLOCK-01` Kandidat, wenn gelockt < neueste erlaubte; keiner ohne Lockfile.
2. `CLOCK-02` Pinnen: `cargo update -p name@locked --precise ziel`.
3. `CLOCK-03` Verifikation wie bisher (`--locked`).
4. UI: eigener Reiter oder Kennzeichnung `[Lock]`; CLI `scan --lock`, `update --lock`.
5. Rollback-Test: nur `Cargo.lock` wird zurückgesetzt.

Entscheidung davor: eigener Reiter statt Mischung mit Manifest-Updates? Empfehlung: Mischung mit Kennzeichnung, damit `U` einen Lauf ausführt.

## 10. `engines` (Q6, unabhängig)

`@npmcli/map-workspaces@6` verlangt Node `^22.22.2 || ^24.15.0 || >=26`, `package.json` deklariert `>=20.0.0`. Zwei Wege: **(a)** `engines` auf die reale Untergrenze korrigieren (ehrlich, einfach) oder **(b)** `map-workspaces` auf eine Node-20-taugliche Version pinnen (mehr Arbeit, hält Node 20 offen). Empfehlung (a) mit Changelog-Eintrag; eigener kleiner Commit außerhalb von `feat/cargo`.

---

## Abschlusskriterien für den Merge von `feat/cargo`

- Pakete 1–5 und 8 (R6, R7, Pfad-Abgleich) erledigt, 6 und 7 mindestens mit Tests.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run build:bundle` grün; Integrationstest lokal grün.
- Doku (README, `docs/en.md`, `docs/de.md`, Changelog) spiegelt die tatsächlichen Grenzen: keine Authentifizierung, kein Lockfile-only (bis Paket 9), Proxy-Verhalten.
