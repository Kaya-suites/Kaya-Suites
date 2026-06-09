"use client";

import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-python";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import Link from "next/link";
import {
  inlineHtmlToMarkdown,
  parseMarkdownToBlocks,
  type MarkdownBlock,
  type MarkdownAlignment,
} from "@kaya/markdown-model";
import { useEditorContext } from "../EditorContext";
import { MermaidDiagram } from "./MermaidDiagram";

type Props = {
  markdown: string;
  className?: string;
  decorateText?: (text: string) => ReactNode;
  isStreaming?: boolean;
};

function InlineMarkdown({
  markdown,
  decorateText,
}: {
  markdown: string;
  decorateText?: (text: string) => ReactNode;
}) {
  const children = useMemo(() => renderInline(markdown, decorateText), [markdown, decorateText]);
  return <>{children}</>;
}

function renderInline(markdown: string, decorateText?: (text: string) => ReactNode): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < markdown.length) {
    const rest = markdown.slice(index);

    const image = rest.match(/^!\[([^\]]*)]\(([^)\s]+)(?:\s+"([^"]+)")?\)/);
    if (image) {
      nodes.push(
        <img
          key={`img-${key++}`}
          src={image[2]}
          alt={image[1]}
          className="my-3 max-w-full border border-[var(--color-border)] bg-[var(--color-surface)]"
          style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)" }}
        />,
      );
      index += image[0].length;
      continue;
    }

    const link = rest.match(/^\[([^\]]+)]\(([^)\s]+)(?:\s+"([^"]+)")?\)/);
    if (link) {
      nodes.push(
        <Link
          key={`link-${key++}`}
          href={link[2]}
          className="text-[var(--color-accent)] underline underline-offset-2 hover:text-[var(--color-accent-hover)]"
          target="_blank"
          rel="noreferrer"
        >
          <InlineMarkdown markdown={link[1]} decorateText={decorateText} />
        </Link>,
      );
      index += link[0].length;
      continue;
    }

    const strong = rest.match(/^\*\*([^*]+)\*\*/);
    if (strong) {
      nodes.push(
        <strong key={`strong-${key++}`} className="font-bold text-[var(--color-text)]">
          <InlineMarkdown markdown={strong[1]} decorateText={decorateText} />
        </strong>,
      );
      index += strong[0].length;
      continue;
    }

    const strike = rest.match(/^~~([^~]+)~~/);
    if (strike) {
      nodes.push(
        <s key={`strike-${key++}`}>
          <InlineMarkdown markdown={strike[1]} decorateText={decorateText} />
        </s>,
      );
      index += strike[0].length;
      continue;
    }

    const em = rest.match(/^\*([^*]+)\*/);
    if (em) {
      nodes.push(
        <em key={`em-${key++}`}>
          <InlineMarkdown markdown={em[1]} decorateText={decorateText} />
        </em>,
      );
      index += em[0].length;
      continue;
    }

    const code = rest.match(/^`([^`]+)`/);
    if (code) {
      nodes.push(
        <code
          key={`code-${key++}`}
          className="bg-[var(--color-bg-subtle)] rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[0.875em] font-[var(--font-mono)] text-[var(--color-text)]"
        >
          {code[1]}
        </code>,
      );
      index += code[0].length;
      continue;
    }

    const html = rest.match(/^<[^>]+>/);
    if (html) {
      nodes.push(
        <span
          key={`html-${key++}`}
          className="inline-block bg-[var(--color-bg-subtle)] rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[0.875em] font-[var(--font-mono)]"
        >
          {html[0]}
        </span>,
      );
      index += html[0].length;
      continue;
    }

    let next = markdown.length;
    for (const marker of ["![", "[", "**", "~~", "*", "`", "<"]) {
      const markerIndex = markdown.indexOf(marker, index + 1);
      if (markerIndex !== -1) next = Math.min(next, markerIndex);
    }
    const text = markdown.slice(index, next);
    nodes.push(
      <Fragment key={`text-${key++}`}>
        {decorateText ? decorateText(text) : text}
      </Fragment>,
    );
    index = next;
  }

  return nodes;
}

function highlightCode(code: string, language: string) {
  const normalized = language.toLowerCase();
  const alias: Record<string, string> = { js: "javascript", ts: "typescript", sh: "bash" };
  const key = alias[normalized] ?? normalized;
  const prismLanguage = Prism.languages[key] ?? Prism.languages.markup;

  if (!prismLanguage) return escapeHtmlEntities(code);
  return Prism.highlight(code, prismLanguage, key || "markup");
}

