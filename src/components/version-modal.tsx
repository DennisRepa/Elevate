/**
 * 🪶 Elevate — version picker modal
 *
 * Lets the user search and pick any target version for a dependency.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../theme.js';
import type { UpdateCandidate } from '../domain/models.js';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';
import type { Translations } from '../i18n/types.js';
import { isPreReleaseVersion, extractPreReleaseTag } from '../domain/versions.js';
import { lookupVersions } from '../application/version-lookup.js';
import type { ElevateConfig } from '../config.js';

interface Props {
  candidate: UpdateCandidate;
  strategy: EcosystemStrategy;
  config: Pick<ElevateConfig, 'rootDir' | 'internalScopes'>;
  t: Translations;
  onSelect: (version: string) => void;
  onCancel: () => void;
}

const WINDOW_SIZE = 8;

export const VersionModal: React.FC<Props> = ({
  candidate,
  strategy,
  config,
  t,
  onSelect,
  onCancel,
}) => {
  const [allVersions, setAllVersions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterText, setFilterText] = useState('');
  const [cursor, setCursor] = useState(0);

  // Load all available versions
  useEffect(() => {
    let active = true;
    setLoading(true);

    // Versions delivered by the scan (Maven reports, workspace alignment) are
    // used as-is; otherwise the registry is asked, with the same guard against
    // public lookups of internal packages as everywhere else.
    const pending = candidate.availableVersions
      ? Promise.resolve(candidate.availableVersions)
      : lookupVersions(strategy, candidate.coordinate, config);

    pending
      .then((versions) => {
        if (!active) return;
        setAllVersions(versions);
        // Start at the newest version
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
  }, [strategy, candidate, config]);

  // Versions matching the filter text
  const filtered = useMemo(() => {
    if (!filterText.trim()) return allVersions;
    const lower = filterText.toLowerCase();
    return allVersions.filter((v) => v.toLowerCase().includes(lower));
  }, [allVersions, filterText]);

  // Keyboard input for filtering and navigation
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

    // With an empty filter, 'q' closes the modal
    if (input === 'q' && filterText === '') {
      onCancel();
      return;
    }

    // Append filter characters (digits, letters, dots, hyphens)
    if (input && !key.ctrl && !key.meta && /^[\w.\-+~]$/.test(input)) {
      setFilterText((prev) => prev + input);
      setCursor(0);
    }
  });

  // Visible window for scrolling
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
      {/* 1. Header and package name */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color={theme.colors.brandLight}>
          {theme.icon} {t.versionModal.title(candidate.coordinate.identifier)}
        </Text>
        <Text color={theme.colors.muted}>
          {t.versionModal.current(candidate.currentRange)}
        </Text>
      </Box>

      {/* 2. Filter field */}
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

      {/* 3. Version list */}
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

      {/* 4. Keyboard hints */}
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
