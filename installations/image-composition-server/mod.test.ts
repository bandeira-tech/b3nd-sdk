/// <reference lib="deno.ns" />
/**
 * Image Composition Server Tests
 *
 * Tests the image composition functionality using MemoryClient
 */

import { assertEquals, assertExists } from "@std/assert";
import { MemoryClient } from "@bandeira-tech/b3nd-sdk";
import type { Schema } from "@bandeira-tech/b3nd-sdk";
import { createCanvas } from "canvas";
import {
  composeImages,
  parseComposeRequestFromQuery,
  type ComposeRequest,
  type StoredImage,
} from "./compose.ts";

// Test schema that accepts all writes
const testSchema: Schema = {
  "images://test": async () => ({ valid: true }),
  "images://store": async () => ({ valid: true }),
};

/**
 * Creates a test image as base64-encoded PNG
 */
function createTestImage(
  width: number,
  height: number,
  color: string
): string {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png").toString("base64");
}

/**
 * Creates a MemoryClient with pre-loaded test images
 */
async function createTestClient(): Promise<MemoryClient> {
  const client = new MemoryClient({ schema: testSchema });

  // Create and store test images
  const redImage: StoredImage = {
    data: createTestImage(100, 100, "#ff0000"),
    mimeType: "image/png",
    filename: "red.png",
  };

  const blueImage: StoredImage = {
    data: createTestImage(100, 100, "#0000ff"),
    mimeType: "image/png",
    filename: "blue.png",
  };

  const greenImage: StoredImage = {
    data: createTestImage(50, 50, "#00ff00"),
    mimeType: "image/png",
    filename: "green.png",
  };

  await client.write("images://test/red", redImage);
  await client.write("images://test/blue", blueImage);
  await client.write("images://test/green", greenImage);

  return client;
}

// === Composition Logic Tests ===

Deno.test("composeImages - single layer", async () => {
  const client = await createTestClient();

  const request: ComposeRequest = {
    width: 200,
    height: 200,
    background: "#ffffff",
    layers: [{ uri: "images://test/red", x: 50, y: 50 }],
  };

  const result = await composeImages(client, request);

  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.mimeType, "image/png");
  assertExists(result.layerResults);
  assertEquals(result.layerResults.length, 1);
  assertEquals(result.layerResults[0].success, true);

  await client.cleanup();
});

Deno.test("composeImages - multiple layers", async () => {
  const client = await createTestClient();

  const request: ComposeRequest = {
    width: 300,
    height: 300,
    background: "#ffffff",
    layers: [
      { uri: "images://test/red", x: 0, y: 0 },
      { uri: "images://test/blue", x: 100, y: 100 },
      { uri: "images://test/green", x: 200, y: 200 },
    ],
  };

  const result = await composeImages(client, request);

  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.layerResults?.length, 3);
  assertEquals(result.layerResults?.every((r) => r.success), true);

  await client.cleanup();
});

Deno.test("composeImages - with scaling", async () => {
  const client = await createTestClient();

  const request: ComposeRequest = {
    width: 200,
    height: 200,
    layers: [{ uri: "images://test/red", x: 0, y: 0, width: 200, height: 200 }],
  };

  const result = await composeImages(client, request);

  assertEquals(result.success, true);
  assertExists(result.data);

  await client.cleanup();
});

Deno.test("composeImages - transparent background", async () => {
  const client = await createTestClient();

  const request: ComposeRequest = {
    width: 100,
    height: 100,
    background: "transparent",
    layers: [{ uri: "images://test/green", x: 25, y: 25 }],
  };

  const result = await composeImages(client, request);

  assertEquals(result.success, true);
  assertExists(result.data);

  await client.cleanup();
});

Deno.test("composeImages - missing image fails gracefully", async () => {
  const client = await createTestClient();

  const request: ComposeRequest = {
    width: 200,
    height: 200,
    layers: [
      { uri: "images://test/red", x: 0, y: 0 },
      { uri: "images://test/nonexistent", x: 100, y: 100 },
    ],
  };

  const result = await composeImages(client, request);

  // Should still succeed because at least one layer loaded
  assertEquals(result.success, true);
  assertExists(result.layerResults);
  assertEquals(result.layerResults[0].success, true);
  assertEquals(result.layerResults[1].success, false);

  await client.cleanup();
});

Deno.test("composeImages - all layers fail returns error", async () => {
  const client = await createTestClient();

  const request: ComposeRequest = {
    width: 200,
    height: 200,
    layers: [{ uri: "images://test/nonexistent", x: 0, y: 0 }],
  };

  const result = await composeImages(client, request);

  assertEquals(result.success, false);
  assertExists(result.error);

  await client.cleanup();
});

Deno.test("composeImages - validates dimensions", async () => {
  const client = await createTestClient();

  // Zero dimensions
  let result = await composeImages(client, {
    width: 0,
    height: 100,
    layers: [{ uri: "images://test/red", x: 0, y: 0 }],
  });
  assertEquals(result.success, false);
  assertEquals(result.error, "Width and height must be positive");

  // Negative dimensions
  result = await composeImages(client, {
    width: -100,
    height: 100,
    layers: [{ uri: "images://test/red", x: 0, y: 0 }],
  });
  assertEquals(result.success, false);

  // Too large
  result = await composeImages(client, {
    width: 5000,
    height: 100,
    layers: [{ uri: "images://test/red", x: 0, y: 0 }],
  });
  assertEquals(result.success, false);
  assertEquals(result.error, "Maximum dimension is 4096 pixels");

  await client.cleanup();
});

