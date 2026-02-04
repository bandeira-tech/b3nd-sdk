/**
 * Wallet Server Dependency Injection Interfaces
 *
 * These interfaces abstract runtime-specific operations, enabling the wallet
 * server to run in Deno, Node.js, or browsers through dependency injection.
 */

/**
 * File storage abstraction - replaces Deno.readTextFile/writeTextFile
 */
export interface FileStorage {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/**
 * Environment abstraction - replaces Deno.env.get()
 */
export interface Environment {
  get(key: string): string | undefined;
}

/**
 * Logger abstraction - replaces console.log/warn/error
 */
export interface Logger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * HTTP fetch abstraction - allows custom fetch implementations
 */
export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Default console logger implementation
 */
export const defaultLogger: Logger = {
  log: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

/**
 * In-memory file storage implementation (for testing/browser)
 */
export class MemoryFileStorage implements FileStorage {
  private storage = new Map<string, string>();

  async readTextFile(path: string): Promise<string> {
    const content = this.storage.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    this.storage.set(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.storage.has(path);
  }
}

/**
 * Environment from config object (for testing/browser)
 */
export class ConfigEnvironment implements Environment {
  constructor(private config: Record<string, string> = {}) {}

  get(key: string): string | undefined {
    return this.config[key];
  }
}
