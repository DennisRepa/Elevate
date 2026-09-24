import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { ProjectModule } from '../domain/models.js';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';
import type { Translations } from '../i18n/types.js';

interface Props {
  module: ProjectModule;
  excludeScopes: string[];
  strategy: EcosystemStrategy;
  t: Translations;
}

/** Zeigt das aktuell aktive Modul und den Schutzhinweis statisch an */
export const WorkspaceBar: React.FC<Props> = ({ module, excludeScopes, strategy, t }) => {
  const scopeHint =
    excludeScopes.length > 0
      ? t.status.symlinksProtected(excludeScopes)
      : t.status.defaultProtected;

  return (
    <Box marginY={1} justifyContent="space-between" alignItems="center">
      <Box alignItems="center" flexShrink={1}>
        <Text bold>📍 {strategy.icon} {t.workspace.label}: </Text>
        <Text bold color={theme.colors.brandLight}>
          {module.name}
        </Text>
        <Text color={theme.colors.muted}> ({module.relPath})</Text>
      </Box>
      <Box alignItems="center" marginLeft={2}>
        <Text color={theme.colors.muted}>{scopeHint}</Text>
        <Text color={theme.colors.muted}>  │  </Text>
        <Text color={theme.colors.brandLight} bold>[W]</Text>
        <Text color={theme.colors.muted}> {t.workspace.switchHint.replace('[W]', '').trim()}</Text>
      </Box>
    </Box>
  );
};
