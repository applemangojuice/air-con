import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

/**
 * Pill buttons in four voices. `lg` is the field size: at least 48 px tall,
 * for gloved thumbs on a ladder. Server-safe (no hooks); pass handlers from
 * client components as usual.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent-700 text-white shadow-sm hover:bg-accent-800",
  secondary: "border border-line bg-white text-ink-900 hover:border-ink-300 hover:bg-surface",
  ghost: "text-ink-700 hover:bg-surface hover:text-ink-900",
  danger: "bg-red-700 text-white shadow-sm hover:bg-red-800",
};

const SIZE: Record<ButtonSize, string> = {
  md: "min-h-10 px-4 py-2 text-sm",
  lg: "min-h-12 px-6 py-3 text-base",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = ""): string {
  return [BASE, VARIANT[variant], SIZE[size], extra].filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the button and swaps the label, so a slow save can't be double-submitted. */
  busy?: boolean;
  busyLabel?: ReactNode;
  block?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  busy = false,
  busyLabel = "One moment…",
  block = false,
  type = "button",
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={buttonClass(variant, size, `${block ? "w-full" : ""} ${className}`.trim())}
      {...rest}
    >
      {busy ? busyLabel : children}
    </button>
  );
}

export type LinkButtonProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
};

/** A link that looks like a button: navigation, not an action. */
export function LinkButton({ variant = "primary", size = "md", block = false, className = "", ...rest }: LinkButtonProps) {
  return <Link className={buttonClass(variant, size, `${block ? "w-full" : ""} ${className}`.trim())} {...rest} />;
}
