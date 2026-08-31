import type { ButtonHTMLAttributes } from "react";
import { btn, cn } from "@/lib/ui";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}

/** 공통 버튼 — primary(강조) / secondary(보조·기본) / ghost(최소). */
export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(btn(variant, size), className)}
      {...rest}
    />
  );
}
