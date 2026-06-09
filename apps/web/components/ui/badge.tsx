import { type HTMLAttributes } from "react";
import { cn } from "./cn";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

const tones: Record<Tone, string> = {
  neutral:
    "bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)] border-[var(--color-border)]",
  accent:
    "bg-[var(--color-accent-muted)] text-[var(--color-accent-hover)] border-[var(--color-accent-muted)]",
  success:
    "bg-[var(--color-bg-subtle)] text-[var(--color-success)] border-[var(--color-border)]",
  warning:
    "bg-[var(--color-bg-subtle)] text-[var(--color-warning)] border-[var(--color-border)]",
  danger:
    "bg-[var(--color-bg-subtle)] text-[var(--color-danger)] border-[var(--color-border)]",
};

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5",
        "text-[var(--font-size-xs)] font-medium",
        "border rounded-[var(--radius-pill)]",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
