/**
 * 🪶 Elevate — shared type definitions
 * Re-exports the core models of the domain layer.
 */

export * from './domain/models.js';
export * from './domain/ecosystem-strategy.js';

// Aliases for existing components
export type { ProjectModule as Workspace } from './domain/models.js';
export type { UpdateCandidate as PackageUpdate } from './domain/models.js';
