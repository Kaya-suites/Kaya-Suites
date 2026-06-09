import { useId, type ReactNode } from "react";
import { cn } from "./cn";

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy?: string }) => ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={id}
        className="text-[var(--font-size-sm)] font-medium text-[var(--color-text)]"
      >
        {label}
        {required && (
          <span className="ml-0.5 text-[var(--color-danger)]" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({ id, describedBy })}
      {hint && !error && (
        <p
          id={hintId}
          className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]"
        >
          {hint}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          className="text-[var(--font-size-xs)] text-[var(--color-danger)]"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
