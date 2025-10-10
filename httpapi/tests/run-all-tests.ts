/**
 * Test runner for all httpapi tests
 *
 * Usage: deno test --allow-net --allow-read --allow-write --allow-env tests/run-all-tests.ts
 * Or: deno task test
 */

import { green, red, yellow, bold, blue, gray } from "jsr:@std/fmt/colors";

const testFiles = [
  "./client-manager.test.ts",
  "./api-health.test.ts",
  "./api-operations.test.ts",
  "./api-errors.test.ts",
  "./integration-clients.test.ts",
  "./config.test.ts",
];

interface TestResult {
  file: string;
  passed: number;
  failed: number;
  ignored: number;
  measured: number;
  duration: number;
  errors: string[];
}

async function runTestFile(testFile: string): Promise<TestResult> {
  console.log(`\n${bold(blue(`Running ${testFile}...`))}`);

  const result: TestResult = {
    file: testFile,
    passed: 0,
    failed: 0,
    ignored: 0,
    measured: 0,
    duration: 0,
    errors: [],
  };

  const startTime = performance.now();

  try {
    // Create a temporary test file that imports and runs the tests
    const testRunner = `
      import { resetClientManager } from "../src/clients.ts";

      // Reset client manager before all tests
      resetClientManager();

      // Import the test file
      await import("${testFile}");
    `;

    const tempFile = `./temp-test-${Date.now()}.ts`;
    await Deno.writeTextFile(tempFile, testRunner);

    const process = new Deno.Command(Deno.execPath(), {
      args: [
        "test",
        "--allow-net",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--no-check", // Skip type checking for faster tests
        tempFile,
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await process.output();
    const output = new TextDecoder().decode(stdout);
    const errorOutput = new TextDecoder().decode(stderr);

    await Deno.remove(tempFile).catch(() => {}); // Clean up temp file

    const endTime = performance.now();
    result.duration = endTime - startTime;

    // Parse Deno test output
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('ok')) {
        const match = line.match(/(\d+) passed/);
        if (match) result.passed = parseInt(match[1]);
      }
      if (line.includes('failed')) {
        const match = line.match(/(\d+) failed/);
        if (match) result.failed = parseInt(match[1]);
      }
      if (line.includes('ignored')) {
        const match = line.match(/(\d+) ignored/);
        if (match) result.ignored = parseInt(match[1]);
      }
    }

    if (code !== 0) {
      result.errors.push(errorOutput || "Test execution failed");
    }

    // If we couldn't parse the output, assume it failed
    if (result.passed === 0 && result.failed === 0 && result.ignored === 0) {
      result.failed = 1;
      result.errors.push("Could not parse test output");
    }

  } catch (error) {
    result.failed = 1;
    result.errors.push(error instanceof Error ? error.message : String(error));
    result.duration = performance.now() - startTime;
  }

  return result;
}

function printResults(results: TestResult[]) {
  console.log(`\n${bold("Test Summary")}\n`);

  let totalPassed = 0;
  let totalFailed = 0;
  let totalIgnored = 0;
  let totalDuration = 0;

  for (const result of results) {
    totalPassed += result.passed;
    totalFailed += result.failed;
    totalIgnored += result.ignored;
    totalDuration += result.duration;

    const status = result.failed > 0 ? red("✗ FAILED") : green("✓ PASSED");
    const duration = `(${result.duration.toFixed(0)}ms)`;

    console.log(
      `${status} ${result.file} ${gray(duration)}\n` +
      `  ${green(`${result.passed} passed`)}, ${red(`${result.failed} failed`)}, ${yellow(`${result.ignored} ignored`)}`
    );

    if (result.errors.length > 0) {
      console.log(red("  Errors:"));
      for (const error of result.errors) {
        console.log(red(`    ${error}`));
      }
    }
    console.log();
  }

  const overallStatus = totalFailed > 0 ? red("FAILED") : green("PASSED");
  console.log(
    `${bold("Overall:")} ${overallStatus}\n` +
    `${green(`${totalPassed} passed`)}, ${red(`${totalFailed} failed`)}, ${yellow(`${totalIgnored} ignored`)}\n` +
    `Total duration: ${totalDuration.toFixed(0)}ms`
  );
}

async function main() {
  console.log(bold(blue("🧪 Running HTTPAPI Test Suite\n")));

  const results: TestResult[] = [];

  for (const testFile of testFiles) {
    const result = await runTestFile(testFile);
    results.push(result);

    // Stop on first failure if --fail-fast is provided
    if (Deno.args.includes("--fail-fast") && result.failed > 0) {
      break;
    }
  }

  printResults(results);

  // Exit with appropriate code
  const hasFailures = results.some(r => r.failed > 0);
  Deno.exit(hasFailures ? 1 : 0);
}

// Run the test suite
if (import.meta.main) {
  main().catch((error) => {
    console.error(red("Test runner failed:"), error);
    Deno.exit(1);
  });
}

// Re-export utilities for individual test files
export { testFiles };