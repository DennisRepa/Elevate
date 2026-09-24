import type { RegistryPort } from '../../domain/ports.js';
import type { DependencyCoordinate, ReleaseChannel } from '../../domain/models.js';

/** Prüft, ob eine Versionsbezeichnung ein Pre-Release (Alpha, Beta, RC, Milestone, Snapshot etc.) ist */
export function isPreReleaseVersion(version: string): boolean {
  return /[.-]?(alpha|beta|rc|cr|m\d*|preview|milestone|snapshot|ea|dev|b\d+)/i.test(version);
}

/** Extrahiert ein kurzes Tag für Vorabversionen (z. B. "BETA", "RC", "MILESTONE") */
export function extractPreReleaseTag(version: string): string | undefined {
  const match = version.match(/[.-]?(alpha|beta|rc|cr|m\d*|preview|milestone|snapshot|ea|dev)/i);
  if (!match) return undefined;
  const tag = match[1]!.toUpperCase();
  if (tag.startsWith('M') && tag.length <= 3) return `M${tag.slice(1)}`;
  return tag;
}

export class MavenRegistryAdapter implements RegistryPort {
  async getLatestVersion(
    coordinate: DependencyCoordinate,
    channel: ReleaseChannel = 'stable',
  ): Promise<string | null> {
    if (!coordinate.group || !coordinate.artifact) return null;

    const groupPath = coordinate.group.replace(/\./g, '/');
    const url = `https://repo1.maven.org/maven2/${groupPath}/${coordinate.artifact}/maven-metadata.xml`;

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Elevate-Dependency-Updater' },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return await this.fallbackSearch(coordinate.group, coordinate.artifact, channel);
      }

      const xml = await response.text();
      const allVersions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]!.trim());

      // 1. Channel = 'stable' -> Nur stabile Versionen berücksichtigen
      if (channel === 'stable') {
        const releaseMatch = xml.match(/<release>([^<]+)<\/release>/);
        if (releaseMatch?.[1] && !isPreReleaseVersion(releaseMatch[1].trim())) {
          return releaseMatch[1].trim();
        }

        // Rückwärts durch alle Versionen suchen, um die neueste stabile zu finden
        for (let i = allVersions.length - 1; i >= 0; i--) {
          const v = allVersions[i]!;
          if (!isPreReleaseVersion(v)) {
            return v;
          }
        }
      }

      // 2. Channel = 'all' (oder kein stabiles Release gefunden)
      const releaseMatch = xml.match(/<release>([^<]+)<\/release>/);
      if (releaseMatch?.[1]) return releaseMatch[1].trim();

      const latestMatch = xml.match(/<latest>([^<]+)<\/latest>/);
      if (latestMatch?.[1]) return latestMatch[1].trim();

      if (allVersions.length > 0) {
        return allVersions[allVersions.length - 1]!;
      }

      return null;
    } catch {
      return null;
    }
  }

  private async fallbackSearch(
    group: string,
    artifact: string,
    channel: ReleaseChannel,
  ): Promise<string | null> {
    try {
      const query = `g:${encodeURIComponent(group)}+AND+a:${encodeURIComponent(artifact)}`;
      const url = `https://search.maven.org/solrsearch/select?q=${query}&rows=20&wt=json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data: any = await res.json();
      const docs = data?.response?.docs || [];

      if (docs.length === 0) return null;

      if (channel === 'stable') {
        for (const doc of docs) {
          const v = doc.v || doc.latestVersion;
          if (v && !isPreReleaseVersion(v)) return v;
        }
      }

      return docs[0]?.latestVersion || docs[0]?.v || null;
    } catch {
      return null;
    }
  }

  /** Liefert alle verfügbaren Versionen aus dem Maven-Repository (neueste zuerst) */
  async getAllVersions(coordinate: DependencyCoordinate): Promise<string[]> {
    if (!coordinate.group || !coordinate.artifact) return [];

    const groupPath = coordinate.group.replace(/\./g, '/');
    const url = `https://repo1.maven.org/maven2/${groupPath}/${coordinate.artifact}/maven-metadata.xml`;

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Elevate-Dependency-Updater' },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        return await this.fallbackAllVersions(coordinate.group, coordinate.artifact);
      }

      const xml = await response.text();
      const allVersions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(
        (m) => m[1]!.trim(),
      );

      if (allVersions.length > 0) {
        return allVersions.reverse();
      }

      return await this.fallbackAllVersions(coordinate.group, coordinate.artifact);
    } catch {
      return await this.fallbackAllVersions(coordinate.group, coordinate.artifact);
    }
  }

  private async fallbackAllVersions(
    group: string,
    artifact: string,
  ): Promise<string[]> {
    try {
      const query = `g:${encodeURIComponent(group)}+AND+a:${encodeURIComponent(artifact)}`;
      const url = `https://search.maven.org/solrsearch/select?q=${query}&rows=100&core=gav&wt=json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return [];
      const data: any = await res.json();
      const docs = data?.response?.docs || [];
      return docs.map((d: any) => d.v).filter(Boolean);
    } catch {
      return [];
    }
  }
}
