import type { NextConfig } from "next";

// 部署在子路径下（如 /yunying），构建时由 BASE_PATH 决定
const basePath = process.env.BASE_PATH || "";

const nextConfig: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
