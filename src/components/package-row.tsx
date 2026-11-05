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

/** One row of the package list with checkbox, versions and badges. */
export const PackageRow: React.FC<Props> = ({ item, isFocused, t }) => {
  const badge =
    item.diff === 'major' ? (
      <Text bold color={theme.colors.danger}>{t.badges.major}</Text>
    ) : item.diff === 'minor' ? (
      <Text color={theme.colors.warning}>{t.badges.minor}</Text>
    ) : (
      <Text color={theme.colors.success}>{t.badges.patch}</Text>
    );

  // Where the dependency applies (build, cfg(unix)) and who shares its declaration go into the
  // name column, so the row keeps its width. A long name is cut, the hints are not.
  const shared = item.sharedWith && item.sharedWith.length > 0 ? ` ${t.badges.shared(item.sharedWith.length)}` : '';
  const label = item.qualifier ? `${item.coordinate.identifier} (${item.qualifier})` : item.coordinate.identifier;
  const displayName = label.slice(0, 42 - shared.length) + shared;
  const isDevOrTest = item.scope === 'dev' || item.scope === 'test';
  const property = item.declaration?.kind === 'property' ? `\${${item.declaration.propertyName}}` : undefined;

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
        {property && <Text color={theme.colors.muted}>{property} </Text>}
        {item.action === 'align' && (
          <Text bold color={theme.colors.brandLight}>
            {t.badges.align}{' '}
          </Text>
        )}
        {item.action === 'lock' && (
          <Text bold color={theme.colors.brandLight}>
            {t.badges.lock}{' '}
          </Text>
        )}
        {item.origin.kind === 'private' && (
          <Text color={theme.colors.brandLight}>{t.badges.internal} </Text>
        )}
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
