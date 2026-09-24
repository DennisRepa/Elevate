import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { Translations } from '../i18n/types.js';
import type { Ecosystem } from '../domain/models.js';
import { ChickenMascot } from './mascot.js';

interface Props {
  step: string;
  t: Translations;
  ecosystem?: Ecosystem;
}

/** Fortschrittsanzeige während des Update-Workflows mit arbeitendem Hühnchen */
export const UpdatingView: React.FC<Props> = ({ step, t, ecosystem = 'npm' }) => (
  <Box
    flexDirection="column"
    borderStyle="round"
    borderColor={theme.colors.brand}
    padding={1}
    marginY={1}
  >
    <Box justifyContent="space-between" alignItems="center">
      <Text bold color={theme.colors.brandLight}>
        {t.updating.title}
      </Text>
      <ChickenMascot state="updating" t={t} ecosystem={ecosystem} />
    </Box>

    <Box marginY={1}>
      <Text bold color={theme.colors.brandLight}>
        {step}
      </Text>
    </Box>

    <Text color={theme.colors.muted}>{t.updating.doNotClose}</Text>
  </Box>
);
