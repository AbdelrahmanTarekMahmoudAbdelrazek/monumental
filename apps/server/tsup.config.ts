import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // workspace packages are bundled in; real deps stay external
  noExternal: ["@monumental/shared", "@monumental/db"],
  external: ["@prisma/client", "@prisma/adapter-pg", "pg"],
});
