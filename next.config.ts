import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `standalone` emits a minimal `.next/standalone/` dir with a server.js that
  // can run without node_modules. Required for the Fly Dockerfile to produce
  // a <300MB image.
  output: "standalone",
  // Next 15 enables `instrumentation.ts` by default. The root-level
  // `instrumentation.ts` boots OTel on the nodejs runtime only.
  // See https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
  experimental: {
    // Server components can import @openai/agents without the webpack
    // "critical dependency" warnings bubbling up as build errors.
    serverComponentsExternalPackages: ["@openai/agents", "pg"],
  },
  // instrumentation.ts dynamic-imports src/otel/setup which uses node:fs +
  // node:path. Webpack still statically-analyzes the dynamic import for the
  // Edge runtime and chokes on node: scheme. Externalize for Edge builds; the
  // module only ever executes on nodejs runtime per the runtime guard.
  webpack: (config, { nextRuntime }) => {
    if (nextRuntime === "edge") {
      config.externals = config.externals ?? [];
      (config.externals as unknown[]).push({ "./src/otel/setup": "commonjs ./src/otel/setup" });
    }
    return config;
  },
};

export default nextConfig;
