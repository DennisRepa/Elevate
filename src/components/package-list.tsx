import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { SkippedDependency, UpdateCandidate } from '../domain/models.js';
import type { Translations } from '../i18n/types.js';
import { PackageRow } from './package-row.js';

interface Props {
  items: UpdateCandidate[];
  cursor: number;
  loading: boolean;
  /** Scan error; replaces the list so a failure is never shown as "up to date". */
  error?: string;
  /** Dependencies the scan could not offer, shown below the list. */
  skipped: SkippedDependency[];
  t: Translations;
}

const WINDOW_SIZE = 7;
const MAX_SKIPPED_SHOWN = 3;

/** Scrollable package list showing a window around the cursor. */
export const PackageList: React.FC<Props> = ({ items, cursor, loading, error, skipped, t }) => {
  const startIdx = Math.max(
    0,
    Math.min(
      cursor - Math.floor(WINDOW_SIZE / 2),
      Math.max(0, items.length - WINDOW_SIZE),
    ),
  );
  const window = items.slice(startIdx, startIdx + WINDOW_SIZE);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.colors.border}
      padding={1}
      marginY={1}
      minHeight={10}
    >
      {loading ? (
        <Box marginY={2} justifyContent="center">
          <Text color={theme.colors.warning}>{t.list.scanning}</Text>
        </Box>
      ) : error ? (
        <Box marginY={1} flexDirection="column">
          <Text color={theme.colors.danger}>{t.list.scanFailed(error.split('\n')[0] ?? '')}</Text>
          {error
            .split('\n')
            .slice(1, 6)
            .map((line, idx) => (
              <Text key={idx} color={theme.colors.muted}>
                {'   '}
                {line}
              </Text>
            ))}
        </Box>
      ) : items.length === 0 ? (
        <Box marginY={2} justifyContent="center">
          <Text color={theme.colors.success}>{t.list.allUpToDate}</Text>
        </Box>
      ) : (
        <>
          {startIdx > 0 && <Text color={theme.colors.muted}>{t.list.moreAbove}</Text>}
          {window.map((item, idx) => (
            <PackageRow
              key={`${item.coordinate.identifier}_${startIdx + idx}`}
              item={item}
              isFocused={startIdx + idx === cursor}
              t={t}
            />
          ))}
          {startIdx + WINDOW_SIZE < items.length && (
            <Text color={theme.colors.muted}>{t.list.moreBelow(items.length - (startIdx + WINDOW_SIZE))}</Text>
          )}
        </>
      )}

      {!loading && !error && skipped.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.colors.warning}>{t.list.skippedHeading(skipped.length)}</Text>
          {skipped.slice(0, MAX_SKIPPED_SHOWN).map((s) => (
            <Text key={s.identifier} color={theme.colors.muted}>
              {'   '}• {s.identifier}: {t.list.skipReason(s.reason)}
            </Text>
          ))}
          {skipped.length > MAX_SKIPPED_SHOWN && (
            <Text color={theme.colors.muted}>{'   '}…</Text>
          )}
        </Box>
      )}
    </Box>
  );
};
