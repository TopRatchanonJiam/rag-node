import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Leelawadee UI", "Tahoma", "system-ui", "sans-serif"],
      },
      colors: {
        // ชมพูแดง (โทนเดียวกับหน้าขาย) — ใช้เป็นไฮไลต์ (ลิงก์ สถานะ จุดเน้น) ไม่ใช้ถมพื้นใหญ่
        brand: {
          50: "#fdf2f5",
          100: "#fbe4ea",
          200: "#f7cbd6",
          300: "#f0a3b6",
          400: "#e77592",
          500: "#df5876",
          600: "#d84a67",
          700: "#b43552",
          800: "#962e47",
          900: "#7e2a40",
        },
        // เทาอมอุ่น — พื้น/เส้น/ตัวหนังสือ
        accent: {
          50: "#faf8f7",
          100: "#f3efed",
          200: "#e7e1de",
          300: "#cdc4c0",
          400: "#a2958f",
          500: "#7b6e69",
          600: "#5f5450",
          700: "#48403d",
          800: "#2c2625",
          900: "#171313",
        },
        // ดำหมึก — ชั้นที่ตัดกับพื้นขาว (ปุ่มหลัก เมนูที่เลือก แถบเน้น)
        ink: {
          DEFAULT: "#151112",
          soft: "#231c1e",
        },
      },
      backgroundImage: {
        // ดำหมึกไล่อมไวน์เข้ม — มีมิติแต่ยังนิ่ง
        "ink-grad": "linear-gradient(140deg, #3a2630 0%, #171214 52%, #0e0b0c 100%)",
        // ชมพูแดงไล่ส้มอ่อน — ปุ่มหลัก ข้อความของผู้ใช้ (ชุดเดียวกับหน้าขาย)
        "brand-grad": "linear-gradient(100deg, #d84a67 0%, #e3627f 55%, #e87b73 100%)",
        // จุดไฮไลต์เล็ก ๆ (ชื่อเดิมคงไว้ — ตอนนี้เป็นชมพูแดง)
        "azure-grad": "linear-gradient(135deg, #ec7f95 0%, #d84a67 100%)",
        // แสงขาวบนแผงลอย
        sheen: "linear-gradient(180deg, #ffffff 0%, #fcfaf9 100%)",
      },
      boxShadow: {
        soft: "0 1px 2px 0 rgb(23 19 19 / 0.04), 0 2px 10px -3px rgb(23 19 19 / 0.06)",
        "soft-lg": "0 10px 30px -10px rgb(17 24 33 / 0.14), 0 22px 50px -18px rgb(17 24 33 / 0.16)",
        // แผงลอย — เงาฟุ้งยาวแบบจอในภาพตัวอย่าง
        float: "0 1px 0 0 rgb(255 255 255 / 0.9) inset, 0 2px 6px -2px rgb(17 24 33 / 0.05), 0 24px 48px -24px rgb(60 40 45 / 0.2)",
        ink: "0 10px 24px -10px rgb(15 21 29 / 0.55)",
        glow: "0 0 0 1px rgb(216 74 103 / 0.16), 0 10px 28px -10px rgb(216 74 103 / 0.45)",
        brand: "0 8px 22px -10px rgb(216 74 103 / 0.55)",
      },
    },
  },
  plugins: [],
};

export default config;
