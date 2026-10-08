import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
}

// ปุ่มหลัก = ดำหมึก (ชั้นที่ตัดกับพื้นขาวชัดที่สุด) hover แล้วเรืองฟ้า
const VARIANTS: Record<string, string> = {
  primary:
    "bg-brand-600 bg-brand-grad text-white shadow-brand hover:brightness-105 hover:shadow-glow disabled:bg-accent-300 disabled:bg-none disabled:shadow-none",
  secondary:
    "bg-white text-accent-800 shadow-soft ring-1 ring-inset ring-accent-200 hover:ring-brand-300 hover:text-brand-700 disabled:text-accent-300 disabled:ring-accent-100",
  ghost: "bg-transparent text-accent-700 hover:bg-white/80 disabled:text-accent-300",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
