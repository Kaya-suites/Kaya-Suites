#!/usr/bin/env node
// Reads design.json and generates app/theme.generated.css
// Run with: node scripts/build-theme.mjs  (or pnpm theme:build)

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, "..");

const design = JSON.parse(readFileSync(resolve(root, "design.json"), "utf8"));
const { colors, typography, spacing, components } = design;

const lines = [
  "/* AUTO-GENERATED — do not edit directly. Run `pnpm theme:build` to regenerate. */",
  ":root {",
  "  /* ── Colors ─────────────────────────────────────── */",
  `  --color-background:   ${colors.background};`,
  `  --color-surface:      ${colors.surface};`,
  `  --color-foreground:   ${colors.foreground};`,
  `  --color-border:       ${colors.border};`,
  `  --color-accent:       ${colors.accent};`,
  `  --color-accent-fg:    ${colors.accentForeground};`,
  `  --color-muted:        ${colors.muted};`,
  `  --color-muted-bg:     ${colors.mutedBackground};`,
  `  --color-danger:       ${colors.danger};`,
  `  --color-danger-fg:    ${colors.dangerForeground};`,
  `  --color-success:      ${colors.success};`,
  `  --color-success-fg:   ${colors.successForeground};`,
  `  --color-warning:      ${colors.warning};`,
  `  --color-warning-fg:   ${colors.warningForeground};`,
  "",
  "  /* ── Typography ─────────────────────────────────── */",
  `  --font-sans:              ${typography.fontFamily};`,
  `  --font-mono:              ${typography.fontFamilyMono};`,
  `  --font-size-xs:           ${typography.fontSizes.xs};`,
  `  --font-size-sm:           ${typography.fontSizes.sm};`,
  `  --font-size-base:         ${typography.fontSizes.base};`,
  `  --font-size-lg:           ${typography.fontSizes.lg};`,
  `  --font-size-xl:           ${typography.fontSizes.xl};`,
  `  --font-size-2xl:          ${typography.fontSizes["2xl"]};`,
  `  --font-size-3xl:          ${typography.fontSizes["3xl"]};`,
  `  --font-size-4xl:          ${typography.fontSizes["4xl"]};`,
  `  --font-weight-normal:     ${typography.fontWeights.normal};`,
  `  --font-weight-medium:     ${typography.fontWeights.medium};`,
  `  --font-weight-bold:       ${typography.fontWeights.bold};`,
  `  --font-weight-black:      ${typography.fontWeights.black};`,
  `  --letter-spacing-normal:  ${typography.letterSpacing.normal};`,
  `  --letter-spacing-wide:    ${typography.letterSpacing.wide};`,
  `  --letter-spacing-wider:   ${typography.letterSpacing.wider};`,
  "",
  "  /* ── Spacing & borders ──────────────────────────── */",
  `  --border-width:           ${spacing.borderWidth};`,
  `  --border-width-thick:     ${spacing.borderWidthThick};`,
  `  --shadow-offset-x:        ${spacing.shadowOffsetX};`,
  `  --shadow-offset-y:        ${spacing.shadowOffsetY};`,
  `  --shadow-color:           ${spacing.shadowColor};`,
  `  --border-radius:          ${spacing.borderRadius};`,
  "",
  "  /* ── Component shadows ──────────────────────────── */",
  `  --shadow-button:          ${components.button.shadow};`,
  `  --shadow-button-hover:    ${components.button.shadowHover};`,
  `  --shadow-card:            ${components.card.shadow};`,
  `  --shadow-input:           ${components.input.shadow};`,
  `  --shadow-bubble:          ${components.chatBubble.shadow};`,
  "",
  "  /* ── Component layout ───────────────────────────── */",
  `  --nav-width:              ${components.nav.width};`,
  `  --nav-bg:                 ${components.nav.background};`,
  `  --chat-user-bg:           ${components.chatBubble.userBackground};`,
  `  --chat-user-fg:           ${components.chatBubble.userForeground};`,
  `  --chat-assistant-bg:      ${components.chatBubble.assistantBackground};`,
  `  --chat-assistant-fg:      ${components.chatBubble.assistantForeground};`,
  `  --btn-padding-x:          ${components.button.paddingX};`,
  `  --btn-padding-y:          ${components.button.paddingY};`,
  `  --btn-letter-spacing:     ${components.button.letterSpacing};`,
  `  --btn-font-weight:        ${components.button.fontWeight};`,
  `  --card-padding:           ${components.card.padding};`,
  `  --input-padding-x:        ${components.input.paddingX};`,
  `  --input-padding-y:        ${components.input.paddingY};`,
  "}",
  "",
  "@theme inline {",
  "  --color-background:   var(--color-background);",
  "  --color-surface:      var(--color-surface);",
  "  --color-foreground:   var(--color-foreground);",
  "  --color-border:       var(--color-border);",
  "  --color-accent:       var(--color-accent);",
  "  --color-accent-fg:    var(--color-accent-fg);",
  "  --color-muted:        var(--color-muted);",
  "  --color-muted-bg:     var(--color-muted-bg);",
  "  --color-danger:       var(--color-danger);",
  "  --color-danger-fg:    var(--color-danger-fg);",
  "  --color-success:      var(--color-success);",
  "  --color-success-fg:   var(--color-success-fg);",
  "  --color-warning:      var(--color-warning);",
  "  --color-warning-fg:   var(--color-warning-fg);",
  "  --font-family-sans:   var(--font-sans);",
  "  --font-family-mono:   var(--font-mono);",
  "  --radius-DEFAULT:     var(--border-radius);",
  "}",
];

const out = lines.join("\n") + "\n";
const outPath = resolve(root, "app/theme.generated.css");
writeFileSync(outPath, out, "utf8");
console.log(`✓ theme.generated.css written (${out.length} bytes)`);
