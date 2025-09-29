import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";

const BASE_URL = "http://localhost:4692";
const INSTANCE = "default";

function parseUri(uri: string): {
  protocol: string;
  domain: string;
  path: string;
} {
  const url = new URL(uri);
  return {
    protocol: url.protocol.replace(":", ""),
    domain: url.hostname,
    path: url.pathname,
  };
}

// Function to load all JSON fixtures from tests/fixtures/
async function loadFixtures(): Promise<
  Array<{ name: string; uri: string; data: unknown }>
> {
  const fixtures: Array<{ name: string; uri: string; data: unknown }> = [];
  try {
    const walker = walk("tests/fixtures", { exts: [".json"] });
    for await (const entry of walker) {
      if (entry.isFile) {
        const name = entry.name.replace(/\.json$/, "");
        const fileContent = await Deno.readTextFile(entry.path);
        const parsed = JSON.parse(fileContent);
        const uri = parsed.uri;
        const data = parsed.value;
        const fixtureName =
          uri
            .split("/")
            .pop()
            ?.replace(/[^a-zA-Z0-9]/g, "") || name;
        fixtures.push({ name: fixtureName, uri, data });
      }
    }
  } catch (error) {
    console.error(`Error loading fixtures: ${error}`);
    Deno.exit(1);
  }
  return fixtures;
}

// Helper to write payload
async function writePayload(
  uri: string,
  data: unknown,
): Promise<{
  success: boolean;
  record?: { ts: number; data: unknown };
  error?: string;
}> {
  try {
    const response = await fetch(
      `${BASE_URL}/api/v1/write?instance=${INSTANCE}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri, value: data }),
      },
    );
    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      console.error(
        `❌ Write failed for ${uri}: ${response.status} - ${err.error}`,
      );
      return { success: false, error: err.error };
    }
    const result = await response.json();
    console.log(
      `✅ Write success for ${uri}: TS=${result.record?.ts}, Data preview=${JSON.stringify(result.record?.data).slice(0, 100)}...`,
    );
    return result;
  } catch (error) {
    console.error(`❌ Write error for ${uri}: ${error}`);
    return { success: false, error: (error as Error).message };
  }
}

// Helper to read back
async function readPayload(uri: string): Promise<{
  success: boolean;
  record?: { ts: number; data: unknown };
  error?: string;
}> {
  try {
    const { protocol, domain, path } = parseUri(uri);
    const response = await fetch(
      `${BASE_URL}/api/v1/read/${protocol}/${domain}/${encodeURIComponent(path)}?instance=${INSTANCE}`,
    );
    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      console.error(
        `❌ Read failed for ${uri}: ${response.status} - ${err.error}`,
      );
      return { success: false, error: err.error };
    }
    const record = await response.json();
    console.log(
      `✅ Read success for ${uri}: TS=${record.ts}, Data=${JSON.stringify(record.data)}`,
    );
    return { success: true, record };
  } catch (error) {
    console.error(`❌ Read error for ${uri}: ${error}`);
    return { success: false, error: (error as Error).message };
  }
}

// Helper to delete (cleanup)
async function deletePayload(
  uri: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { protocol, domain, path } = parseUri(uri);
    const response = await fetch(
      `${BASE_URL}/api/v1/delete/${protocol}/${domain}/${encodeURIComponent(path)}?instance=${INSTANCE}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      console.warn(
        `⚠️ Cleanup delete failed for ${uri}: ${response.status} - ${err.error}`,
      );
      return { success: false, error: err.error };
    }
    const result = await response.json();
    console.log(`🧹 Cleaned up ${uri}: ${result.success}`);
    return { success: true };
  } catch (error) {
    console.warn(`⚠️ Cleanup error for ${uri}: ${error}`);
    return { success: false, error: (error as Error).message };
  }
}

// Main test runner
async function runTests() {
  console.log("🚀 Starting write-read tests...\n");
  const fixtures = await loadFixtures();
  if (fixtures.length === 0) {
    console.error(
      "❌ No fixtures found in tests/fixtures/! Add some .json files to test.",
    );
    Deno.exit(1);
  }
  console.log(`Found ${fixtures.length} fixture(s).\n`);

  let passed = 0;
  let failed = 0;

  for (const fixture of fixtures) {
    console.log(
      `\n--- Testing fixture: ${fixture.name} (URI: ${fixture.uri}) ---`,
    );

    // Write
    const writeResult = await writePayload(fixture.uri, fixture.data);

    // Read back
    const readResult = await readPayload(fixture.uri);
    if (readResult.success && writeResult.record) {
      // Verify data matches (shallow compare via stringify)
      if (
        JSON.stringify(readResult.record.data) ===
        JSON.stringify(writeResult.record.data)
      ) {
        console.log(`🎉 Verification passed: Data matches for ${fixture.name}`);
        passed++;
      } else {
        console.error(
          `❌ Verification failed: Data mismatch for ${fixture.name}`,
        );
        failed++;
      }
    } else {
      failed++;
    }

    // Cleanup
    await deletePayload(fixture.uri);
  }

  console.log(`\n📊 Test Summary: ${passed} passed, ${failed} failed.`);
  if (failed === 0) {
    console.log("✅ All tests complete successfully!");
  } else {
    console.log("⚠️ Some tests failed. Check logs above.");
    Deno.exit(1);
  }
}

if (import.meta.main) {
  runTests().catch((error) => {
    console.error("Fatal error running tests:", error);
    Deno.exit(1);
  });
}
