import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./cn";

type Variant = "flat" | "elevated" | "outlined";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
}

const variants: Record<Variant, string> = {
  flat: "bg-[var(--color-surface)] border border-[var(--color-border)]",
  elevated:
    "bg-[var(--color-surface-elevated)] border border-[var(--color-border-subtle)] shadow-[var(--shadow-md)]",
  outlined: "bg-transparent border border-[var(--color-border-strong)]",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = "flat", className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        variants[variant],
        "rounded-[var(--radius-lg)] p-[var(--card-padding)]",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1 mb-3", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "font-[var(--font-serif)] text-[var(--font-size-xl)] font-semibold text-[var(--color-text)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-[var(--font-size-sm)] text-[var(--color-text-muted)]",
        className,
      )}
      {...props}
    />
  );
}
