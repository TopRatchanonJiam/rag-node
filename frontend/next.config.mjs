/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // build เป็นไฟล์ static (out/) ให้ node (FastAPI) เสิร์ฟเองบน origin เดียวกับ API
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
