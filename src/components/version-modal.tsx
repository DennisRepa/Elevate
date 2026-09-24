/**
 * 🪶 Elevate — Version Picker Modal (Version heraussuchen)
 *
 * Ermöglicht das interaktive Durchsuchen und Auswählen einer
 * beliebigen Zielversion aus der npm- bzw. Maven-Registry.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../theme.js';
import type { UpdateCandidate } from '../domain/models.js';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';
import type { Translations } from '../i18n/types.js';
import { isPreReleaseVersion, extractPreReleaseTag } from '../adapters/maven/maven-registry.js';

interface Props {
  candidate: UpdateCandidate;
  strategy: EcosystemStrategy;
  t: Translations;
  onSelect: (version: string) => void;
  onCancel: () => void;
}

const WINDOW_SIZE = 8;

export const VersionModal: React.FC<Props> = ({
  candidate,
  strategy,
  t,
  onSelect,
  onCancel,
}) => {
  const [allVersions, setAllVersions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterText, setFilterText] = useState('');
  const [cursor, setCursor] = useState(0);

  // Alle verfügbaren Versionen aus der Registry laden
  useEffect(() => {
    let active = true;
    setLoading(true);

    strategy.registry
      .getAllVersions(candidate.coordinate)
      .then((versions) => {
        if (!active) return;
        setAllVersions(versions);
        // Falls die aktuelle Neueste vorhanden ist, Cursor darauf ausrichten
        setCursor(0);
      })
      .catch(() => {
        if (!active) return;
        setAllVersions([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [strategy, candidate.coordinate]);

  // Gefilterte Versionen nach Suchtext
  const filtered = useMemo(() => {
    if (!filterText.trim()) return allVersions;
    const lower = filterText.toLowerCase();
    return allVersions.filter((v) => v.toLowerCase().includes(lower));
  }, [allVersions, filterText]);

  // Tastatureingaben für Suche und Navigation
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      if (filtered.length > 0 && cursor >= 0 && cursor < filtered.length) {
        onSelect(filtered[cursor]!);
      }
      return;
    }

    if (key.upArrow || (input === 'k' && filterText === '')) {
      setCursor((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow || (input === 'j' && filterText === '')) {
      setCursor((prev) => Math.min(filtered.length - 1, prev + 1));
      return;
    }

    if (key.pageUp) {
      setCursor((prev) => Math.max(0, prev - 5));
      return;
    }

    if (key.pageDown) {
      setCursor((prev) => Math.min(filtered.length - 1, prev + 5));
      return;
    }

    if (key.backspace || key.delete) {
      setFilterText((prev) => prev.slice(0, -1));
      setCursor(0);
      return;
    }

    // Bei leerem Filter beendet 'q' das Modal
    if (input === 'q' && filterText === '') {
      onCancel();
      return;
    }

    // Zeichen zur Filterung hinzufügen (Zahlen, Buchstaben, Punkte, Bindestriche)
    if (input && !key.ctrl && !key.meta && /^[\w.\-+~]$/.test(input)) {
      setFilterText((prev) => prev + input);
      setCursor(0);
    }
  });

  // Fenster-Ausschnitt für scrollbare Darstellung
  const startIdx = Math.max(
    0,
    Math.min(
      cursor - Math.floor(WINDOW_SIZE / 2),
      Math.max(0, filtered.length - WINDOW_SIZE),
    ),
  );
  const windowed = filtered.slice(startIdx, startIdx + WINDOW_SIZE);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.colors.brand}
      padding={1}
      marginY={1}
    >
      {/* 1. Header & Paketname */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color={theme.colors.brandLight}>
          {theme.icon} {t.versionModal.title(candidate.coordinate.identifier)}
        </Text>
        <Text color={theme.colors.muted}>
          {t.versionModal.current(candidate.currentRange)}
        </Text>
      </Box>

      {/* 2. Such- und Filterfeld */}
      <Box
        borderStyle="single"
        borderColor={theme.colors.border}
        paddingX={1}
        marginBottom={1}
      >
        <Text bold color={theme.colors.white}>
          Filter:{' '}
        </Text>
        <Text color={filterText ? theme.colors.brandLight : theme.colors.muted}>
          {filterText || t.versionModal.filterPlaceholder}
        </Text>
        {filterText ? (
          <Text color={theme.colors.brandLight} bold>
            _
          </Text>
        ) : null}
        {filterText ? (
          <Box marginLeft={2}>
            <Text color={theme.colors.muted}>
              ({filtered.length} Treffer)
            </Text>
          </Box>
        ) : null}
      </Box>

      {/* 3. Versions-Liste */}
      {loading ? (
        <Box marginY={2} justifyContent="center">
          <Text color={theme.colors.warning}>⏳ {t.versionModal.loading}</Text>
        </Box>
      ) : filtered.length === 0 ? (
        <Box marginY={2} justifyContent="center">
          <Text color={theme.colors.danger}>
            ❌ {t.versionModal.noVersions}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {startIdx > 0 && (
            <Text color={theme.colors.muted}>
              ▲ … {startIdx} weitere oben
            </Text>
          )}

          {windowed.map((ver, idx) => {
            const actualIdx = startIdx + idx;
            const isFocused = actualIdx === cursor;
            const isLatest = ver === candidate.latest;
            const isCurrent = ver === candidate.currentClean;
            const isPre = isPreReleaseVersion(ver);
            const preTag = isPre ? extractPreReleaseTag(ver) : undefined;

            return (
              <Box key={ver} justifyContent="space-between">
                <Box>
                  <Text
                    color={
                      isFocused ? theme.colors.brandLight : theme.colors.muted
                    }
                    bold={isFocused}
                  >
                    {isFocused ? ' ➔ ' : '   '}
                  </Text>
                  <Text
                    bold={isFocused}
                    color={
                      isFocused
                        ? theme.colors.brandLight
                        : isCurrent
                          ? theme.colors.muted
                          : theme.colors.white
                    }
                  >
                    {ver.padEnd(28)}
                  </Text>
                </Box>

                <Box>
                  {isCurrent && (
                    <Text color={theme.colors.muted}>
                      [{t.versionModal.currentBadge}]{' '}
                    </Text>
                  )}
                  {isLatest && (
                    <Text bold color={theme.colors.brand}>
                      [{t.versionModal.latestBadge}]{' '}
                    </Text>
                  )}
                  {isPre && (
                    <Text bold color="#E040FB">
                      [{preTag || 'PRE'}]{' '}
                    </Text>
                  )}
                </Box>
              </Box>
            );
          })}

          {startIdx + WINDOW_SIZE < filtered.length && (
            <Text color={theme.colors.muted}>
              ▼ … {filtered.length - (startIdx + WINDOW_SIZE)} weitere unten
            </Text>
          )}
        </Box>
      )}

      {/* 4. Tastaturhinweise */}
      <Box
        borderStyle="single"
        borderColor={theme.colors.border}
        paddingX={1}
        marginTop={1}
      >
        <Text color={theme.colors.muted}>{t.versionModal.hint}</Text>
      </Box>
    </Box>
  );
};
