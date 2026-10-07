/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // build เป็นไฟล์ static (out/) ให้ node (FastAPI) เสิร์ฟเองบน origin เดียวกับ API
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // วางคู่กับเว็บ Next.js อีกตัวบนโดเมนเดียวกัน (โหมด LEGACY_UI) — ย้ายไฟล์ /_next ไปไว้ใต้ prefix นี้จะได้ไม่ชนกัน
  assetPrefix: process.env.NEXT_ASSET_PREFIX || undefined,
};

export default nextConfig;
