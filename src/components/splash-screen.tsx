import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import { en } from '../i18n/locales/en.js';

interface Props {
  onComplete: () => void;
  author?: string;
}

/**
 * 🪶 Elevate — Initialer Splash Screen
 *
 * Zeigt beim Start ein ansprechendes Intro mit Maskottchen Pip,
 * Ladebalken und Autoren-Info. Der Splash Screen ist bewusst IMMER
 * auf Englisch gehalten. Schaltet nach ~3,2 Sekunden oder per
 * Tastendruck automatisch auf das Dashboard um.
 */
export const SplashScreen: React.FC<Props> = ({ onComplete, author }) => {
  const t = en;

  const [progress, setProgress] = useState(0);
  const [frame, setFrame] = useState(0);

  // Animations- und Fortschritts-Timer
  useEffect(() => {
    const progressTimer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressTimer);
          setTimeout(onComplete, 250);
          return 100;
        }
        return prev + 5;
      });
    }, 150);

    const mascotTimer = setInterval(() => {
      setFrame((prev) => (prev + 1) % 4);
    }, 400);

    return () => {
      clearInterval(progressTimer);
      clearInterval(mascotTimer);
    };
  }, [onComplete]);

  // Mascot-Animations-Frames für den Splash Screen (immer englische Chirps)
  const mascotFrames = [
    { face: '( •ө• )', arms: '/ >🪶', chirp: '*chirp!*' },
    { face: '( ᵔөᵔ )', arms: '/ >🪶', chirp: '*hello!*' },
    { face: '( -ө- )', arms: '/ >🪶', chirp: '*blink*' },
    { face: '( •ө• )', arms: '\\(•ө•)/', chirp: 'ready! ✨' },
  ];
  const curMascot = mascotFrames[frame % mascotFrames.length]!;

  // 24-Segment-Fortschrittsbalken
  const barLength = 24;
  const filledLength = Math.round((progress / 100) * barLength);
  const emptyLength = Math.max(0, barLength - filledLength);
  const progressBar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      borderStyle="round"
      borderColor={theme.colors.brand}
      paddingY={2}
      paddingX={4}
      marginY={1}
    >
      {/* 1. Titel & Icon */}
      <Box marginBottom={1}>
        <Text bold color={theme.colors.brand}>
          {theme.icon}   E  L  E  V  A  T  E
        </Text>
      </Box>

      <Text color={theme.colors.muted}>{t.splash.tagline}</Text>

      {/* 2. Großes zentriertes Hühnchen */}
      <Box flexDirection="column" alignItems="center" marginY={1}>
        <Text color={theme.colors.mascotComb} bold>
          (\_/)
        </Text>
        <Box>
          <Text color={theme.colors.mascotBody} bold>
            {curMascot.face}{' '}
          </Text>
          <Text color={theme.colors.brandLight} italic>
            {curMascot.chirp}
          </Text>
        </Box>
        <Text color={theme.colors.brandLight} bold>
          {curMascot.arms}
        </Text>
      </Box>

      {/* 3. Autor-Hinweis */}
      {author && (
        <Box marginBottom={1}>
          <Text color={theme.colors.muted}>{t.header.developedBy(author)}</Text>
        </Box>
      )}

      {/* 4. Ladebalken */}
      <Box flexDirection="column" alignItems="center" marginTop={1}>
        <Box>
          <Text color={theme.colors.brandLight} bold>
            [{progressBar}] {Math.min(100, progress)}%
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.colors.muted}>{t.splash.loading}</Text>
        </Box>
      </Box>

      {/* 5. Skip-Hinweis */}
      <Box marginTop={1}>
        <Text color={theme.colors.muted} dimColor>
          {t.splash.skipHint}
        </Text>
      </Box>
    </Box>
  );
};
