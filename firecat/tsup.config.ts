import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "protocol/mod": "libs/protocol/mod.web.ts",
  },
  dts: true,
  format: ["esm"],
  outDir: "dist",
  clean: true,
  tsconfig: "tsconfig.web.json",
  external: [
    "@bandeira-tech/b3nd-web",
    "@bandeira-tech/b3nd-sdk",
  ],
});
