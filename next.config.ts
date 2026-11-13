import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Pin the root: a stray lockfile higher up the tree otherwise confuses workspace detection.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
