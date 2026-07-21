// Design tokens — single source of truth. Ported from the handoff (README "Design Tokens"
// + prototype css block). Never hard-code hex/sizes in components.

export const colors = {
  primary: '#2f7247', // primary green
  dark: '#1d4a37', // dark green
  tint: '#eef6f0', // light-green tint
  tintFill: '#e9f4ec', // agent box fill
  userBubble: '#d7eede', // user chat bubble — light green
  userBubbleText: '#1d4a37', // user chat bubble text — dark green (legible on light green)
  tintLine: '#d8ebdd', // tint border
  ink: '#15201b', // primary text
  body: '#34403a', // body text
  muted: '#7b8a82', // muted text
  mutedBlue: '#6b7a86', // hero subtitle
  line: '#e2e8e4', // hairline
  fieldLine: '#e7ebe8', // field/card border
  pickLine: '#dde6e0', // pick-box border (unselected)
  chipFill: '#eef6f0', // start-here suggestion chip fill
  chipLine: '#d6e8db', // start-here chip border
  chipIcon: '#16432f', // chip icon glyph
  exFill: '#1d4a37', // ai-empty example chip fill (dark green)
  exIcon: '#79c79c', // ai-empty example chip icon
  paper: '#fbfbfa', // screen background
  surface: '#ffffff', // cards / sheets
  segTrack: '#f1f3f1', // segmented-control track
  accentLeaf: '#2fb672', // bright "AI" accent
  amberBg: '#fdf6ec',
  amberInk: '#92591a',
  whatsApp: '#25d366',
  scrim: 'rgba(8,18,12,0.45)', // modal/overlay backdrop
} as const;

// Per-platform brand colors. Keys match Platform.name. (PRD §8.1)
export const platformColors: Record<string, string> = {
  Aqar: '#1f7a3d',
  Wasalt: '#0f7b6c',
  Aldarim: '#8a5a2b',
};

export const platformColor = (name: string) => platformColors[name] ?? colors.primary;

export const radius = {
  chip: 12,
  card: 16,
  field: 13,
  sheet: 22,
  pill: 999,
} as const;

export const space = {
  base: 8,
  screenTop: 56,
  screenSide: 18,
  card: 16,
} as const;

// Poppins; falls back to system until the font is loaded (see _layout). README: body 13–15,
// titles 18–26, pill/labels 11.
export const font = {
  family: {
    regular: 'Poppins_400Regular',
    medium: 'Poppins_500Medium',
    semibold: 'Poppins_600SemiBold',
    bold: 'Poppins_700Bold',
  },
} as const;

// Soft green-tinted card shadow: 0 18px 40px -30px rgba(20,40,30,.3)
export const cardShadow = {
  shadowColor: 'rgba(20,40,30,1)',
  shadowOpacity: 0.18,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 8 },
  elevation: 4,
} as const;
