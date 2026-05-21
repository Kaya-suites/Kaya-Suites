"use client";

import { KayaMarkdownEditor } from "./KayaMarkdownEditor";

type Props = {
  markdown: string;
  onChange: (value: string) => void;
};

export function MDXEditorClient({ markdown, onChange }: Props) {
  return <KayaMarkdownEditor markdown={markdown} onChange={onChange} />;
}
