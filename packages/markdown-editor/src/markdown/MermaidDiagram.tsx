"use client";

import { useEffect, useId, useState } from "react";

type Props = {
  code: string;
  className?: string;
  isStreaming?: boolean;
};

let mermaidInitialized = false;

export function MermaidDiagram({ code, className, isStreaming }: Props) {
  const id = useId().replace(/:/g, "-");
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "base",
            securityLevel: "loose",
            themeVariables: {
              primaryColor: "#C8DCE8",
              primaryTextColor: "#000000",
              primaryBorderColor: "#000000",
              lineColor: "#000000",
              secondaryColor: "#E8F4F8",
              tertiaryColor: "#FFFFFF",
            },
          });
          mermaidInitialized = true;
        }

        const rendered = await mermaid.render(`mermaid-${id}`, code);
        if (!cancelled) {
          setSvg(rendered.svg);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          // Mermaid appends an error div to document.body on failure — remove it.
          document.getElementById(`dmermaid-${id}`)?.remove();
          setError(err instanceof Error ? err.message : "Could not render Mermaid diagram.");
          setSvg("");
        }
      }
    }

    if (code.trim() && !isStreaming) {
      void render();
    }

    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (error) {
    return (
      <div
        className={className}
        style={{ borderRadius: "var(--radius-md)" }}
      >
        <div className="border border-[var(--color-danger)] bg-[#FFD6CC] px-4 py-3 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      </div>
    );
  }

  if (!svg) return null;

  return (
    <div
      className={className}
      style={{ borderRadius: "var(--radius-md)" }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
