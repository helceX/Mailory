import path from "node:path";
import type { NextConfig } from "next";

// Baseline hardening; a nonce-based CSP lands with the Phase 15 security pass.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  reactStrictMode: true,
  transpilePackages: [
    "@mailory/ui",
    "@mailory/db",
    "@mailory/config",
    "@mailory/core",
    "@mailory/validation",
    "@mailory/email",
  ],
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
