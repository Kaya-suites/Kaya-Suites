import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  "inline-flex items-center justify-center gap-2 font-medium select-none " +
  "transition-colors duration-150 ease-out " +
  "disabled:opacity-50 disabled:cursor-not-allowed " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]";

const variants: Record<Variant, string> = {
  primary:
    "bg-[var(--color-accent)] text-[var(--color-accent-fg)] " +
    "hover:bg-[var(--color-accent-hover)] " +
    "rounded-[var(--radius-md)]",
  secondary:
    "bg-[var(--color-surface)] text-[var(--color-text)] " +
    "border border-[var(--color-border)] " +
    "hover:bg-[var(--color-bg-subtle)] " +
    "rounded-[var(--radius-md)]",
  ghost:
    "bg-transparent text-[var(--color-text)] " +
    "hover:bg-[var(--color-bg-subtle)] " +
    "rounded-[var(--radius-md)]",
  danger:
    "bg-[var(--color-danger)] text-[var(--color-danger-fg)] " +
    "hover:opacity-90 " +
    "rounded-[var(--radius-md)]",
  link:
    "bg-transparent text-[var(--color-accent)] underline underline-offset-2 " +
    "hover:text-[var(--color-accent-hover)] " +
    "px-0 py-0",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[var(--font-size-sm)]",
  md: "h-10 px-4 text-[var(--font-size-base)]",
  lg: "h-12 px-6 text-[var(--font-size-lg)]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        base,
        variants[variant],
        variant !== "link" && sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
