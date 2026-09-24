/**
 * 🪶 Elevate — Domain Models & Value Objects
 *
 * Reine Domänenmodelle ohne externe Framework-Abhängigkeiten.
 */

/** Unterstützte Ökosysteme / Paketmanager */
export type Ecosystem = 'npm' | 'maven';

/** Bounded Context: Projektmodul / Workspace-Einheit */
export interface ProjectModule {
  /** Eindeutige Kennung (z. B. Paketname oder groupId:artifactId) */
  id: string;
  /** Anzeigename für die UI */
  name: string;
  /** Absoluter Pfad zum Modul-Verzeichnis */
  path: string;
  /** Relativer Pfad zur Monorepo-Wurzel */
  relPath: string;
  /** Zugehöriges Ökosystem */
  ecosystem: Ecosystem;
  /** Ist dies die Monorepo-Wurzel? */
  isRoot: boolean;
}

/** Value Object: Koordinate einer Abhängigkeit */
export interface DependencyCoordinate {
  /** Vollständiger Bezeichner (npm: Name; Maven: groupId:artifactId) */
  identifier: string;
  /** Optionaler Namespace / GroupId (Maven) */
  group?: string;
  /** Artefaktname / Package Name */
  artifact: string;
  /** Ökosystem */
  ecosystem: Ecosystem;
}

/** Release Channel (Stabile Releases vs. Vorabversionen) */
export type ReleaseChannel = 'stable' | 'all';

/** Art des Versionsunterschieds nach SemVer */
export type VersionDiff = 'patch' | 'minor' | 'major';

/** Entity: Update-Kandidat */
export interface UpdateCandidate {
  /** Koordinate der Abhängigkeit */
  coordinate: DependencyCoordinate;
  /** Aktueller Versionsbereich im Projekt */
  currentRange: string;
  /** Bereinigte Versionsnummer */
  currentClean: string;
  /** Neueste verfügbare Version */
  latest: string;
  /** Neuer Versionsbereich */
  newRange: string;
  /** Schweregrad der Änderung */
  diff: VersionDiff;
  /** Art der Abhängigkeit: prod, dev (npm), test (maven) */
  scope: 'prod' | 'dev' | 'test' | 'plugin';
  /** Vom Benutzer im Dashboard ausgewählt? */
  selected: boolean;
  /** Ist dies eine Vorabversion (Beta, RC, Alpha, Milestone)? */
  isPreRelease?: boolean;
  /** Name des Vorabversions-Tags (z. B. "BETA", "RC", "ALPHA", "MILESTONE") */
  preReleaseTag?: string;
  /** Wurde eine benutzerdefinierte Version manuell ausgewählt? */
  isCustomVersion?: boolean;
}

/** Value Object: Zählerstände für die UI */
export interface SelectionCounts {
  total: number;
  prodCount: number;
  devCount: number;
  selectedCount: number;
  patchCount: number;
  minorCount: number;
  majorCount: number;
}

/** Value Object: Ergebnisbericht eines Update-Laufs */
export interface UpdateSummary {
  /** Anzahl aktualisierter Abhängigkeiten */
  updatedCount: number;
  /** Sicherheitsaudit-Nachricht */
  auditMessage: string;
  /** Schweregrad des Audits */
  auditSeverity: 'clean' | 'warn';
  /** Optionaler Funding-Hinweis */
  fundingMessage?: string;
  /** Ergebnis des Verifikations-Schritts */
  verificationStatus?: 'clean' | 'warn';
  /** Details zur Verifikation */
  verificationDetails?: string;
  /** Label des Verifikationsschritts */
  verificationLabel?: string;
}

/** Dashboard-Ansichten (Finite State Machine) */
export type View =
  | 'splash'
  | 'dashboard'
  | 'workspace_modal'
  | 'version_modal'
  | 'updating'
  | 'summary';

/** Aktiver Tab in der Liste */
export type Tab = 'all' | 'prod' | 'dev';
