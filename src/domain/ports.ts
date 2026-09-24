/**
 * 🪶 Elevate — Domain Ports (Hexagonal Architecture)
 *
 * Schnittstellen zur Entkopplung der Fachlogik von konkreten
 * Paketmanagern, Registries und Dateisystem-Operationen.
 */

import type {
  ProjectModule,
  DependencyCoordinate,
  UpdateCandidate,
  UpdateSummary,
  ReleaseChannel,
} from './models.js';

/** Port: Findet alle Module eines Ökosystems im Projekt */
export interface ModuleDiscoveryPort {
  discover(rootDir: string): Promise<ProjectModule[]>;
}

/** Port: Fragt Registry nach Versionen ab */
export interface RegistryPort {
  getLatestVersion(coordinate: DependencyCoordinate, channel?: ReleaseChannel): Promise<string | null>;
  getAllVersions(coordinate: DependencyCoordinate): Promise<string[]>;
}

/** Port: Scannt ein Modul und liefert verfügbare Update-Kandidaten */
export interface DependencyReaderPort {
  scan(
    module: ProjectModule,
    excludedScopes: string[],
    internalIds: Set<string>,
    channel?: ReleaseChannel,
  ): Promise<UpdateCandidate[]>;
}

/** Port: Schreibt Updates in die Manifest-Dateien und führt die Installation aus */
export interface DependencyUpdaterPort {
  applyUpdates(
    module: ProjectModule,
    rootDir: string,
    updates: UpdateCandidate[],
    onProgress: (stepMessage: string) => void,
  ): Promise<Pick<UpdateSummary, 'updatedCount' | 'auditMessage' | 'auditSeverity' | 'fundingMessage'>>;
}

/** Port: Führt Verifikationen (Tests, Compiler, Konsistenzchecks) durch */
export interface VerificationPort {
  verify(
    module: ProjectModule,
    rootDir: string,
    customScript?: string,
    customLabel?: string,
  ): Promise<{ status: 'clean' | 'warn'; details: string; label: string }>;
}
