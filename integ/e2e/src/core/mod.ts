/**
 * Core E2E Testing Framework
 * Provides shared utilities and infrastructure for end-to-end tests
 */

import { walk } from "@std/fs/walk";

// Configuration
export interface TestConfig {
  baseUrl: string;
  instance: string;
  timeout: number;
  verbose: boolean;
}

export const defaultConfig: TestConfig = {
  baseUrl: Deno.env.get("E2E_BASE_URL") || "http://localhost:8000",
  instance: Deno.env.get("E2E_INSTANCE") || "default",
  timeout: parseInt(Deno.env.get("E2E_TIMEOUT") || "30000"),
  verbose: Deno.env.get("E2E_VERBOSE") === "true",
};

// Test Result Types
export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface TestSuite {
  name: string;
  tests: TestResult[];
  startTime: number;
  endTime?: number;
}

// API Client
export class ApiClient {
  constructor(private config: TestConfig = defaultConfig) {}

  async write(
    uri: string,
    value: unknown,
  ): Promise<{
    success: boolean;
    record?: { ts: number; data: unknown };
    error?: string;
  }> {
    try {
      const response = await fetch(
        `${this.config.baseUrl}/api/v1/write?instance=${this.config.instance}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uri, value }),
        },
      );

      if (!response.ok) {
        const err = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        return { success: false, error: err.error };
      }

      const result = await response.json();
      return { success: true, record: result.record };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async read(uri: string): Promise<{
    success: boolean;
    record?: { ts: number; data: unknown };
    error?: string;
  }> {
    try {
      const { protocol, domain, path } = this.parseUri(uri);
      const response = await fetch(
        `${this.config.baseUrl}/api/v1/read/${this.config.instance}/${protocol}/${domain}${path}`,
      );

      if (!response.ok) {
        const err = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        return { success: false, error: err.error };
      }

      const record = await response.json();
      return { success: true, record };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async list(pattern?: string): Promise<{
    success: boolean;
    records?: Array<{ uri: string; ts: number; data: unknown }>;
    error?: string;
  }> {
    try {
      const url = new URL(`${this.config.baseUrl}/api/v1/list`);
      url.searchParams.set("instance", this.config.instance);
      if (pattern) {
        url.searchParams.set("pattern", pattern);
      }

      const response = await fetch(url.toString());

      if (!response.ok) {
        const err = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        return { success: false, error: err.error };
      }

      const records = await response.json();
      return { success: true, records };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async delete(uri: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const { protocol, domain, path } = this.parseUri(uri);
      const response = await fetch(
        `${this.config.baseUrl}/api/v1/delete/${protocol}/${domain}${path}?instance=${this.config.instance}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        const err = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        return { success: false, error: err.error };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  private parseUri(uri: string): {
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
}

// Fixture Management
export interface Fixture {
  name: string;
  uri: string;
  data: unknown;
  metadata?: Record<string, unknown>;
}

export async function loadFixtures(
  path: string = "fixtures",
): Promise<Fixture[]> {
  const fixtures: Fixture[] = [];

  try {
    const walker = walk(path, { exts: [".json"] });
    for await (const entry of walker) {
      if (entry.isFile) {
        const content = await Deno.readTextFile(entry.path);
        const data = JSON.parse(content);

        // Support both direct fixture format and wrapped format
        if (data.uri) {
          fixtures.push({
            name: entry.name.replace(/\.json$/, ""),
            uri: data.uri,
            data: data.value || data.data,
            metadata: data.metadata,
          });
        } else {
          // Assume the whole file is the data
          const name = entry.name.replace(/\.json$/, "");
          fixtures.push({
            name,
            uri: `test://${name}/${Date.now()}`,
            data,
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error loading fixtures from ${path}:`, error);
  }

  return fixtures;
}

// Test Runner
export class TestRunner {
  private suite: TestSuite;
  private config: TestConfig;

  constructor(name: string, config: TestConfig = defaultConfig) {
    this.suite = {
      name,
      tests: [],
      startTime: Date.now(),
    };
    this.config = config;
  }

  async run(
    name: string,
    testFn: () => Promise<void> | void,
  ): Promise<TestResult> {
    const startTime = Date.now();
    const result: TestResult = {
      name,
      passed: false,
      duration: 0,
    };

    try {
      if (this.config.verbose) {
        console.log(`  Running: ${name}`);
      }

      await testFn();
      result.passed = true;

      if (this.config.verbose) {
        console.log(`  ✅ Passed: ${name}`);
      }
    } catch (error) {
      result.error = (error as Error).message;

      if (this.config.verbose) {
        console.error(`  ❌ Failed: ${name}`);
        console.error(`     Error: ${result.error}`);
      }
    }

    result.duration = Date.now() - startTime;
    this.suite.tests.push(result);

    return result;
  }

  async runAll(
    tests: Array<{
      name: string;
      fn: () => Promise<void> | void;
    }>,
  ): Promise<void> {
    console.log(`\n🚀 Running test suite: ${this.suite.name}\n`);

    for (const test of tests) {
      await this.run(test.name, test.fn);
    }

    this.suite.endTime = Date.now();
    this.printSummary();
  }

  printSummary(): void {
    const passed = this.suite.tests.filter((t) => t.passed).length;
    const failed = this.suite.tests.filter((t) => !t.passed).length;
    const duration = (this.suite.endTime || Date.now()) - this.suite.startTime;

    console.log("\n" + "=".repeat(60));
    console.log(`📊 Test Summary: ${this.suite.name}`);
    console.log("=".repeat(60));
    console.log(`  Total:    ${this.suite.tests.length} tests`);
    console.log(`  Passed:   ${passed} ✅`);
    console.log(`  Failed:   ${failed} ❌`);
    console.log(`  Duration: ${duration}ms`);
    console.log("=".repeat(60));

    if (failed > 0) {
      console.log("\n❌ Failed Tests:");
      this.suite.tests
        .filter((t) => !t.passed)
        .forEach((test) => {
          console.log(`  - ${test.name}`);
          if (test.error) {
            console.log(`    Error: ${test.error}`);
          }
        });
    }

    if (failed === 0) {
      console.log("\n✅ All tests passed successfully!");
    } else {
      Deno.exit(1);
    }
  }

  getResults(): TestSuite {
    return this.suite;
  }
}

// Assertion Helpers
export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message ||
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export function assertExists<T>(
  value: T | null | undefined,
  message?: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message || "Value does not exist");
  }
}

// Utility Functions
export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
