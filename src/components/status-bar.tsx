import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { SelectionCounts, Ecosystem } from '../domain/models.js';
import type { Translations } from '../i18n/types.js';
import { ChickenMascot, type MascotState } from './mascot.js';

interface Props {
  counts: SelectionCounts;
  visibleCount: number;
  t: Translations;
  mascotState?: MascotState;
  ecosystem?: Ecosystem;
}

/** Statusleiste: Zähler links, Hühnchen-Mascot rechts */
export const StatusBar: React.FC<Props> = ({
  counts,
  visibleCount,
  t,
  mascotState = 'idle',
  ecosystem = 'npm',
}) => {
  return (
    <Box
      borderStyle="single"
      borderColor={theme.colors.borderMuted}
      paddingX={1}
      justifyContent="space-between"
      alignItems="center"
    >
      {/* Linke Seite: Zähler (fest am linken Rand) */}
      <Box>
        <Text bold>{t.status.selectedOf(counts.selectedCount, visibleCount)} </Text>
        <Text color={theme.colors.muted}>
          {t.status.breakdown(counts.patchCount, counts.minorCount, counts.majorCount)}
        </Text>
      </Box>

      {/* Rechte Seite: Süßes animiertes Hühnchen */}
      <ChickenMascot state={mascotState} t={t} ecosystem={ecosystem} />
    </Box>
  );
};
