/**
 * 🪶 Elevate — Theme & Brand Tokens
 *
 * Brand colour: orange
 * Symbol: feather (🪶)
 */

export const theme = {
  icon: '🪶',
  colors: {
    // Brand and accents (orange palette)
    brand: '#FF8800',
    brandLight: '#FFA726',
    brandDark: '#E65100',
    brandSoft: '#FFE0B2',
    accent: '#FF9800',

    // Mascot
    mascotBody: '#FFD54F',
    mascotComb: '#FF7043',
    mascotBeak: '#FF9800',
    mascotBlush: '#FF8A80',
    mascotFeet: '#FFA726',

    // Status colours
    success: 'green',
    warning: 'yellow',
    danger: 'red',
    muted: 'gray',
    white: 'white',

    // UI elements
    border: '#FF8800',
    borderMuted: 'gray',
    focus: '#FFA726',
  },
} as const;
