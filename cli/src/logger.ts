/**
 * Verbose logging utilities for debugging CLI operations
 */

export interface LoggerConfig {
  verbose: boolean;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2).split("\n").join("\n    ");
  }
  return String(value);
}

export class Logger {
  constructor(private config: LoggerConfig) {}

  /** Log HTTP request being made */
  http(method: string, url: string): void {
    if (!this.config.verbose) return;
    console.log(`  → ${method} ${url}`);
  }

  /** Log important info (connection, results, etc) */
  info(message: string): void {
    if (!this.config.verbose) return;
    console.log(`  ℹ ${message}`);
  }

  /** Log detailed data structures */
  data(label: string, value: unknown): void {
    if (!this.config.verbose) return;
    console.log(`  ${label}:`);
    console.log(`    ${formatValue(value)}`);
  }

  error(message: string): void {
    // Errors always show, regardless of verbose
    console.error(`  ✗ ${message}`);
  }

  section(name: string): void {
    if (!this.config.verbose) return;
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  ${name}`);
    console.log(`${"─".repeat(60)}`);
  }
}

export function createLogger(verbose: boolean): Logger {
  return new Logger({ verbose });
}
