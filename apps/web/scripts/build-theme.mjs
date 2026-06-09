#!/usr/bin/env node
// Reads design.json and generates app/theme.generated.css
// Run with: node scripts/build-theme.mjs  (or pnpm theme:build)

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, "..");

const design = JSON.parse(readFileSync(resolve(root, "design.json"), "utf8"));
const { modes, typography, spacing, components } = design;

const camelToKebab = (s) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

function emitColors(mode) {
  return Object.entries(mode).map(
    ([k, v]) => `  --color-${camelToKebab(k)}: ${v};`,
  );
}

const lines = [
  "/* AUTO-GENERATED — do not edit directly. Run `pnpm theme:build` to regenerate. */",
  "",
  ":root {",
  "  color-scheme: light;",
  "  /* ── Colors (light mode defaults) ────────────────── */",
  ...emitColors(modes.light),
  "",
  "  /* ── Typography ──────────────────────────────────── */",
  `  --font-serif:             ${typography.fontSerif};`,
  `  --font-sans:              ${typography.fontSans};`,
  `  --font-mono:              ${typography.fontMono};`,
  ...Object.entries(typography.fontSizes).map(
    ([k, v]) => `  --font-size-${k}: ${v};`,
  ),
  ...Object.entries(typography.lineHeights).map(
    ([k, v]) => `  --line-height-${k}: ${v};`,
  ),
  ...Object.entries(typography.fontWeights).map(
    ([k, v]) => `  --font-weight-${k}: ${v};`,
  ),
  ...Object.entries(typography.letterSpacing).map(
    ([k, v]) => `  --letter-spacing-${k}: ${v};`,
  ),
  "",
  "  /* ── Spacing, borders, radius, shadow ────────────── */",
  `  --border-width:           ${spacing.borderWidth};`,
  `  --border-width-thick:     ${spacing.borderWidthThick};`,
  `  --radius-sm:              ${spacing.radiusSm};`,
  `  --radius-md:              ${spacing.radiusMd};`,
  `  --radius-lg:              ${spacing.radiusLg};`,
  `  --radius-xl:              ${spacing.radiusXl};`,
  `  --radius-pill:            ${spacing.radiusPill};`,
  `  --shadow-sm:              ${spacing.shadowSm};`,
  `  --shadow-md:              ${spacing.shadowMd};`,
  `  --shadow-lg:              ${spacing.shadowLg};`,
  "",
  "  /* ── Component layout ────────────────────────────── */",
  `  --nav-width:              ${components.nav.width};`,
  `  --btn-padding-x:          ${components.button.paddingX};`,
  `  --btn-padding-y:          ${components.button.paddingY};`,
  `  --btn-font-weight:        ${components.button.fontWeight};`,
  `  --btn-letter-spacing:     ${components.button.letterSpacing};`,
  `  --input-padding-x:        ${components.input.paddingX};`,
  `  --input-padding-y:        ${components.input.paddingY};`,
  `  --card-padding:           ${components.card.padding};`,
  `  --chat-user-bg:           ${components.chatBubble.userBg};`,
  `  --chat-user-fg:           ${components.chatBubble.userFg};`,
  `  --chat-assistant-bg:      ${components.chatBubble.assistantBg};`,
  `  --chat-assistant-fg:      ${components.chatBubble.assistantFg};`,
  "}",
  "",
  '[data-theme="dark"] {',
  "  color-scheme: dark;",
  ...emitColors(modes.dark),
  "}",
  "",
  "/* System preference fallback when no explicit data-theme is set */",
  "@media (prefers-color-scheme: dark) {",
  "  :root:not([data-theme]) {",
  "    color-scheme: dark;",
  ...emitColors(modes.dark).map((l) => `  ${l}`),
  "  }",
  "}",
  "",
  "/* Expose semantic tokens to Tailwind v4's @theme system */",
  "@theme inline {",
  "  --color-bg:               var(--color-bg);",
  "  --color-bg-subtle:        var(--color-bg-subtle);",
  "  --color-bg-elevated:      var(--color-bg-elevated);",
  "  --color-surface:          var(--color-surface);",
  "  --color-surface-elevated: var(--color-surface-elevated);",
  "  --color-text:             var(--color-text);",
  "  --color-text-muted:       var(--color-text-muted);",
  "  --color-text-subtle:      var(--color-text-subtle);",
  "  --color-text-inverse:     var(--color-text-inverse);",
  "  --color-border:           var(--color-border);",
  "  --color-border-strong:    var(--color-border-strong);",
  "  --color-border-subtle:    var(--color-border-subtle);",
  "  --color-accent:           var(--color-accent);",
  "  --color-accent-fg:        var(--color-accent-fg);",
  "  --color-accent-muted:     var(--color-accent-muted);",
  "  --color-success:          var(--color-success);",
  "  --color-warning:          var(--color-warning);",
  "  --color-danger:           var(--color-danger);",
  "  --font-family-serif:      var(--font-serif);",
  "  --font-family-sans:       var(--font-sans);",
  "  --font-family-mono:       var(--font-mono);",
  "  --radius-sm:              var(--radius-sm);",
  "  --radius-md:              var(--radius-md);",
  "  --radius-lg:              var(--radius-lg);",
  "  --radius-xl:              var(--radius-xl);",
  "  --radius-pill:            var(--radius-pill);",
  "}",
];

const out = lines.join("\n") + "\n";
const outPath = resolve(root, "app/theme.generated.css");
writeFileSync(outPath, out, "utf8");
console.log(`✓ theme.generated.css written (${out.length} bytes)`);
