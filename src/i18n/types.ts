/**
 * 🪶 Elevate — i18n Typ-Definitionen
 */

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
  };
  badges: {
    patch: string;
    minor: string;
    major: string;
    dev: string;
    prod: string;
  };
  status: {
    selectedOf: (selected: number, total: number) => string;
    breakdown: (patch: number, minor: number, major: number) => string;
    symlinksProtected: (scopes: string[]) => string;
    defaultProtected: string;
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
