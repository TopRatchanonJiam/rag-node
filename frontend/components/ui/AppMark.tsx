import { Sparkles } from "lucide-react";

// ไอคอนประจำแอปแบบกลาง ๆ (ไม่มีแบรนด์)
export function AppMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm"
    >
      <Sparkles style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={2.2} />
    </span>
  );
}
