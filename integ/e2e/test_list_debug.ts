const baseUrl = "http://localhost:8000";

// Test 1: Write an item
const writeUri = "test://list-test/debug-test/item";
const writeResp = await fetch(`${baseUrl}/api/v1/write/test/list-test/debug-test/item`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ value: { data: "test" } }),
});
console.log("Write response:", writeResp.status, await writeResp.json());

// Test 2: Read it back
const readResp = await fetch(`${baseUrl}/api/v1/read/test/list-test/debug-test/item`);
console.log("Read response:", readResp.status, await readResp.json());

// Test 3: List the domain
const listResp = await fetch(`${baseUrl}/api/v1/list/test/list-test/`);
console.log("List response:", listResp.status);
const listData = await listResp.json();
console.log("List data:", JSON.stringify(listData, null, 2));
