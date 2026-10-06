/**
 * 🪶 Elevate — main component (app shell)
 *
 * Orchestrates the ecosystem strategies (npm / Maven), views, hooks,
 * i18n, theme and keyboard navigation.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Box, useInput, useApp } from 'ink';
import type { View, Ecosystem, UpdateCandidate } from './domain/models.js';
import type { ElevateConfig } from './config.js';
import { EcosystemFactory } from './domain/ecosystem-factory.js';
import { useI18n, resolveInitialLocale } from './i18n/index.js';

// Domain-Driven Hooks
import { useWorkspaces } from './hooks/use-workspaces.js';
import { usePackages } from './hooks/use-packages.js';
import { useUpdater } from './hooks/use-updater.js';

// Components
import { SplashScreen } from './components/splash-screen.js';
import { Header } from './components/header.js';
import { WorkspaceBar } from './components/workspace-bar.js';
import { TabBar } from './components/tab-bar.js';
import { PackageList } from './components/package-list.js';
import { StatusBar } from './components/status-bar.js';
import { ControlsBar } from './components/controls-bar.js';
import { WorkspaceModal } from './components/workspace-modal.js';
import { VersionModal } from './components/version-modal.js';
import { SummaryView } from './components/summary-view.js';
import { UpdatingView } from './components/updating-view.js';

interface AppProps {
  config: ElevateConfig;
}

export const App: React.FC<AppProps> = ({ config }) => {
  const { exit } = useApp();
  const [view, setView] = useState<View>('splash');
  const [modalIndex, setModalIndex] = useState(0);
  const [versionPickerCandidate, setVersionPickerCandidate] = useState<UpdateCandidate | null>(null);

  // 1. Ecosystem selection (npm ⇄ Maven via strategy pattern)
  const [ecosystem, setEcosystem] = useState<Ecosystem>('npm');
  const strategy = useMemo(() => EcosystemFactory.getStrategy(ecosystem), [ecosystem]);

  const nextEcosystem: Ecosystem = ecosystem === 'npm' ? 'maven' : 'npm';
  const nextStrategy = useMemo(() => EcosystemFactory.getStrategy(nextEcosystem), [nextEcosystem]);

  const toggleEcosystem = useCallback(() => {
    setEcosystem((prev) => (prev === 'npm' ? 'maven' : 'npm'));
  }, []);

  // 2. i18n Hook
  const { locale, toggleLocale, t } = useI18n(resolveInitialLocale(config.locale));

  // 3. Domain hooks (receive the active strategy)
  const ws = useWorkspaces(strategy, config.rootDir);
  const pkg = usePackages(strategy, ws.active, ws.modules, config, config.channel);
  const updater = useUpdater(strategy, config.rootDir, setView, {
    script: config.postUpdateScript,
    label: config.postUpdateLabel,
  });

  // 4. Mascot state
  const mascotState =
    view === 'updating'
      ? 'updating'
      : pkg.loading
        ? 'scanning'
        : view === 'summary'
          ? 'success'
          : 'idle';

  // 5. Keyboard handling
  useInput((input, key) => {
    // While the version modal is open, its own useInput handles all keys
    if (view === 'version_modal') {
      return;
    }

    // Global: quit
    if (input === 'q' && view !== 'updating') {
      exit();
      return;
    }

    // Splash screen: Space or Enter skips straight to the dashboard (the scan already runs)
    if (view === 'splash') {
      if (key.return || input === ' ') {
        setView('dashboard');
      }
      return;
    }

    // Global: toggle language ([L])
    if ((input === 'l' || input === 'L') && view !== 'updating') {
      toggleLocale();
      return;
    }

    // ── Workspace-Modal ──
    if (view === 'workspace_modal') {
      if (key.upArrow || input === 'k') {
        setModalIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow || input === 'j') {
        setModalIndex((i) => Math.min(ws.modules.length - 1, i + 1));
      } else if (key.return) {
        ws.setActiveIndex(modalIndex);
        setView('dashboard');
      } else if (key.escape || input === 'w') {
        setView('dashboard');
      }
      return;
    }

    // ── Summary ──
    if (view === 'summary') {
      if (key.return || input === 'd') {
        setView('dashboard');
        pkg.scan();
      }
      return;
    }

    // ── Dashboard ──
    if (view === 'dashboard') {
      // Switch ecosystem ([E])
      if (input === 'e' || input === 'E') {
        toggleEcosystem();
        return;
      }

      // Select module ([W])
      if (input === 'w') {
        setModalIndex(ws.activeIndex);
        setView('workspace_modal');
      } else if (input === 'v' || input === 'V') {
        // Pick a specific version ([V])
        const focused = pkg.visible[pkg.cursor];
        if (focused) {
          setVersionPickerCandidate(focused);
          setView('version_modal');
        }
      } else if (key.tab) {
        pkg.cycleTab();
      } else if (input === '1') {
        pkg.switchTab('all');
      } else if (input === '2') {
        pkg.switchTab('prod');
      } else if (input === '3') {
        pkg.switchTab('dev');
      } else if (key.upArrow || input === 'k') {
        pkg.setCursor((i) => Math.max(0, i - 1));
      } else if (key.downArrow || input === 'j') {
        pkg.setCursor((i) => Math.min(pkg.visible.length - 1, i + 1));
      } else if (input === ' ') {
        const focused = pkg.visible[pkg.cursor];
        if (focused) pkg.togglePackage(focused.coordinate.identifier);
      } else if (input === 'a') {
        pkg.toggleAllVisible();
      } else if (input === 'r') {
        pkg.scan();
      } else if (input === 'u' && pkg.counts.selectedCount > 0 && !pkg.loading) {
        const selected = pkg.packages.filter((p) => p.selected);
        updater.run(ws.active, selected);
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {/* 1. Initial splash screen (always English) */}
      {view === 'splash' && (
        <SplashScreen
          onComplete={() => setView('dashboard')}
          author={config.author}
        />
      )}

      {/* 2. Dashboard views */}
      {view !== 'splash' && (
        <>
          <Header
            author={config.author}
            t={t}
            currentLocale={locale}
            strategy={strategy}
            nextStrategyName={`${nextStrategy.icon} ${nextStrategy.displayName}`}
            channel={config.channel}
          />

          {view === 'workspace_modal' && (
            <WorkspaceModal
              modules={ws.modules}
              focusedIndex={modalIndex}
              strategy={strategy}
              t={t}
            />
          )}

          {view === 'version_modal' && versionPickerCandidate && (
            <VersionModal
              candidate={versionPickerCandidate}
              strategy={strategy}
              config={config}
              t={t}
              onSelect={(chosenVersion) => {
                pkg.setCustomVersion(versionPickerCandidate.coordinate.identifier, chosenVersion);
                setView('dashboard');
                setVersionPickerCandidate(null);
              }}
              onCancel={() => {
                setView('dashboard');
                setVersionPickerCandidate(null);
              }}
            />
          )}

          {view === 'updating' && (
            <UpdatingView step={updater.step} t={t} ecosystem={strategy.ecosystem} />
          )}

          {view === 'summary' && updater.summary && (
            <SummaryView
              summary={updater.summary}
              module={ws.active}
              strategy={strategy}
              t={t}
            />
          )}

          {view === 'dashboard' && (
            <>
              <WorkspaceBar
                module={ws.active}
                internalScopes={config.internalScopes}
                strategy={strategy}
                t={t}
              />
              <TabBar
                activeTab={pkg.activeTab}
                counts={pkg.counts}
                strategy={strategy}
                t={t}
              />
              <PackageList
                items={pkg.visible}
                cursor={pkg.cursor}
                loading={pkg.loading}
                error={pkg.error}
                skipped={pkg.skipped}
                t={t}
              />
              <StatusBar
                counts={pkg.counts}
                visibleCount={pkg.visible.length}
                t={t}
                mascotState={mascotState}
                ecosystem={strategy.ecosystem}
              />
              <ControlsBar t={t} />
            </>
          )}
        </>
      )}
    </Box>
  );
};
