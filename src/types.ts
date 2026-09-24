/**
 * 🪶 Elevate — Gemeinsame Typ-Definitionen
 * Re-exportiert alle Kernmodelle aus der Domain-Schicht.
 */

export * from './domain/models.js';
export * from './domain/ecosystem-strategy.js';

// Aliase für bestehende Komponenten
export type { ProjectModule as Workspace } from './domain/models.js';
export type { UpdateCandidate as PackageUpdate } from './domain/models.js';
