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

/** Result of the update workflow: success, or failure with rollback. */
export const SummaryView: React.FC<Props> = ({ summary, module, strategy, t }) => {
  const failed = Boolean(summary.rolledBack);
  const accent = failed ? theme.colors.danger : theme.colors.success;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={accent} padding={1} marginY={1}>
      <Box justifyContent="space-between" alignItems="center">
        <Text bold color={accent}>
          {strategy.icon} {failed ? t.summary.rolledBackTitle : t.summary.title}
        </Text>
        {!failed && <ChickenMascot state="success" t={t} ecosystem={strategy.ecosystem} />}
      </Box>

      <Box flexDirection="column" marginY={1}>
        {failed ? (
          <>
            <Text color={theme.colors.white}>{t.summary.rolledBack}</Text>
            {summary.failure?.split('\n').slice(0, 8).map((line, idx) => (
              <Text key={idx} color={theme.colors.warning}>
                {line}
              </Text>
            ))}
          </>
        ) : (
          <>
            <Text color={theme.colors.white}>{t.summary.successCount(summary.updatedCount, module.relPath)}</Text>
            {summary.changedFiles && summary.changedFiles.length > 0 && (
              <Text color={theme.colors.muted}>{t.summary.changedFiles(summary.changedFiles)}</Text>
            )}
            <Box marginTop={1}>
              <Text color={summary.auditSeverity === 'clean' ? theme.colors.success : theme.colors.warning} bold>
                {t.summary.securityAudit}{' '}
              </Text>
              <Text>{summary.auditMessage}</Text>
            </Box>
          </>
        )}

        {summary.fundingMessage && !failed && (
          <Box marginTop={1}>
            <Text color={theme.colors.muted}>{t.summary.funding(summary.fundingMessage)}</Text>
          </Box>
        )}

        {summary.verificationStatus && (
          <Box marginTop={1} flexDirection="column">
            <Text color={summary.verificationStatus === 'clean' ? theme.colors.success : theme.colors.warning} bold>
              {t.summary.postScript(summary.verificationLabel ?? '')}
            </Text>
            <Text color={theme.colors.muted}>{summary.verificationDetails}</Text>
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
