import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full h-10 px-3 text-[var(--font-size-base)]",
        "bg-[var(--color-surface)] text-[var(--color-text)]",
        "border rounded-[var(--radius-md)]",
        invalid
          ? "border-[var(--color-danger)]"
          : "border-[var(--color-border)]",
        "placeholder:text-[var(--color-text-subtle)]",
        "transition-colors duration-150 ease-out",
        "focus:outline-none focus:border-[var(--color-accent)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
