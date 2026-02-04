/**
 * IndexedDBClient tests
 */

/// <reference lib="deno.ns" />

import { IndexedDBClient } from "./mod.ts";
import {
  runSharedSuite,
  type TestClientFactories,
} from "../b3nd-testing/shared-suite.ts";
import { indexedDB } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;

// Counter to generate unique database names for each test
let testCount = 0;

// Run the shared test suite
const testFactories: TestClientFactories = {
  happy: () => {
    // Generate unique database name for each test to avoid interference
    const dbName = `shared-test-db-${++testCount}`;
    return new IndexedDBClient({
      databaseName: dbName,
      indexedDB: indexedDB,
    });
  },
};

runSharedSuite("IndexedDBClient", testFactories);
