import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // The dev-tools indicator portal (<nextjs-portal>) overlays the bottom-left
  // corner and blocks the sidebar's Settings row and the collapse control.
  devIndicators: false,
};

export default nextConfig;
