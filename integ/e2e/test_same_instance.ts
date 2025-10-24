const baseUrl = "http://localhost:8000";

// Write
const w1 = await fetch(`${baseUrl}/api/v1/write/test/test-domain/item1`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ value: { msg: "test1" } }),
});
console.log("Write 1:", await w1.json());

// Write another
const w2 = await fetch(`${baseUrl}/api/v1/write/test/test-domain/item2`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ value: { msg: "test2" } }),
});
console.log("Write 2:", await w2.json());

// List immediately
const list = await fetch(`${baseUrl}/api/v1/list/test/test-domain/`);
const listData = await list.json();
console.log("List response:", listData);
console.log("Found", listData.data?.length || 0, "items");
