import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Leelawadee UI", "Tahoma", "system-ui", "sans-serif"],
      },
      colors: {
        // สีหลัก: เขียวหัวเป็ดเข้ม — โทนเครื่องมือธุรกิจที่อ่านสบาย ไม่ฉูดฉาด (ใช้กับปุ่มหลัก/สถานะ active)
        brand: {
          50: "#effaf8",
          100: "#d4f1ec",
          200: "#a9e2d8",
          300: "#73ccbf",
          400: "#40ae9f",
          500: "#249485",
          600: "#17786c",
          700: "#156058",
          800: "#154d47",
          900: "#143f3b",
        },
        // เทาอมเขียวจาง ๆ ให้เข้ากับ brand แทนเทากลางล้วน
        accent: {
          50: "#f6f8f8",
          100: "#eceff0",
          200: "#d9dfe0",
          300: "#b9c3c5",
          400: "#8e9b9e",
          500: "#6b787b",
          600: "#545f62",
          700: "#424b4d",
          800: "#2c3335",
          900: "#1b2022",
        },
      },
      boxShadow: {
        soft: "0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 8px -2px rgb(16 24 40 / 0.06)",
        "soft-lg": "0 6px 20px -6px rgb(16 24 40 / 0.10), 0 16px 40px -12px rgb(16 24 40 / 0.14)",
        glow: "0 0 0 1px rgb(23 120 108 / 0.10), 0 10px 30px -10px rgb(23 120 108 / 0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
