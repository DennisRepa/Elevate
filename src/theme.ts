/**
 * 🪶 Elevate — Theme & Brand Tokens
 *
 * Brand-Farbe: Orange
 * Symbol: Feder (🪶)
 */

export const theme = {
  icon: '🪶',
  colors: {
    // Brand & Akzente (Orange-Palette)
    brand: '#FF8800',
    brandLight: '#FFA726',
    brandDark: '#E65100',
    brandSoft: '#FFE0B2',
    accent: '#FF9800',

    // Süßes Hühnchen (Mascot)
    mascotBody: '#FFD54F',
    mascotComb: '#FF7043',
    mascotBeak: '#FF9800',
    mascotBlush: '#FF8A80',
    mascotFeet: '#FFA726',

    // Statusfarben
    success: 'green',
    warning: 'yellow',
    danger: 'red',
    muted: 'gray',
    white: 'white',

    // UI-Elemente
    border: '#FF8800',
    borderMuted: 'gray',
    focus: '#FFA726',
  },
} as const;
