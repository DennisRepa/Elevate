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

/** Status bar: counters on the left, mascot on the right. */
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
      {/* Left: counters (pinned to the left edge) */}
      <Box>
        <Text bold>{t.status.selectedOf(counts.selectedCount, visibleCount)} </Text>
        <Text color={theme.colors.muted}>
          {t.status.breakdown(counts.patchCount, counts.minorCount, counts.majorCount)}
        </Text>
      </Box>

      {/* Right: animated mascot */}
      <ChickenMascot state={mascotState} t={t} ecosystem={ecosystem} />
    </Box>
  );
};
