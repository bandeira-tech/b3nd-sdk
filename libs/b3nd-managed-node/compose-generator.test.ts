import { assertEquals } from "@std/assert";
import { generateCompose } from "./compose-generator.ts";
import { createTestConfig, createTestManifest } from "./test-helpers.ts";

const OPERATOR_KEY = "aabbccdd11223344";

Deno.test("compose: memory-only network generates config-server and managed node", () => {
  const manifest = createTestManifest(1);
  const yaml = generateCompose(manifest, { operatorPubKeyHex: OPERATOR_KEY });

  assertEquals(yaml.includes("config-server"), true);
  assertEquals(yaml.includes("node-0"), true);
  // No postgres or mongo services
  assertEquals(yaml.includes("postgres:"), false);
  assertEquals(yaml.includes("mongo:"), false);
});

Deno.test("compose: postgres backend includes postgres service", () => {
  const manifest = createTestManifest(1);
  manifest.nodes[0].config.backends = [
    { type: "postgresql", url: "postgresql://localhost:5432/b3nd" },
  ];

  const yaml = generateCompose(manifest, { operatorPubKeyHex: OPERATOR_KEY });

  assertEquals(yaml.includes("postgres"), true);
  assertEquals(yaml.includes("postgres:16-alpine"), true);
  assertEquals(yaml.includes("pgdata"), true);
  assertEquals(yaml.includes("POSTGRES_USER"), true);
});

Deno.test("compose: mongo backend includes mongo service", () => {
  const manifest = createTestManifest(1);
  manifest.nodes[0].config.backends = [
    { type: "mongodb", url: "mongodb://localhost:27017/b3nd" },
  ];

  const yaml = generateCompose(manifest, { operatorPubKeyHex: OPERATOR_KEY });

  assertEquals(yaml.includes("mongo"), true);
  assertEquals(yaml.includes("mongo:7"), true);
  assertEquals(yaml.includes("mongodata"), true);
});

Deno.test("compose: mixed backends include both postgres and mongo", () => {
  const manifest = createTestManifest(2);
  manifest.nodes[0].config.backends = [
    { type: "postgresql", url: "postgresql://localhost:5432/b3nd" },
  ];
  manifest.nodes[1].config.backends = [
    { type: "mongodb", url: "mongodb://localhost:27017/b3nd" },
  ];

  const yaml = generateCompose(manifest, { operatorPubKeyHex: OPERATOR_KEY });

  assertEquals(yaml.includes("postgres:16-alpine"), true);
  assertEquals(yaml.includes("mongo:7"), true);
  assertEquals(yaml.includes("pgdata"), true);
  assertEquals(yaml.includes("mongodata"), true);
});

Deno.test("compose: service naming sanitizes special characters", () => {
  const manifest = createTestManifest(1);
  manifest.nodes[0].name = "My Node.v2 (test)";

  const yaml = generateCompose(manifest, { operatorPubKeyHex: OPERATOR_KEY });

  // Spaces, dots, parens should be replaced with hyphens
  assertEquals(yaml.includes("my-node-v2--test-"), true);
  // Original name with special chars should not appear as a service key
  assertEquals(yaml.includes("My Node.v2"), false);
});

Deno.test("compose: environment vars include required keys", () => {
  const manifest = createTestManifest(1);
  const yaml = generateCompose(manifest, { operatorPubKeyHex: OPERATOR_KEY });

  assertEquals(yaml.includes("NODE_ID"), true);
  assertEquals(yaml.includes("OPERATOR_KEY"), true);
  assertEquals(yaml.includes("CONFIG_URL"), true);
  assertEquals(yaml.includes(OPERATOR_KEY), true);
});

Deno.test("compose: environment vars include encryption keys", () => {
  const manifest = createTestManifest(1);
  const yaml = generateCompose(manifest, { operatorPubKeyHex: OPERATOR_KEY });

  assertEquals(yaml.includes("NODE_ENCRYPTION_PUBLIC_KEY_HEX"), true);
  assertEquals(yaml.includes("OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX"), true);
});

Deno.test("compose: port mapping uses node config port", () => {
  const manifest = createTestManifest(1);
  manifest.nodes[0].config.server.port = 9999;

  const yaml = generateCompose(manifest, { operatorPubKeyHex: OPERATOR_KEY });

  assertEquals(yaml.includes("9999:9999"), true);
});

Deno.test("compose: multiple nodes each get their own service", () => {
  const manifest = createTestManifest(3);

  const yaml = generateCompose(manifest, { operatorPubKeyHex: OPERATOR_KEY });

  assertEquals(yaml.includes("node-0"), true);
  assertEquals(yaml.includes("node-1"), true);
  assertEquals(yaml.includes("node-2"), true);
});

Deno.test("compose: config-server port is 9900", () => {
  const manifest = createTestManifest(1);
  const yaml = generateCompose(manifest, { operatorPubKeyHex: OPERATOR_KEY });

  assertEquals(yaml.includes("9900:9900"), true);
});

Deno.test("compose: useImages option sets image instead of build", () => {
  const manifest = createTestManifest(1);
  const yaml = generateCompose(manifest, {
    operatorPubKeyHex: OPERATOR_KEY,
    useImages: true,
  });

  assertEquals(yaml.includes("image:"), true);
  assertEquals(yaml.includes("b3nd-node:latest"), true);
});

Deno.test("compose: custom image names", () => {
  const manifest = createTestManifest(1);
  const yaml = generateCompose(manifest, {
    operatorPubKeyHex: OPERATOR_KEY,
    useImages: true,
    managedNodeImage: "my-registry/managed:v2",
    configServerImage: "my-registry/config:v2",
  });

  assertEquals(yaml.includes("my-registry/managed:v2"), true);
  assertEquals(yaml.includes("my-registry/config:v2"), true);
});

Deno.test("compose: managed nodes depend on config-server", () => {
  const manifest = createTestManifest(1);
  const yaml = generateCompose(manifest, { operatorPubKeyHex: OPERATOR_KEY });

  assertEquals(yaml.includes("depends_on"), true);
  assertEquals(yaml.includes("config-server"), true);
});

Deno.test("compose: node with postgres backend depends on postgres", () => {
  const manifest = createTestManifest(1);
  manifest.nodes[0].config.backends = [
    { type: "postgresql", url: "postgresql://localhost:5432/b3nd" },
  ];

  const yaml = generateCompose(manifest, { operatorPubKeyHex: OPERATOR_KEY });

  // The depends_on should list both config-server and postgres
  assertEquals(yaml.includes("config-server"), true);
  assertEquals(yaml.includes("postgres"), true);
});

Deno.test("compose: NODE_ID uses node.publicKey", () => {
  const manifest = createTestManifest(1);
  manifest.nodes[0].publicKey = "deadbeef1234";

  const yaml = generateCompose(manifest, { operatorPubKeyHex: OPERATOR_KEY });

  assertEquals(yaml.includes("deadbeef1234"), true);
});
