import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "src/mod.web": "src/mod.web.ts",
    "wallet/mod": "../b3nd-wallet/mod.ts",
    "apps/mod": "../b3nd-apps/mod.ts",
    "encrypt/mod": "../b3nd-encrypt/mod.ts",
    "blob/mod": "../b3nd-blob/mod.ts",
    "clients/http/mod": "../b3nd-client-http/mod.ts",
    "clients/local-storage/mod": "../b3nd-client-localstorage/mod.ts",
    "clients/websocket/mod": "../b3nd-client-ws/mod.ts",
    "clients/memory/mod": "../b3nd-client-memory/mod.ts",
    "wallet-server/mod": "../b3nd-wallet-server/mod.ts",
    "wallet-server/adapters/browser": "../b3nd-wallet-server/adapters/browser.ts",
  },
  dts: true,
  format: ["esm"],
  outDir: "dist",
  clean: true,
  tsconfig: "tsconfig.web.json",
});
