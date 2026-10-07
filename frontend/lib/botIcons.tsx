import {
  BookOpen,
  Bot,
  Briefcase,
  Building2,
  GraduationCap,
  HeartPulse,
  Headset,
  Package,
  Pill,
  Scale,
  ShoppingBag,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

// ไอคอนหน้าต้อนรับของบอท — เก็บเป็นชื่อ (string) ในข้อมูลบอท
export const BOT_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  sparkles: { icon: Sparkles, label: "ทั่วไป" },
  bot: { icon: Bot, label: "บอท" },
  book: { icon: BookOpen, label: "ความรู้" },
  briefcase: { icon: Briefcase, label: "งาน/HR" },
  building: { icon: Building2, label: "องค์กร" },
  headset: { icon: Headset, label: "บริการลูกค้า" },
  shopping: { icon: ShoppingBag, label: "ร้านค้า" },
  package: { icon: Package, label: "สต็อก" },
  pill: { icon: Pill, label: "ยา" },
  health: { icon: HeartPulse, label: "สุขภาพ" },
  education: { icon: GraduationCap, label: "การศึกษา" },
  legal: { icon: Scale, label: "กฎหมาย" },
};

export function botIcon(name?: string | null): LucideIcon {
  return BOT_ICONS[name || ""]?.icon ?? Sparkles;
}
