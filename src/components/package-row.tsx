import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { UpdateCandidate } from '../domain/models.js';
import type { Translations } from '../i18n/types.js';

interface Props {
  item: UpdateCandidate;
  isFocused: boolean;
  t: Translations;
}

/** Einzelne Zeile in der Liste mit Badges und Checkbox */
export const PackageRow: React.FC<Props> = ({ item, isFocused, t }) => {
  const badge =
    item.diff === 'major' ? (
      <Text bold color={theme.colors.danger}>{t.badges.major}</Text>
    ) : item.diff === 'minor' ? (
      <Text color={theme.colors.warning}>{t.badges.minor}</Text>
    ) : (
      <Text color={theme.colors.success}>{t.badges.patch}</Text>
    );

  const displayName = item.coordinate?.identifier || (item as any).name || '';
  const isDevOrTest = item.scope === 'dev' || item.scope === 'test';

  return (
    <Box justifyContent="space-between">
      <Box>
        <Text color={theme.colors.brandLight} bold>
          {isFocused ? '➔ ' : '  '}
        </Text>
        <Text color={item.selected ? theme.colors.success : theme.colors.muted} bold>
          {item.selected ? '[✔] ' : '[ ] '}
        </Text>
        <Text bold={isFocused} color={isFocused ? theme.colors.brandLight : theme.colors.white}>
          {displayName.slice(0, 42).padEnd(42)}{' '}
        </Text>
        <Text color={theme.colors.muted}>{item.currentRange.padEnd(12)} </Text>
        <Text color={theme.colors.muted}>➔ </Text>
        <Text bold color={theme.colors.white}>
          {item.newRange.padEnd(12)}{' '}
        </Text>
      </Box>
      <Box>
        {item.isCustomVersion && (
          <Text bold color={theme.colors.brandLight}>
            [{t.versionModal.customBadge}]{' '}
          </Text>
        )}
        {item.isPreRelease && (
          <Text bold color="#E040FB">
            [{item.preReleaseTag || 'PRE'}]{' '}
          </Text>
        )}
        {badge}
        <Text color={theme.colors.muted}> {isDevOrTest ? t.badges.dev : t.badges.prod}</Text>
      </Box>
    </Box>
  );
};
