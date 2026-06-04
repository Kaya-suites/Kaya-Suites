"use client";

import { useEffect, useRef, useState } from "react";
import type { OnboardingStep } from "@/hooks/useOnboarding";
import { X, Check } from "lucide-react";

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
      const t = setTimeout(() => { setCelebrating(false); setExpanded(false); }, 2000);
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
    try { await onSeedDemo(); } finally { setSeeding(false); }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 bg-[var(--color-surface)] border-2 border-black px-3 py-1.5 text-xs text-black font-bold font-mono uppercase tracking-wider hover:bg-[var(--color-muted-bg)] transition-all"
        style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
      >
        <svg viewBox="0 0 20 20" className="w-4 h-4 -rotate-90 flex-shrink-0">
          <circle cx="10" cy="10" r="8" fill="none" stroke="#000" strokeWidth="2.5" />
          <circle
            cx="10" cy="10" r="8" fill="none"
            stroke={allDone ? "var(--color-success)" : "var(--color-accent)"}
            strokeWidth="2.5"
            strokeDasharray={`${(progressPct / 100) * 50.3} 50.3`}
            strokeLinecap="round"
          />
        </svg>
        <span>{doneCount} / {totalCount} steps</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 w-[290px]">
      <div
        className="bg-[var(--color-surface)] border-2 overflow-hidden"
        style={{
          borderColor: celebrating ? "var(--color-success)" : "var(--color-border)",
          borderRadius: "var(--border-radius)",
          boxShadow: celebrating ? "4px 4px 0px var(--color-success)" : "var(--shadow-card)",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b-2"
          style={{ borderColor: celebrating ? "var(--color-success)" : "var(--color-border)", background: celebrating ? "#C8F0D8" : "var(--color-background)" }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 border-2 border-black bg-black flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 font-mono"
              style={{ borderRadius: "var(--border-radius)" }}
            >
              K
            </div>
            <span className="text-xs font-bold text-black uppercase tracking-wider font-mono">
              {celebrating ? "GREAT WORK!" : "GET STARTED"}
            </span>
          </div>
          <button
            onClick={onDismiss}
            className="text-black hover:text-[var(--color-muted)] transition-colors flex-shrink-0 border-2 border-transparent hover:border-black p-0.5"
            style={{ borderRadius: "var(--border-radius)" }}
            title="Dismiss"
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        </div>

        <div className="h-1 bg-[var(--color-muted-bg)]">
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${progressPct}%`, background: allDone ? "var(--color-success)" : "var(--color-accent)" }}
          />
        </div>

        <div className="px-4 py-3 space-y-3">
          {steps.map((step) => (
            <div key={step.id}>
              <div className="flex items-start gap-2.5">
                <div
                  className="mt-0.5 w-4 h-4 border-2 flex-shrink-0 flex items-center justify-center transition-colors"
                  style={{
                    background: step.done ? "var(--color-accent)" : "transparent",
                    borderColor: step.done ? "var(--color-accent)" : "var(--color-border)",
                    borderRadius: "var(--border-radius)",
                  }}
                >
                  {step.done && <Check size={10} strokeWidth={2.5} className="text-white" />}
                </div>
                <span
                  className={`text-xs leading-tight font-mono ${
                    step.done ? "line-through text-[var(--color-muted)]" : "text-black font-bold"
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {step.id === "add_document" && !step.done && (
                <div className="ml-[26px] mt-2 flex gap-2">
                  <button
                    onClick={handleSeedDemo}
                    disabled={seeding}
                    className="text-xs px-2.5 py-1 border-2 border-black bg-black text-white font-bold uppercase tracking-wider font-mono disabled:opacity-50 hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)] transition-all"
                    style={{ borderRadius: "var(--border-radius)" }}
                  >
                    {seeding ? "Loading…" : "Try demo doc"}
                  </button>
                  <a
                    href="/documents"
                    className="text-xs px-2.5 py-1 border-2 border-black text-black font-bold uppercase tracking-wider font-mono hover:bg-[var(--color-muted-bg)] transition-all"
                    style={{ borderRadius: "var(--border-radius)" }}
                  >
                    Import own
                  </a>
                </div>
              )}

              {step.id === "set_api_key" && !step.done && (
                <div className="ml-[26px] mt-2 space-y-1.5">
                  <p className="text-xs text-[var(--color-muted)] font-mono">
                    Add{" "}
                    <code className="bg-[var(--color-muted-bg)] border border-black px-1 font-mono">
                      ANTHROPIC_API_KEY
                    </code>{" "}
                    to your <code className="bg-[var(--color-muted-bg)] border border-black px-1 font-mono">.env</code> file.
                  </p>
                  <button
                    onClick={() => onMarkComplete("set_api_key")}
                    className="text-xs text-[var(--color-muted)] underline hover:text-black transition-colors font-mono"
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
            className="text-xs text-[var(--color-muted)] hover:text-black transition-colors font-mono font-bold uppercase tracking-wider"
          >
            Minimize
          </button>
        </div>
      </div>
    </div>
  );
}
