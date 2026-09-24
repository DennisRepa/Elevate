import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { Translations } from '../i18n/types.js';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';
import type { ReleaseChannel } from '../domain/models.js';

interface Props {
  author?: string;
  t: Translations;
  currentLocale: string;
  strategy: EcosystemStrategy;
  nextStrategyName: string;
  channel: ReleaseChannel;
}

/** Kopfzeile mit Polyglot-Ecosystem-Anzeige, Release Channel, Sprache und Autor */
export const Header: React.FC<Props> = ({
  author,
  t,
  currentLocale,
  strategy,
  nextStrategyName,
  channel,
}) => (
  <Box
    borderStyle="round"
    borderColor={theme.colors.brand}
    paddingX={1}
    justifyContent="space-between"
    alignItems="center"
  >
    {/* Links: Logo, Ökosystem & Channel */}
    <Box alignItems="center">
      <Text bold color={theme.colors.brand}>
        {theme.icon} {t.header.title}
      </Text>

      {/* Aktives Ökosystem & Channel */}
      <Box marginLeft={2}>
        <Text color={theme.colors.muted}>│ </Text>
        <Text color={theme.colors.brandLight} bold>
          {strategy.icon} {strategy.displayName}
        </Text>
        <Text color={theme.colors.muted}> [{channel}] </Text>
        <Text color={theme.colors.muted}>
          ({t.header.ecosystemToggleHint(nextStrategyName)})
        </Text>
      </Box>

      {/* Sprache */}
      <Box marginLeft={2}>
        <Text color={theme.colors.muted}>│ </Text>
        <Text color={theme.colors.brandLight} bold>
          [{currentLocale.toUpperCase()}]
        </Text>
        <Text color={theme.colors.muted}> {t.header.langToggleHint}</Text>
      </Box>
    </Box>

    {/* Rechts: Maintainer */}
    {author && (
      <Text color={theme.colors.muted}>
        {t.header.developedBy(author)}
      </Text>
    )}
  </Box>
);
