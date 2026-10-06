/**
 * 🪶 Elevate — i18n type definitions
 */

import type { SkipReason } from '../domain/models.js';

export type Locale = 'de' | 'en';

export interface Translations {
  header: {
    title: string;
    developedBy: (name: string) => string;
    langToggleHint: string;
    ecosystemToggleHint: (nextName: string) => string;
  };
  workspace: {
    label: string;
    switchHint: string;
    modalTitle: string;
  };
  tabs: {
    all: (count: number) => string;
    dependencies: (count: number) => string;
    devDependencies: (count: number) => string;
  };
  list: {
    scanning: string;
    allUpToDate: string;
    moreAbove: string;
    moreBelow: (remaining: number) => string;
    /** Shown instead of the list when the scan failed. */
    scanFailed: (message: string) => string;
    /** Heading for dependencies the scan could not offer. */
    skippedHeading: (count: number) => string;
    skipReason: (reason: SkipReason) => string;
  };
  badges: {
    patch: string;
    minor: string;
    major: string;
    dev: string;
    prod: string;
    /** Workspace dependency aligned to the module's local version. */
    align: string;
    /** Internal package from a private registry. */
    internal: string;
  };
  status: {
    selectedOf: (selected: number, total: number) => string;
    breakdown: (patch: number, minor: number, major: number) => string;
    internalScopes: (scopes: string[]) => string;
    noInternalScopes: string;
  };
  controls: {
    navigate: string;
    toggle: string;
    all: string;
    tabs: string;
    workspace: string;
    ecosystem: string;
    version: string;
    language: string;
    update: string;
    quit: string;
  };
  versionModal: {
    title: (pkgName: string) => string;
    current: (version: string) => string;
    filterPlaceholder: string;
    loading: string;
    noVersions: string;
    hint: string;
    latestBadge: string;
    currentBadge: string;
    customBadge: string;
  };
  updating: {
    title: string;
    stepWriting: (step: number, total: number) => string;
    stepInstalling: (step: number, total: number) => string;
    stepAnalyzing: (step: number, total: number) => string;
    stepCustom: (step: number, total: number, label: string) => string;
    doNotClose: string;
  };
  summary: {
    title: string;
    successCount: (count: number, path: string) => string;
    securityAudit: string;
    cleanAudit: string;
    funding: (msg: string) => string;
    postScript: (label: string) => string;
    backHint: string;
    rolledBackTitle: string;
    rolledBack: string;
    changedFiles: (files: string[]) => string;
  };
  mascot: {
    name: string;
    idleChirps: string[];
    scanningChirps: string[];
    updatingChirps: string[];
    successChirps: string[];
    mavenChirps: string[];
  };
  splash: {
    tagline: string;
    loading: string;
    skipHint: string;
  };
}
