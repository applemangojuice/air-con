import type { HTMLAttributes, ReactNode } from "react";

/** The house card: white on cream, hairline border, rounded-2xl. */
export function Card({
  as: Tag = "div",
  padded = true,
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" | "li"; padded?: boolean; children?: ReactNode }) {
  return (
    <Tag className={`rounded-2xl border border-line bg-white ${padded ? "p-5 sm:p-6" : ""} ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}
