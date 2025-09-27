import { Persistence } from "../mod.ts";
import { assert, assertEquals } from "@std/assert";

Deno.test("Persistence can write to path", async () => {
  const instance = new Persistence<string>({
    schema: {
      "test://accept-all": (_write) => Promise.resolve(true),
    },
  });
  const testPayload = {
    uri: "test://accept-all/mytest1",
    value: "foobar",
  };
  const [error, writeresult] = await instance.write(testPayload);
  assert(!error);
  assert(writeresult);

  const result = await instance.read(testPayload.uri);
  assertEquals(result.ts, writeresult!.ts);
});