function escapeHtmlEntities(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function alignmentClass(alignment: MarkdownAlignment) {
  switch (alignment) {
    case "center":
      return "text-center";
    case "right":
      return "text-right";
    default:
      return "text-left";
  }
}

function MarkdownTable({
  block,
  decorateText,
  stickyTopOffset,
}: {
  block: Extract<MarkdownBlock, { type: "table" }>;
  decorateText?: (text: string) => ReactNode;
  stickyTopOffset: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRowRef = useRef<HTMLTableRowElement>(null);
  const [stickyActive, setStickyActive] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const scrollParent = node.closest<HTMLElement>("[data-editor-scroll]");

    const updateStickyState = () => {
      const containerRect = node.getBoundingClientRect();
      const headerHeight = headerRowRef.current?.getBoundingClientRect().height ?? 0;
      const nextSticky =
        containerRect.top <= stickyTopOffset &&
        containerRect.bottom - headerHeight > stickyTopOffset;
      setStickyActive((current) => (current === nextSticky ? current : nextSticky));
    };

    updateStickyState();
    const scrollTarget: HTMLElement | Window = scrollParent ?? window;
    scrollTarget.addEventListener("scroll", updateStickyState, { passive: true });
    window.addEventListener("resize", updateStickyState);

    return () => {
      scrollTarget.removeEventListener("scroll", updateStickyState);
      window.removeEventListener("resize", updateStickyState);
    };
  }, [stickyTopOffset]);

  return (
    <div
      ref={containerRef}
      className="mb-4 overflow-x-auto overflow-y-visible border border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)" }}
    >
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr ref={headerRowRef}>
            {block.header.map((cell, columnIndex) => (
              <th
                key={`${block.id}-head-${columnIndex}`}
                data-sticky-header="true"
                className={`border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 font-medium break-words ${alignmentClass(block.alignments[columnIndex] ?? null)} ${columnIndex < block.header.length - 1 ? "border-r-2" : ""}`}
                style={
                  stickyActive
                    ? {
                        top: `${stickyTopOffset}px`,
                        position: "sticky",
                        zIndex: 10,
                        boxShadow: "inset 0 -2px 0 black, 0 4px 0 rgba(0,0,0,0.04)",
                      }
                    : undefined
                }
              >
                <InlineMarkdown markdown={inlineHtmlToMarkdown(cell)} decorateText={decorateText} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={`${block.id}-row-${rowIndex}`}>
              {row.map((cell, columnIndex) => (
                <td
                  key={`${block.id}-row-${rowIndex}-col-${columnIndex}`}
                  className={`border-b border-[var(--color-border)] px-3 py-2 break-words ${alignmentClass(block.alignments[columnIndex] ?? null)} ${columnIndex < row.length - 1 ? "border-r-2" : ""}`}
                >
                  <InlineMarkdown markdown={inlineHtmlToMarkdown(cell)} decorateText={decorateText} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MarkdownContent({ markdown, className, decorateText, isStreaming }: Props) {
  const blocks = useMemo(() => parseMarkdownToBlocks(markdown), [markdown]);
  const { stickyTopOffset } = useEditorContext();

  return (
    <div className={className}>
      {blocks.map((block) => {
        switch (block.type) {
          case "paragraph":
            return (
              <p
                key={block.id}
                className="mb-3 last:mb-0 leading-relaxed"
                style={{
                  paddingLeft: block.depth > 0 ? `${block.depth * 1.5}rem` : undefined,
                  borderLeft: block.depth > 0 ? "2px solid var(--color-text-muted)" : undefined,
                }}
              >
                <InlineMarkdown markdown={inlineHtmlToMarkdown(block.html)} decorateText={decorateText} />
              </p>
            );
          case "heading": {
            const serif = "font-[var(--font-serif)] tracking-tight";
            const headingClass =
              block.level === 1
                ? `mb-3 text-3xl font-semibold ${serif}`
                : block.level === 2
                  ? `mb-3 mt-6 text-2xl font-semibold ${serif}`
                  : `mb-3 mt-4 text-xl font-semibold ${serif}`;
            const depthStyle = block.depth > 0
              ? { paddingLeft: `${block.depth * 1.5}rem`, borderLeft: "2px solid var(--color-text-muted)" }
              : undefined;
            const content = <InlineMarkdown markdown={inlineHtmlToMarkdown(block.html)} decorateText={decorateText} />;
            if (block.level === 1) return <h1 key={block.id} className={headingClass} style={depthStyle}>{content}</h1>;
            if (block.level === 2) return <h2 key={block.id} className={headingClass} style={depthStyle}>{content}</h2>;
            if (block.level === 3) return <h3 key={block.id} className={headingClass} style={depthStyle}>{content}</h3>;
            if (block.level === 4) return <h4 key={block.id} className={headingClass} style={depthStyle}>{content}</h4>;
            if (block.level === 5) return <h5 key={block.id} className={headingClass} style={depthStyle}>{content}</h5>;
            return <h6 key={block.id} className={headingClass} style={depthStyle}>{content}</h6>;
          }
          case "blockquote":
            return (
              <blockquote
                key={block.id}
                className="mb-3 border-l-2 border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] px-4 py-3"
                style={{ borderRadius: "var(--radius-md)", marginLeft: block.depth > 0 ? `${block.depth * 1.5}rem` : undefined }}
              >
                <InlineMarkdown markdown={inlineHtmlToMarkdown(block.html)} decorateText={decorateText} />
              </blockquote>
            );
          case "list": {
            const orderedCounters = new Map<number, number>();
            return (
              <div key={block.id} className="mb-3 last:mb-0 space-y-1">
                {block.items.map((item) => {
                  let prefix: ReactNode;
                  if (item.checked !== null) {
                    prefix = (
                      <span className="mt-1 inline-flex h-4 w-4 items-center justify-center border border-[var(--color-border)] text-[10px]">
                        {item.checked ? "x" : ""}
                      </span>
                    );
                  } else if (item.ordered) {
                    const counter = orderedCounters.get(item.depth) ?? (item.depth === 0 ? block.start : 1);
                    orderedCounters.set(item.depth, counter + 1);
                    for (const depth of orderedCounters.keys()) {
                      if (depth > item.depth) orderedCounters.delete(depth);
                    }
                    prefix = <span className="min-w-6 text-right font-bold">{counter}.</span>;
                  } else {
                    prefix = <span className="min-w-4 text-center font-bold">•</span>;
                  }

                  return (
                    <div key={item.id} className="flex gap-2" style={{ paddingLeft: `${item.depth * 1.5}rem` }}>
                      {prefix}
                      <div className="flex-1">
                        <InlineMarkdown markdown={inlineHtmlToMarkdown(item.html)} decorateText={decorateText} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }
          case "table":
            return (
              <MarkdownTable
                key={block.id}
                block={block}
                decorateText={decorateText}
                stickyTopOffset={stickyTopOffset}
              />
            );
          case "code":
            if (block.language.toLowerCase() === "mermaid") {
              return (
                <div key={block.id} className="mb-4 space-y-3">
                  <pre
                    className="overflow-x-auto border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4 text-xs"
                    style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)" }}
                  >
                    <code>{block.code}</code>
                  </pre>
                  <MermaidDiagram
                    code={block.code}
                    className="overflow-auto border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
                    isStreaming={isStreaming}
                  />
                </div>
              );
            }

            return (
              <div key={block.id} className="mb-4 overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]" style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)" }}>
                <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-1.5 text-[10px] font-medium tracking-[0.18em] text-[var(--color-text)]">
                  {block.language || "plain text"}
                </div>
                <pre className="overflow-x-auto p-4 text-xs">
                  <code
                    className={`language-${block.language || "markup"}`}
                    dangerouslySetInnerHTML={{ __html: highlightCode(block.code, block.language) }}
                  />
                </pre>
              </div>
            );
          case "image":
            return (
              <figure key={block.id} className="mb-4">
                <img
                  src={block.src}
                  alt={block.alt}
                  className="max-w-full border border-[var(--color-border)] bg-[var(--color-surface)]"
                  style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)" }}
                />
                {(block.alt || block.title) && (
                  <figcaption className="mt-2 text-xs  text-[var(--color-text-muted)]">
                    {block.alt || block.title}
                  </figcaption>
                )}
              </figure>
            );
          case "hr":
            return <hr key={block.id} className="my-6 border-0 border-t border-[var(--color-border)]" />;
          case "html":
            return (
              <pre
                key={block.id}
                className="mb-4 overflow-x-auto border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4 text-xs text-[var(--color-text)]"
                style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)" }}
              >
                <code>{block.source}</code>
              </pre>
            );
        }
      })}
    </div>
  );
}
