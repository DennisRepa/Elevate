import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { UpdateCandidate } from '../domain/models.js';
import type { Translations } from '../i18n/types.js';
import { PackageRow } from './package-row.js';

interface Props {
  items: UpdateCandidate[];
  cursor: number;
  loading: boolean;
  t: Translations;
}

const WINDOW_SIZE = 7;

/** Scrollbare Liste mit Fenster-Ausschnitt */
export const PackageList: React.FC<Props> = ({ items, cursor, loading, t }) => {
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
      ) : items.length === 0 ? (
        <Box marginY={2} justifyContent="center">
          <Text color={theme.colors.success}>{t.list.allUpToDate}</Text>
        </Box>
      ) : (
        <>
          {startIdx > 0 && (
            <Text color={theme.colors.muted}>{t.list.moreAbove}</Text>
          )}
          {window.map((item, idx) => (
            <PackageRow
              key={`${item.coordinate?.identifier || (item as any).name}_${startIdx + idx}`}
              item={item}
              isFocused={startIdx + idx === cursor}
              t={t}
            />
          ))}
          {startIdx + WINDOW_SIZE < items.length && (
            <Text color={theme.colors.muted}>
              {t.list.moreBelow(items.length - (startIdx + WINDOW_SIZE))}
            </Text>
          )}
        </>
      )}
    </Box>
  );
};
