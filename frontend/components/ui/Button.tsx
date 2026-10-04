import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
}

const VARIANTS: Record<string, string> = {
  primary:
    "bg-gradient-to-b from-brand-500 to-brand-700 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.12)] hover:from-brand-600 hover:to-brand-800 hover:shadow-glow disabled:from-brand-300 disabled:to-brand-300 disabled:shadow-none",
  secondary:
    "bg-white text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 hover:ring-slate-400 disabled:text-slate-300 disabled:ring-slate-200",
  ghost: "bg-transparent text-slate-700 hover:bg-slate-100 disabled:text-slate-300",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:hover:scale-100 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
