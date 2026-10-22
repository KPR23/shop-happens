import { defineConfig } from "vitest/config";
// Colyseus talks over process.send when forked, so run tests in worker threads.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], testTimeout: 120000, pool: "threads" } });
