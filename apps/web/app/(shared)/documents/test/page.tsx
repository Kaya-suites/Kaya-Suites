"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";

const MDXEditorClient = dynamic(
  () => import("@/components/shared/MDXEditorClient"),
  { ssr: false, loading: () => <div className="animate-pulse h-64 bg-[var(--color-bg-subtle)] border border-[var(--color-border)]" style={{ borderRadius: "var(--radius-md)" }} /> }
);

const INITIAL_MARKDOWN = `# Test page

This editor is powered by **MDXEditor**. Try editing this content!

- Item one
- Item two
- Item three

> A blockquote example.

\`\`\`ts
const greeting = "Hello from MDXEditor";
console.log(greeting);
\`\`\`
`;

export default function TestPage() {
  const [markdown, setMarkdown] = useState(INITIAL_MARKDOWN);

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b-2 border-black bg-[var(--color-background)]">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs font-mono font-bold uppercase tracking-wider text-black">
            <Link
              href="/documents"
              className="hover:text-[var(--color-accent)] transition-colors"
            >
              Documents
            </Link>
            <span className="text-[var(--color-muted)]">/</span>
            <span>Test</span>
          </div>
          <span className="text-xs text-[var(--color-muted)] font-mono">MDXEditor</span>
        </div>
      </div>

      {/* Editor */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div
          className="bg-[var(--color-surface)] border-2 border-black overflow-hidden"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
        >
          <MDXEditorClient markdown={markdown} onChange={setMarkdown} />
        </div>

        {/* Raw markdown preview */}
        <details className="mt-4">
          <summary className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--color-muted)] cursor-pointer hover:text-black transition-colors">
            Raw markdown
          </summary>
          <pre
            className="mt-2 p-4 border-2 border-black text-xs font-mono whitespace-pre-wrap bg-[var(--color-surface)] text-[var(--color-muted)]"
            style={{ borderRadius: "var(--border-radius)" }}
          >
            {markdown}
          </pre>
        </details>
      </div>
    </div>
  );
}
