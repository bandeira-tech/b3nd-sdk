/**
 * LocalStorageClient tests
 */
import { LocalStorageClient } from "../clients/local-storage/mod.ts";
import { runSharedSuite, type TestClientFactories } from "./shared-suite.ts";

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
