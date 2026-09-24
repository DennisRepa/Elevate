import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { Translations } from '../i18n/types.js';
import type { Ecosystem } from '../domain/models.js';

export type MascotState = 'idle' | 'scanning' | 'updating' | 'success';

interface Props {
  state?: MascotState;
  t: Translations;
  ecosystem?: Ecosystem;
}

/**
 * 🐣 Süßes animiertes Hühnchen ("Pip")
 *
 * Inspiriert vom kleinen animierten Begleiter in Claude Code CLI.
 * Polyglot: Blinzelt, wechselt Mimik und zwitschert passend zum
 * aktuellen Zustand und zum gewählten Ökosystem (Node vs. Java).
 */
export const ChickenMascot: React.FC<Props> = ({ state = 'idle', t, ecosystem = 'npm' }) => {
  const [frame, setFrame] = useState(0);
  const [chirpIndex, setChirpIndex] = useState(0);

  // Animations-Timer (alle 1,4 Sekunden ein neuer Frame)
  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % 6);
    }, 1400);

    return () => clearInterval(timer);
  }, []);

  // Sprechblasen-Timer (wechselt alle 4,2 Sekunden den Text)
  useEffect(() => {
    const chirpTimer = setInterval(() => {
      setChirpIndex((prev) => prev + 1);
    }, 4200);

    return () => clearInterval(chirpTimer);
  }, []);

  // Mimik je nach Zustand & Frame
  let chickFace = '( •ө• )';
  let wingLeft = ' ';
  let wingRight = ' ';
  let currentChirp = '';

  if (state === 'scanning') {
    const scanningFaces = ['( •ө• )?', '( ˘ө˘ )🔍', '( •ө• )🔎', '( ᵔөᵔ )?'];
    chickFace = scanningFaces[frame % scanningFaces.length]!;
    currentChirp = t.mascot.scanningChirps[chirpIndex % t.mascot.scanningChirps.length]!;
  } else if (state === 'updating') {
    const updatingFrames = [
      { face: '( •ө• )', l: 'ง', r: 'ง' },
      { face: '( ˘ө˘ )', l: '~', r: '~' },
      { face: '( •ө• )', l: 'ᕙ', r: 'ᕗ' },
      { face: '( ᵔөᵔ )', l: 'ง', r: 'ง' },
    ];
    const cur = updatingFrames[frame % updatingFrames.length]!;
    chickFace = cur.face;
    wingLeft = cur.l;
    wingRight = cur.r;
    currentChirp = t.mascot.updatingChirps[chirpIndex % t.mascot.updatingChirps.length]!;
  } else if (state === 'success') {
    const successFaces = ['\\( ᵔөᵔ )/', '\\( •ө• )/ 🎉', '*( ᵔөᵔ )* 🪶', '\\( ᵔөᵔ )/ ✨'];
    chickFace = successFaces[frame % successFaces.length]!;
    currentChirp = t.mascot.successChirps[chirpIndex % t.mascot.successChirps.length]!;
  } else {
    // Idle state: dezentes Blinzeln & Wippen
    const idleFaces = [
      { face: '( •ө• )', l: ' ', r: ' ' },
      { face: '( •ө• )', l: ' ', r: ' ' },
      { face: '( -ө- )', l: ' ', r: ' ' }, // Blinzeln
      { face: '( ᵔөᵔ )', l: ' ', r: ' ' }, // Lächeln
      { face: '( •ө- )', l: ' ', r: ' ' }, // Zwinkern
      { face: '( ˘ө˘ )', l: ' ', r: '~🪶' }, // Flausch-Feder
    ];
    const cur = idleFaces[frame % idleFaces.length]!;
    chickFace = cur.face;
    wingLeft = cur.l;
    wingRight = cur.r;

    const chirpsPool =
      ecosystem === 'maven'
        ? [...t.mascot.idleChirps, ...t.mascot.mavenChirps]
        : t.mascot.idleChirps;

    currentChirp = chirpsPool[chirpIndex % chirpsPool.length]!;
  }

  return (
    <Box alignItems="center">
      {/* Kämmchen */}
      <Text color={theme.colors.mascotComb} bold>
        {wingLeft === ' ' ? ' ' : wingLeft}
      </Text>

      {/* Körper & Schnabel */}
      <Text color={theme.colors.mascotBody} bold>
        {chickFace}
      </Text>

      {/* Rechter Flügel / Feder */}
      <Text color={theme.colors.brandLight} bold>
        {wingRight}
      </Text>

      {/* Kleine Sprechblase / Piepser */}
      {currentChirp ? (
        <Box marginLeft={1}>
          <Text color={theme.colors.brandLight} italic>
            {currentChirp}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};
