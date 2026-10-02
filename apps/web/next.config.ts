import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@monumental/shared", "@monumental/db"],
  serverExternalPackages: ["@prisma/adapter-pg", "pg"],
  reactStrictMode: true,
};

export default nextConfig;
