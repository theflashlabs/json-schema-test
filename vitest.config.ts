import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["html", "text", "lcov"],
      include: ["src/**"],
      reportOnFailure: true,
      experimentalAstAwareRemapping: true,
    },
  },
});
