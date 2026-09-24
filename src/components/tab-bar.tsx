import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { Tab, SelectionCounts } from '../domain/models.js';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';
import type { Translations } from '../i18n/types.js';

interface Props {
  activeTab: Tab;
  counts: SelectionCounts;
  strategy: EcosystemStrategy;
  t: Translations;
}

/** Tab-Leiste: Fragt die Bezeichnungen vom jeweiligen Ökosystem ab */
export const TabBar: React.FC<Props> = ({ activeTab, counts, strategy, t }) => {
  const labels = strategy.getTabLabels(counts, t);

  return (
    <Box borderStyle="single" borderColor={theme.colors.borderMuted} paddingX={1}>
      <Text
        bold
        color={activeTab === 'all' ? theme.colors.brand : theme.colors.white}
        underline={activeTab === 'all'}
      >
        {labels.all}
      </Text>
      <Text color={theme.colors.muted}>   │   </Text>
      <Text
        bold
        color={activeTab === 'prod' ? theme.colors.brand : theme.colors.white}
        underline={activeTab === 'prod'}
      >
        {labels.prod}
      </Text>
      <Text color={theme.colors.muted}>   │   </Text>
      <Text
        bold
        color={activeTab === 'dev' ? theme.colors.brand : theme.colors.white}
        underline={activeTab === 'dev'}
      >
        {labels.dev}
      </Text>
    </Box>
  );
};
