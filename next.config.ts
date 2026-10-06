import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `standalone` emits a minimal `.next/standalone/` dir with a server.js that
  // can run without node_modules. Required for the Fly Dockerfile to produce
  // a <300MB image.
  output: "standalone",
  experimental: {
    // Server components can import @openai/agents without the webpack
    // "critical dependency" warnings bubbling up as build errors.
    serverComponentsExternalPackages: ["@openai/agents", "pg"],
  },
};

export default nextConfig;
