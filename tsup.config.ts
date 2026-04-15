import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "src/mod.web": "src/mod.web.ts",
    "auth/mod": "./libs/b3nd-auth/mod.ts",
    "wallet/mod": "./libs/b3nd-wallet/mod.ts",
    "encrypt/mod": "./libs/b3nd-encrypt/mod.ts",
    "hash/mod": "./libs/b3nd-hash/mod.ts",
    "clients/http/mod": "./libs/b3nd-client-http/mod.ts",
    "clients/local-storage/mod": "./libs/b3nd-client-localstorage/mod.ts",
    "clients/websocket/mod": "./libs/b3nd-client-ws/mod.ts",
    "clients/memory/mod": "./libs/b3nd-client-memory/mod.ts",
    "clients/console/mod": "./libs/b3nd-client-console/mod.ts",
    "clients/s3/mod": "./libs/b3nd-client-s3/mod.ts",
    "clients/elasticsearch/mod": "./libs/b3nd-client-elasticsearch/mod.ts",
  },
  dts: true,
  format: ["esm"],
  outDir: "dist",
  clean: true,
  tsconfig: "tsconfig.web.json",
});
