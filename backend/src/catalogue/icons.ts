// Must match the `when` names in shopify/lp/snippets/lp-icon.liquid and ICONS in scripts/build-theme.mjs
// (enforced by catalogue.test.ts).
export const ICONS = [
  'check', 'truck', 'cash', 'return', 'shield', 'star', 'leaf', 'sparkle', 'clock', 'heart', 'droplet',
  'sun', 'ruler', 'box', 'award', 'lock', 'bolt', 'feather', 'gift', 'chat', 'tag',
] as const;
export type IconName = (typeof ICONS)[number];
