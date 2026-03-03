import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.1.4",
  ],
};

export default nextConfig;
