import type { MarkdownBlock } from "@kaya/markdown-model";

export type SlashState = {
  blockId: string;
  query: string;
  itemId?: string;
};

export type LinkDialogState = {
  blockId: string;
  href: string;
  open: boolean;
  anchor: HTMLAnchorElement | null;
  range: Range | null;
};

export type ImageDialogState = {
  open: boolean;
  alt: string;
  src: string;
  title: string;
};

export type DropIndicatorState = {
  blockId: string;
  position: "before" | "after";
};

export type SlashCommand = {
  key: string;
  label: string;
  description: string;
  build: () => MarkdownBlock;
};
