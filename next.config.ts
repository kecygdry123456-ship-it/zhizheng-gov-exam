import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: process.env.NEXT_SKIP_TYPECHECK === "1",
  },
  experimental: { cpus: 1 },
};

export default nextConfig;
