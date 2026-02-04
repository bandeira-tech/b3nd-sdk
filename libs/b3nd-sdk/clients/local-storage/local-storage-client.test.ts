/**
 * LocalStorageClient tests
 */
import { LocalStorageClient } from "./mod.ts";
import { runSharedSuite, type TestClientFactories } from "../../testing/shared-suite.ts";

// Run the shared test suite
const testFactories: TestClientFactories = {
  happy: () => {
    return new LocalStorageClient({
      keyPrefix: "shared-test:",
      storage: new Storage(),
    });
  },
};

runSharedSuite("LocalStorageClient", testFactories);
