import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / WASM / binary packages must stay out of the server bundle.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "@resvg/resvg-js",
    "ffmpeg-static",
    "bullmq",
    "ioredis",
    "pg",
  ],
  outputFileTracingIncludes: {
    "/api/**/*": ["./assets/fonts/**/*", "./node_modules/ffmpeg-static/**/*"],
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
