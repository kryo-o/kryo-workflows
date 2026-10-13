import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // Trigger.dev dashboard → project settings → Project ref
  project: "proj_utjqzdzttorintyaahcf",
  dirs: ["./src/trigger"],
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, minTimeoutInMs: 5000, maxTimeoutInMs: 30_000, factor: 2 },
  },
});
