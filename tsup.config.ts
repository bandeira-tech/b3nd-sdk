import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "src/mod.web": "src/mod.web.ts",
    "wallet/mod": "./libs/b3nd-wallet/mod.ts",
    "apps/mod": "./libs/b3nd-apps/mod.ts",
    "encrypt/mod": "./libs/b3nd-encrypt/mod.ts",
    "hash/mod": "./libs/b3nd-hash/mod.ts",
    "clients/http/mod": "./libs/b3nd-client-http/mod.ts",
    "clients/local-storage/mod": "./libs/b3nd-client-localstorage/mod.ts",
    "clients/websocket/mod": "./libs/b3nd-client-ws/mod.ts",
    "clients/memory/mod": "./libs/b3nd-client-memory/mod.ts",
    "wallet-server/mod": "./libs/b3nd-wallet-server/mod.ts",
    "wallet-server/adapters/browser":
      "./libs/b3nd-wallet-server/adapters/browser.ts",
  },
  dts: true,
  format: ["esm"],
  outDir: "dist",
  clean: true,
  tsconfig: "tsconfig.web.json",
});
