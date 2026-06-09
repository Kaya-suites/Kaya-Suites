"use client";

import { useEffect, useRef, useState } from "react";
import type { OnboardingStep } from "@/hooks/useOnboarding";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

type Step = { id: OnboardingStep; label: string; done: boolean };

type Props = {
  isLoaded: boolean;
  dismissed: boolean;
  steps: Step[];
  demoSeeded: boolean;
  onDismiss: () => void;
  onSeedDemo: () => Promise<void>;
  onMarkComplete: (step: OnboardingStep) => void;
};

export function OnboardingChecklist({
  isLoaded,
  dismissed,
  steps,
  onDismiss,
  onSeedDemo,
  onMarkComplete,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const [celebrating, setCelebrating] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const prevAha = useRef(false);

  const ahaStep = steps.find((s) => s.id === "approve_first_diff");
  const ahaComplete = ahaStep?.done ?? false;

  useEffect(() => {
    if (ahaComplete && !prevAha.current) {
      prevAha.current = true;
      setCelebrating(true);
      const t = setTimeout(() => {
        setCelebrating(false);
        setExpanded(false);
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [ahaComplete]);

  if (!isLoaded || dismissed) return null;

  const doneCount = steps.filter((s) => s.done).length;
  const totalCount = steps.length;
  const progressPct = Math.round((doneCount / totalCount) * 100);
  const allDone = doneCount === totalCount;

  async function handleSeedDemo() {
    setSeeding(true);
    try {
      await onSeedDemo();
    } finally {
      setSeeding(false);
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="fixed bottom-4 left-4 z-50 inline-flex items-center gap-2 rounded-[var(--radius-pill)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-md)] px-3 py-1.5 text-[var(--font-size-sm)] text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
      >
        <svg viewBox="0 0 20 20" className="w-4 h-4 -rotate-90 flex-shrink-0">
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="2"
          />
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke={allDone ? "var(--color-success)" : "var(--color-text)"}
            strokeWidth="2"
            strokeDasharray={`${(progressPct / 100) * 50.3} 50.3`}
            strokeLinecap="round"
          />
        </svg>
        <span>
          {doneCount} / {totalCount} steps
        </span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 w-[300px]">
      <div
        className={cn(
          "rounded-[var(--radius-lg)] border bg-[var(--color-surface)] shadow-[var(--shadow-lg)] overflow-hidden",
          celebrating
            ? "border-[var(--color-success)]"
            : "border-[var(--color-border)]",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-between px-4 py-3 border-b",
            celebrating
              ? "border-[var(--color-success)] bg-[var(--color-bg-subtle)]"
              : "border-[var(--color-border)] bg-[var(--color-surface)]",
          )}
        >
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] text-[var(--color-text)] text-[10px] font-semibold flex-shrink-0">
              K
            </div>
            <span className="font-[var(--font-serif)] text-[var(--font-size-base)] font-semibold tracking-tight text-[var(--color-text)]">
              {celebrating ? "Great work" : "Get started"}
            </span>
          </div>
          <button
            onClick={onDismiss}
            aria-label="Dismiss onboarding"
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] rounded-[var(--radius-md)] p-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        </div>

        <div className="h-1 bg-[var(--color-bg-subtle)]">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${progressPct}%`,
              background: allDone
                ? "var(--color-success)"
                : "var(--color-text)",
            }}
          />
        </div>

        <div className="px-4 py-3 space-y-3">
          {steps.map((step) => (
            <div key={step.id}>
              <div className="flex items-start gap-2.5">
                <div
                  className={cn(
                    "mt-0.5 w-4 h-4 rounded-[var(--radius-sm)] border flex-shrink-0 inline-flex items-center justify-center transition-colors",
                    step.done
                      ? "bg-[var(--color-text)] border-[var(--color-text)]"
                      : "bg-transparent border-[var(--color-border)]",
                  )}
                >
                  {step.done && (
                    <Check
                      size={10}
                      strokeWidth={2.5}
                      className="text-[var(--color-text-inverse)]"
                    />
                  )}
                </div>
                <span
                  className={cn(
                    "text-[var(--font-size-sm)] leading-snug",
                    step.done
                      ? "line-through text-[var(--color-text-subtle)]"
                      : "text-[var(--color-text)] font-medium",
                  )}
                >
                  {step.label}
                </span>
              </div>

              {step.id === "add_document" && !step.done && (
                <div className="ml-[26px] mt-2 flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSeedDemo}
                    disabled={seeding}
                  >
                    {seeding ? "Loading…" : "Try demo doc"}
                  </Button>
                  <a href="/documents">
                    <Button size="sm" variant="secondary">
                      Import own
                    </Button>
                  </a>
                </div>
              )}

              {step.id === "set_api_key" && !step.done && (
                <div className="ml-[26px] mt-2 space-y-1.5">
                  <p className="text-[var(--font-size-sm)] text-[var(--color-text-muted)] leading-relaxed">
                    Add{" "}
                    <code className="bg-[var(--color-bg-subtle)] rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[0.85em] font-[var(--font-mono)]">
                      ANTHROPIC_API_KEY
                    </code>{" "}
                    to your{" "}
                    <code className="bg-[var(--color-bg-subtle)] rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[0.85em] font-[var(--font-mono)]">
                      .env
                    </code>{" "}
                    file.
                  </p>
                  <button
                    onClick={() => onMarkComplete("set_api_key")}
                    className="text-[var(--font-size-sm)] text-[var(--color-text-muted)] underline underline-offset-2 hover:text-[var(--color-text)] transition-colors"
                  >
                    I&apos;ve set it
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="px-4 pb-3">
          <button
            onClick={() => setExpanded(false)}
            className="text-[var(--font-size-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Minimize
          </button>
        </div>
      </div>
    </div>
  );
}
