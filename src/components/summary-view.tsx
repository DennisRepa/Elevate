import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { UpdateSummary, ProjectModule } from '../domain/models.js';
import type { EcosystemStrategy } from '../domain/ecosystem-strategy.js';
import type { Translations } from '../i18n/types.js';
import { ChickenMascot } from './mascot.js';

interface Props {
  summary: UpdateSummary;
  module: ProjectModule;
  strategy: EcosystemStrategy;
  t: Translations;
}

/** Zusammenfassung nach Abschluss des Update-Workflows mit feierndem Hühnchen */
export const SummaryView: React.FC<Props> = ({ summary, module, strategy, t }) => {
  const vStatus = summary.verificationStatus || (summary as any).postScriptStatus;
  const vLabel = summary.verificationLabel || (summary as any).postScriptLabel || 'Verifikation';
  const vDetails = summary.verificationDetails || (summary as any).postScriptDetails;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.colors.success}
      padding={1}
      marginY={1}
    >
      <Box justifyContent="space-between" alignItems="center">
        <Text bold color={theme.colors.success}>
          {strategy.icon} {t.summary.title}
        </Text>
        <ChickenMascot state="success" t={t} ecosystem={strategy.ecosystem} />
      </Box>

      <Box flexDirection="column" marginY={1}>
        <Text color={theme.colors.white}>
          {t.summary.successCount(summary.updatedCount, module.relPath)}
        </Text>

        <Box marginTop={1}>
          <Text
            color={summary.auditSeverity === 'clean' ? theme.colors.success : theme.colors.warning}
            bold
          >
            {t.summary.securityAudit}{' '}
          </Text>
          <Text>{summary.auditMessage}</Text>
        </Box>

        {summary.fundingMessage && (
          <Box marginTop={1}>
            <Text color={theme.colors.muted}>{t.summary.funding(summary.fundingMessage)}</Text>
          </Box>
        )}

        {/* Verifikations-Ergebnis */}
        {vStatus && (
          <Box marginTop={1} flexDirection="column">
            <Text
              color={vStatus === 'clean' ? theme.colors.success : theme.colors.warning}
              bold
            >
              {t.summary.postScript(vLabel)}
            </Text>
            <Text color={theme.colors.muted}>{vDetails}</Text>
          </Box>
        )}
      </Box>

      <Box borderStyle="single" borderColor={theme.colors.borderMuted} paddingX={1} marginTop={1}>
        <Text bold color={theme.colors.brandLight}>
          {t.summary.backHint}
        </Text>
      </Box>
    </Box>
  );
};
