import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Leelawadee UI", "Tahoma", "system-ui", "sans-serif"],
      },
      colors: {
        // ฟ้าใสอมฟ้าน้ำทะเล — ใช้เป็นไฮไลต์ (ลิงก์ สถานะ จุดเน้น) ไม่ใช้ถมพื้นใหญ่
        brand: {
          50: "#effaff",
          100: "#def3ff",
          200: "#b6e9ff",
          300: "#75daff",
          400: "#2cc8ff",
          500: "#00aef5",
          600: "#008bd2",
          700: "#006faa",
          800: "#035d8c",
          900: "#094d74",
        },
        // เทาหมอกอมฟ้า — พื้น/เส้น/ตัวหนังสือ
        accent: {
          50: "#f4f7fa",
          100: "#e9eef3",
          200: "#dae2ea",
          300: "#b9c5d1",
          400: "#8b9aa9",
          500: "#67778a",
          600: "#4f5d6e",
          700: "#3b4757",
          800: "#232d39",
          900: "#111821",
        },
        // ดำหมึก — ชั้นที่ตัดกับพื้นขาว (ปุ่มหลัก เมนูที่เลือก แถบเน้น)
        ink: {
          DEFAULT: "#0f151d",
          soft: "#1b2430",
        },
      },
      backgroundImage: {
        // ดำหมึกไล่อมน้ำเงินเข้ม — มีมิติแต่ยังนิ่ง
        "ink-grad": "linear-gradient(140deg, #22344a 0%, #111821 52%, #0b1016 100%)",
        // ฟ้าใสไล่ฟ้าน้ำทะเล — ไฮไลต์เล็ก ๆ เท่านั้น
        "azure-grad": "linear-gradient(135deg, #4dd5ff 0%, #0a8fe0 100%)",
        // แสงขาวบนแผงลอย
        sheen: "linear-gradient(180deg, #ffffff 0%, #f8fbfd 100%)",
      },
      boxShadow: {
        soft: "0 1px 2px 0 rgb(17 24 33 / 0.04), 0 2px 10px -3px rgb(17 24 33 / 0.06)",
        "soft-lg": "0 10px 30px -10px rgb(17 24 33 / 0.14), 0 22px 50px -18px rgb(17 24 33 / 0.16)",
        // แผงลอย — เงาฟุ้งยาวแบบจอในภาพตัวอย่าง
        float: "0 1px 0 0 rgb(255 255 255 / 0.9) inset, 0 2px 6px -2px rgb(17 24 33 / 0.05), 0 24px 48px -24px rgb(31 52 77 / 0.22)",
        ink: "0 10px 24px -10px rgb(15 21 29 / 0.55)",
        glow: "0 0 0 1px rgb(0 174 245 / 0.18), 0 10px 28px -10px rgb(0 174 245 / 0.55)",
      },
    },
  },
  plugins: [],
};

export default config;
