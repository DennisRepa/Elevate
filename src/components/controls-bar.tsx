import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { Translations } from '../i18n/types.js';

interface Props {
  t: Translations;
}

/** Tastenkürzel-Leiste inkl. [E] Ökosystem-Wechsel */
export const ControlsBar: React.FC<Props> = ({ t }) => (
  <Box marginTop={1} flexWrap="wrap">
    <Text color={theme.colors.brandLight} bold>[↑/↓]</Text>
    <Text color={theme.colors.muted}> {t.controls.navigate} │ </Text>

    <Text color={theme.colors.brandLight} bold>[Space]</Text>
    <Text color={theme.colors.muted}> {t.controls.toggle} │ </Text>

    <Text color={theme.colors.brandLight} bold>[A]</Text>
    <Text color={theme.colors.muted}> {t.controls.all} │ </Text>

    <Text color={theme.colors.brandLight} bold>[Tab/1/2/3]</Text>
    <Text color={theme.colors.muted}> {t.controls.tabs} │ </Text>

    <Text color={theme.colors.brandLight} bold>[W]</Text>
    <Text color={theme.colors.muted}> {t.controls.workspace} │ </Text>

    <Text color={theme.colors.brandLight} bold>[V]</Text>
    <Text color={theme.colors.muted}> {t.controls.version} │ </Text>

    <Text color={theme.colors.brand} bold>[E]</Text>
    <Text color={theme.colors.muted}> {t.controls.ecosystem} │ </Text>

    <Text color={theme.colors.brandLight} bold>[L]</Text>
    <Text color={theme.colors.muted}> {t.controls.language} │ </Text>

    <Text color={theme.colors.success} bold>[U]</Text>
    <Text color={theme.colors.muted}> {t.controls.update} │ </Text>

    <Text color={theme.colors.danger} bold>[Q]</Text>
    <Text color={theme.colors.muted}> {t.controls.quit}</Text>
  </Box>
);
