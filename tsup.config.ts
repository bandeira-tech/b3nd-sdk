import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "src/mod.web": "src/mod.web.ts",
    "src/core": "src/core.ts",
    "src/canon": "src/canon.ts",
    "msg/mod": "src/msg.ts",
    "auth/mod": "src/auth.ts",
    "wallet/mod": "src/wallet.ts",
    "encrypt/mod": "src/encrypt.ts",
    "hash/mod": "src/hash.ts",
    "network/mod": "src/network.ts",
    "listener/mod": "./libs/b3nd-listener/mod.ts",
  },
  dts: true,
  format: ["esm"],
  outDir: "dist",
  clean: true,
  tsconfig: "tsconfig.web.json",
});
