import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.{ts,tsx}", "apps/**/*.test.{ts,tsx}"],
    environment: "node",
    // Real-Postgres integration files run in parallel and password hashing is deliberately slow: 5s is too tight.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
