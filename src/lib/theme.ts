// ═══════════════════════════════════════════════════════════════════════
// DESIGN TOKENS — PRD §10
//
// "Dark, system default typography, minimal custom styling. Function over
// polish." Every colour/spacing/type value used by a screen or component
// should come from here — no scattered inline hex values.
//
// Two rules baked into these tokens are algorithmic, not aesthetic
// (PRD §10, CLAUDE.md "UI rules that are algorithmic, not aesthetic"):
//
//   - No streaks, no guilt, no red. There is deliberately no "danger" or
//     "over budget" colour in this palette. Over-target and under-target
//     render in the same neutral tone — `colors.text` / `colors.accent`.
//     Do not add a red swatch here to "fix" a screen later; that request
//     is the bug.
//   - Confidence always visible. `colors.confidence` maps each
//     EntryConfidence/DataQuality level to a distinct (but non-alarming)
//     visual weight, so a low-confidence estimate can never render
//     identically to an exact entry.
// ═══════════════════════════════════════════════════════════════════════

export const colors = {
  background: '#000000',
  surface: '#161616',
  surfaceAlt: '#1f1f1f',
  border: '#2c2c2e',

  text: '#f2f2f2',
  textSecondary: '#a0a0a3',
  textTertiary: '#6b6b6e',

  /** Single accent colour. Used for the FAB, links, active tab — nothing else. */
  accent: '#4dabf7',

  /**
   * Confidence ladder (PRD §10: "confidence always visible"). Deliberately
   * NOT a red/amber/green traffic light — that reads as "wrong/right",
   * which is exactly the guilt signal PRD §10 bans. Instead: exact entries
   * are full-brightness text, and confidence drops read as fading opacity
   * plus a widening/dashed indicator, same hue throughout.
   */
  confidence: {
    exact: '#f2f2f2',
    high: '#d5d5d8',
    medium: '#a0a0a3',
    low: '#787879',
  },

  /** Neutral tone for remaining/over-target numbers — same tone either side of zero. */
  neutral: '#f2f2f2',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

/**
 * Minimum touch target size (dp) per Android/iOS accessibility guidance.
 * Any tappable control smaller than this in either dimension should get
 * `hitSlop`/`minHeight`/`minWidth` padded up to this value rather than
 * relying on its visual size alone.
 */
export const minTouchTarget = 44;

/**
 * Tabular numerals — the highest-value typographic change in the UI
 * design pass (redesign brief). The app is almost entirely numbers
 * (calories, macros, TDEE, weights, set weights/reps, timers, table
 * cells), and proportional digits make those figures visibly jitter in
 * width as they update on every log/refresh. Spread this into any text
 * style that renders a number: `[type.bodyStrong, numeric]` etc. Kept as
 * a standalone mixin rather than baked into every `type.*` entry because
 * several entries (e.g. `body`, `bodyStrong`) are used for plain text as
 * often as numbers, and tabular-nums on prose is a no-op, not a bug — but
 * it's not the point of those tokens, so it stays opt-in and explicit at
 * numeric call sites.
 */
export const numeric: { fontVariant: NonNullable<import('react-native').TextStyle['fontVariant']> } = {
  fontVariant: ['tabular-nums'],
};

/**
 * Type scale. "System default typography" (PRD §10) means we do not load
 * custom fonts or fight the platform's font family — only size/weight/
 * tracking are tokenized here, using the RN default system font.
 *
 * `letterSpacing` in React Native is absolute (points), not `em`-relative
 * like CSS, so the design brief's em values are pre-multiplied by each
 * entry's `fontSize` here (documented per entry below) rather than
 * recomputed at call sites.
 */
export const type = {
  /**
   * The one hero number on the app (Today's calorie headline) — larger
   * and tighter than anything else on screen. 64px / weight 700 (RN's
   * `fontWeight` only accepts multiples of 100, so 700 is the closest
   * available step to the design brief's 650) / -0.035em tracking
   * (-0.035 × 64 ≈ -2.24pt).
   */
  hero: { fontSize: 64, fontWeight: '700' as const, letterSpacing: -2.24 },
  // Headings: slight negative tracking (-0.02em) per the redesign brief,
  // pre-multiplied per size below.
  display: { fontSize: 40, fontWeight: '600' as const, letterSpacing: -0.8 }, // -0.02em × 40
  h1: { fontSize: 28, fontWeight: '600' as const, letterSpacing: -0.56 }, // -0.02em × 28
  h2: { fontSize: 20, fontWeight: '600' as const, letterSpacing: -0.4 }, // -0.02em × 20
  body: { fontSize: 16, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, fontWeight: '600' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
  small: { fontSize: 11, fontWeight: '400' as const },
  /**
   * Section label: 11px / weight 600 / uppercase / ~0.06em tracking
   * (0.06 × 11 ≈ 0.66pt). Colour is deliberately NOT baked in here (use
   * `colors.textTertiary` at the call site) since a couple of call sites
   * need a different tone (e.g. an active/selected section label).
   */
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.66,
    textTransform: 'uppercase' as const,
  },
};

export const theme = { colors, spacing, radii, type, numeric, minTouchTarget } as const;

export type Theme = typeof theme;
