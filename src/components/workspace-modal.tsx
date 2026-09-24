import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { ProjectModule } from '../domain/models.js';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';
import type { Translations } from '../i18n/types.js';

interface Props {
  modules: ProjectModule[];
  focusedIndex: number;
  strategy: EcosystemStrategy;
  t: Translations;
}

/** Modaler Modul-Auswähler für das aktuelle Ökosystem */
export const WorkspaceModal: React.FC<Props> = ({ modules, focusedIndex, strategy, t }) => (
  <Box
    flexDirection="column"
    borderStyle="single"
    borderColor={theme.colors.brand}
    padding={1}
    marginY={1}
  >
    <Text bold color={theme.colors.brandLight}>
      {strategy.icon} {t.workspace.modalTitle}
    </Text>
    <Box flexDirection="column" marginTop={1}>
      {modules.map((m, idx) => (
        <Box key={m.path}>
          <Text
            color={idx === focusedIndex ? theme.colors.brandLight : theme.colors.white}
            bold={idx === focusedIndex}
          >
            {idx === focusedIndex ? ' ➔ ' : '   '}
            {m.name.slice(0, 48).padEnd(48)}
          </Text>
          <Text color={theme.colors.muted}>({m.relPath})</Text>
        </Box>
      ))}
    </Box>
  </Box>
);