Deno.test("composeImages - validates layers", async () => {
  const client = await createTestClient();

  // No layers
  let result = await composeImages(client, {
    width: 100,
    height: 100,
    layers: [],
  });
  assertEquals(result.success, false);
  assertEquals(result.error, "At least one layer is required");

  // Too many layers
  result = await composeImages(client, {
    width: 100,
    height: 100,
    layers: Array.from({ length: 51 }, (_, i) => ({
      uri: `images://test/layer${i}`,
      x: 0,
      y: 0,
    })),
  });
  assertEquals(result.success, false);
  assertEquals(result.error, "Maximum 50 layers allowed");

  await client.cleanup();
});

// === Query Parameter Parsing Tests ===

Deno.test("parseComposeRequestFromQuery - basic params", () => {
  const params = new URLSearchParams({
    width: "200",
    height: "150",
    image1: "images://test/red,10,20",
  });

  const result = parseComposeRequestFromQuery(params);

  assertEquals("error" in result, false);
  if (!("error" in result)) {
    assertEquals(result.width, 200);
    assertEquals(result.height, 150);
    assertEquals(result.layers.length, 1);
    assertEquals(result.layers[0].uri, "images://test/red");
    assertEquals(result.layers[0].x, 10);
    assertEquals(result.layers[0].y, 20);
  }
});

Deno.test("parseComposeRequestFromQuery - with dimensions", () => {
  const params = new URLSearchParams({
    width: "300",
    height: "300",
    image1: "images://test/red,0,0,100,100",
  });

  const result = parseComposeRequestFromQuery(params);

  assertEquals("error" in result, false);
  if (!("error" in result)) {
    assertEquals(result.layers[0].width, 100);
    assertEquals(result.layers[0].height, 100);
  }
});

Deno.test("parseComposeRequestFromQuery - multiple images", () => {
  const params = new URLSearchParams({
    width: "400",
    height: "400",
    background: "#ffffff",
    image1: "images://test/red,0,0",
    image2: "images://test/blue,100,100",
    image3: "images://test/green,200,200,50,50",
  });

  const result = parseComposeRequestFromQuery(params);

  assertEquals("error" in result, false);
  if (!("error" in result)) {
    assertEquals(result.background, "#ffffff");
    assertEquals(result.layers.length, 3);
    assertEquals(result.layers[2].width, 50);
    assertEquals(result.layers[2].height, 50);
  }
});

Deno.test("parseComposeRequestFromQuery - JSON layers", () => {
  const layers = JSON.stringify([
    { uri: "images://test/red", x: 0, y: 0 },
    { uri: "images://test/blue", x: 50, y: 50, width: 100, height: 100 },
  ]);

  const params = new URLSearchParams({
    width: "200",
    height: "200",
    layers,
  });

  const result = parseComposeRequestFromQuery(params);

  assertEquals("error" in result, false);
  if (!("error" in result)) {
    assertEquals(result.layers.length, 2);
    assertEquals(result.layers[1].width, 100);
  }
});

Deno.test("parseComposeRequestFromQuery - missing required params", () => {
  // Missing width
  let params = new URLSearchParams({ height: "100", image1: "uri,0,0" });
  let result = parseComposeRequestFromQuery(params);
  assertEquals("error" in result, true);

  // Missing height
  params = new URLSearchParams({ width: "100", image1: "uri,0,0" });
  result = parseComposeRequestFromQuery(params);
  assertEquals("error" in result, true);

  // Missing layers
  params = new URLSearchParams({ width: "100", height: "100" });
  result = parseComposeRequestFromQuery(params);
  assertEquals("error" in result, true);
});

Deno.test("parseComposeRequestFromQuery - invalid number format", () => {
  const params = new URLSearchParams({
    width: "abc",
    height: "100",
    image1: "uri,0,0",
  });

  const result = parseComposeRequestFromQuery(params);
  assertEquals("error" in result, true);
});

Deno.test("parseComposeRequestFromQuery - invalid image format", () => {
  const params = new URLSearchParams({
    width: "100",
    height: "100",
    image1: "uri,x,y", // Invalid x,y
  });

  const result = parseComposeRequestFromQuery(params);
  assertEquals("error" in result, true);
});

// === Integration Test with Data URI ===

Deno.test("composeImages - handles data URI format", async () => {
  const client = new MemoryClient({ schema: testSchema });

  // Store image with data URI prefix
  const imageData = createTestImage(50, 50, "#ff00ff");
  const storedImage: StoredImage = {
    data: `data:image/png;base64,${imageData}`,
    mimeType: "image/png",
  };

  await client.write("images://test/datauri", storedImage);

  const result = await composeImages(client, {
    width: 100,
    height: 100,
    layers: [{ uri: "images://test/datauri", x: 25, y: 25 }],
  });

  assertEquals(result.success, true);
  assertExists(result.data);

  await client.cleanup();
});

// === Output Verification ===

Deno.test("composeImages - output is valid PNG", async () => {
  const client = await createTestClient();

  const result = await composeImages(client, {
    width: 100,
    height: 100,
    layers: [{ uri: "images://test/red", x: 0, y: 0 }],
  });

  assertEquals(result.success, true);
  assertExists(result.data);

  // Verify PNG signature
  const buffer = Buffer.from(result.data!, "base64");
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < pngSignature.length; i++) {
    assertEquals(buffer[i], pngSignature[i], `PNG signature mismatch at byte ${i}`);
  }

  await client.cleanup();
});
