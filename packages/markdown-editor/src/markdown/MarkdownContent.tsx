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
          className="my-3 max-w-full border-2 border-black bg-white"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
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
          className="text-[var(--color-accent)] underline font-bold hover:opacity-70"
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
        <strong key={`strong-${key++}`} className="font-bold text-black">
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
          className="bg-[var(--color-muted-bg)] border border-black px-1 py-0.5 text-xs font-mono text-black"
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
          className="inline-block bg-[var(--color-muted-bg)] border border-black px-1 py-0.5 text-xs font-mono"
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
      className="mb-4 overflow-x-auto overflow-y-visible border-2 border-black bg-white"
      style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
    >
      <table className="min-w-full border-separate border-spacing-0 text-sm font-mono">
        <thead>
          <tr ref={headerRowRef}>
            {block.header.map((cell, columnIndex) => (
              <th
                key={`${block.id}-head-${columnIndex}`}
                data-sticky-header="true"
                className={`border-b-2 border-black bg-[var(--color-muted-bg)] px-3 py-2 font-bold uppercase tracking-wide break-words ${alignmentClass(block.alignments[columnIndex] ?? null)} ${columnIndex < block.header.length - 1 ? "border-r-2" : ""}`}
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
                  className={`border-b-2 border-black px-3 py-2 break-words ${alignmentClass(block.alignments[columnIndex] ?? null)} ${columnIndex < row.length - 1 ? "border-r-2" : ""}`}
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
                className="mb-3 last:mb-0 font-mono leading-relaxed"
                style={{
                  paddingLeft: block.depth > 0 ? `${block.depth * 1.5}rem` : undefined,
                  borderLeft: block.depth > 0 ? "2px solid var(--color-muted)" : undefined,
                }}
              >
                <InlineMarkdown markdown={inlineHtmlToMarkdown(block.html)} decorateText={decorateText} />
              </p>
            );
          case "heading": {
            const headingClass =
              block.level === 1
                ? "mb-3 text-2xl font-bold font-mono"
                : block.level === 2
                  ? "mb-3 mt-6 text-lg font-bold font-mono"
                  : "mb-3 mt-4 text-base font-bold font-mono";
            const depthStyle = block.depth > 0
              ? { paddingLeft: `${block.depth * 1.5}rem`, borderLeft: "2px solid var(--color-muted)" }
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
                className="mb-3 border-l-4 border-black bg-[var(--color-muted-bg)] px-4 py-3 font-mono"
                style={{ borderRadius: "var(--border-radius)", marginLeft: block.depth > 0 ? `${block.depth * 1.5}rem` : undefined }}
              >
                <InlineMarkdown markdown={inlineHtmlToMarkdown(block.html)} decorateText={decorateText} />
              </blockquote>
            );
          case "list": {
            const orderedCounters = new Map<number, number>();
            return (
              <div key={block.id} className="mb-3 last:mb-0 space-y-1 font-mono">
                {block.items.map((item) => {
                  let prefix: ReactNode;
                  if (item.checked !== null) {
                    prefix = (
                      <span className="mt-1 inline-flex h-4 w-4 items-center justify-center border-2 border-black text-[10px]">
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
                    className="overflow-x-auto border-2 border-black bg-[var(--color-muted-bg)] p-4 text-xs font-mono"
                    style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
                  >
                    <code>{block.code}</code>
                  </pre>
                  <MermaidDiagram
                    code={block.code}
                    className="overflow-auto border-2 border-black bg-white p-4"
                    isStreaming={isStreaming}
                  />
                </div>
              );
            }

            return (
              <div key={block.id} className="mb-4 overflow-hidden border-2 border-black bg-[var(--color-surface)]" style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}>
                <div className="border-b-2 border-black bg-[var(--color-muted-bg)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-black">
                  {block.language || "plain text"}
                </div>
                <pre className="overflow-x-auto p-4 text-xs">
                  <code
                    className={`language-${block.language || "markup"} font-mono`}
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
                  className="max-w-full border-2 border-black bg-white"
                  style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
                />
                {(block.alt || block.title) && (
                  <figcaption className="mt-2 text-xs uppercase tracking-wide text-[var(--color-muted)] font-mono">
                    {block.alt || block.title}
                  </figcaption>
                )}
              </figure>
            );
          case "hr":
            return <hr key={block.id} className="my-6 border-0 border-t-2 border-black" />;
          case "html":
            return (
              <pre
                key={block.id}
                className="mb-4 overflow-x-auto border-2 border-black bg-[var(--color-muted-bg)] p-4 text-xs font-mono text-black"
                style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
              >
                <code>{block.source}</code>
              </pre>
            );
        }
      })}
    </div>
  );
}
