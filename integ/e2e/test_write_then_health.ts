const baseUrl = "http://localhost:8000";

// Write
const writeResp = await fetch(`${baseUrl}/api/v1/write/test/test-domain/check1`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ value: { msg: "test1" } }),
});
const writeData = await writeResp.json();
console.log("Write success:", writeData.success);

// Check health immediately
const healthResp = await fetch(`${baseUrl}/api/v1/health`);
const healthData = await healthResp.json();
console.log("After write - itemCount:", healthData.details.itemCount);

// Write again
const writeResp2 = await fetch(`${baseUrl}/api/v1/write/test/test-domain/check2`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ value: { msg: "test2" } }),
});
const writeData2 = await writeResp2.json();
console.log("Write 2 success:", writeData2.success);

// Check health again
const healthResp2 = await fetch(`${baseUrl}/api/v1/health`);
const healthData2 = await healthResp2.json();
console.log("After 2 writes - itemCount:", healthData2.details.itemCount);
