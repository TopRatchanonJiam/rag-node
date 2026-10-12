// ตรวจตอน build: ไฟล์ที่ย้ายมาใช้ระบบภาษาแล้ว ห้ามมีอักษรไทย/จีน/ญี่ปุ่นในโค้ด (ข้อความต้องอยู่ใน locales/*.json)
// ไฟล์เก่าที่ยังไม่ย้ายยังไม่ตรวจ — ย้ายเสร็จไฟล์ไหนให้เพิ่มชื่อใน MIGRATED แล้วสุดท้ายเปลี่ยนเป็นตรวจทุกไฟล์
// คอมเมนต์ภาษาไทยได้ (ตัดคอมเมนต์ออกก่อนตรวจ)
import { readFileSync } from "node:fs";

const MIGRATED = ["app/setup/page.tsx", "lib/i18n.tsx", "app/admin/channels/page.tsx", "components/admin/NoticeBar.tsx", "components/admin/ApiKeys.tsx"];
const SCRIPT = /[฀-๿぀-ヿ一-鿿]/;
const LABELS_OK = /label: "(ไทย|English|日本語|中文)"/; // ชื่อภาษาในตัวเลือกภาษา แสดงเป็นภาษาของมันเองโดยตั้งใจ

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

let bad = 0;
for (const file of MIGRATED) {
  stripComments(readFileSync(file, "utf8"))
    .split("\n")
    .forEach((line, i) => {
      if (SCRIPT.test(line) && !LABELS_OK.test(line)) {
        console.error(`${file}:${i + 1}: hardcoded UI text — move it to locales/*.json\n    ${line.trim()}`);
        bad++;
      }
    });
}
if (bad) {
  console.error(`\ncheck-i18n: ${bad} line(s) with hardcoded text`);
  process.exit(1);
}
console.log(`check-i18n: ok (${MIGRATED.length} files)`);
