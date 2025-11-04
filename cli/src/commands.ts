import { updateConfig, loadConfig, getConfigPath } from "./config.ts";
import { getClient, closeClient } from "./client.ts";
import { createLogger, Logger } from "./logger.ts";
import { parse, dirname } from "@std/path";
import { ensureDir } from "@std/fs";
import { encodeHex, decodeHex } from "@std/encoding/hex";

/**
 * Parse URI into protocol, domain, and path
 * Example: test://read-test/foobar -> { protocol: "test", domain: "read-test", path: "/foobar" }
 */
function parseUri(uri: string): { protocol: string; domain: string; path: string } {
  const match = uri.match(/^([a-z+.-]+):\/\/([^/]+)(.*)$/);
  if (!match) {
    return { protocol: "", domain: "", path: "" };
  }
  return {
    protocol: match[1],
    domain: match[2],
    path: match[3],
  };
}

/**
 * Account key file format
 */
interface AccountKey {
  privateKey: string;
  publicKey: string;
  algorithm: string;
  createdAt: string;
}

/**
 * Load account key from configured path
 */
async function loadAccountKey(): Promise<AccountKey> {
  const config = await loadConfig();
  if (!config.account) {
    throw new Error(
      "No account configured. Run: bnd account create"
    );
  }

  try {
    const content = await Deno.readTextFile(config.account);
    const key = JSON.parse(content) as AccountKey;
    return key;
  } catch (error) {
    throw new Error(
      `Failed to load account key from ${config.account}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Sign payload with account private key
 */
async function signPayload(privateKeyHex: string, payload: unknown): Promise<string> {
  try {
    const privateKeyBytes = decodeHex(privateKeyHex);
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      privateKeyBytes,
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["sign"]
    );

    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(payload));

    const signatureBytes = await crypto.subtle.sign("Ed25519", privateKey, data);
    return encodeHex(new Uint8Array(signatureBytes));
  } catch (error) {
    throw new Error(
      `Failed to sign payload: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Replace :key placeholder in URI with public key
 */
function replaceKeyPlaceholder(uri: string, publicKey: string): string {
  return uri.replace(/:key/g, publicKey);
}

/**
 * Handle `bnd conf node <url>` command
 */
export async function confNode(url: string): Promise<void> {
  if (!url) {
    throw new Error("Node URL required. Usage: bnd conf node <url>");
  }
  await updateConfig("node", url);
}

/**
 * Handle `bnd conf account <path>` command
 */
export async function confAccount(path: string): Promise<void> {
  if (!path) {
    throw new Error("Account key path required. Usage: bnd conf account <path>");
  }
  await updateConfig("account", path);
}

/**
 * Handle `bnd account create` command - generates Ed25519 key pair and configures it
 */
export async function accountCreate(outputPath?: string): Promise<void> {
  try {
    // Generate Ed25519 key pair
    const keyPair = await crypto.subtle.generateKey(
      "Ed25519",
      true, // extractable
      ["sign", "verify"]
    );

    // Export keys
    const privateKeyBuffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const publicKeyBuffer = await crypto.subtle.exportKey("raw", keyPair.publicKey);

    // Convert to hex
    const privateKeyHex = encodeHex(new Uint8Array(privateKeyBuffer));
    const publicKeyHex = encodeHex(new Uint8Array(publicKeyBuffer));

    // Determine output path
    const keyPath = outputPath || `${Deno.env.get("HOME")}/.bnd/account.key`;

    // Create directory if needed
    await ensureDir(dirname(keyPath));

    // Create key file with both keys
    const keyData = {
      privateKey: privateKeyHex,
      publicKey: publicKeyHex,
      algorithm: "Ed25519",
      createdAt: new Date().toISOString(),
    };

    await Deno.writeTextFile(keyPath, JSON.stringify(keyData, null, 2));

    // Set permissions to 0600 (read/write for owner only)
    await Deno.chmod(keyPath, 0o600);

    // Configure the account
    await updateConfig("account", keyPath);

    console.log(`✓ Account key created`);
    console.log(`  Private key (hex): ${privateKeyHex.substring(0, 32)}...`);
    console.log(`  Public key (hex):  ${publicKeyHex}`);
    console.log(`  Key file: ${keyPath}`);
    console.log(`  Config updated`);
  } catch (error) {
    throw new Error(
      `Failed to create account: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Handle `bnd write` command
 */
export async function write(args: string[], verbose = false): Promise<void> {
  const logger = createLogger(verbose);

  let uri: string | null = null;
  let data: unknown = null;

  // Check for -f flag for file input
  if (args[0] === "-f" && args[1]) {
    const filePath = args[1];
    try {
      const content = await Deno.readTextFile(filePath);
      logger?.info(`Read ${filePath} (${content.length} bytes)`);
      try {
        data = JSON.parse(content);
      } catch {
        data = content; // Treat as string if not JSON
      }
      uri = parse(filePath).name; // Use filename as default URI
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error}`);
    }
  } else if (args[0] && args[1]) {
    // Direct URI and data: bnd write <uri> <data>
    uri = args[0];
    try {
      data = JSON.parse(args[1]);
    } catch {
      data = args[1]; // Treat as string if not JSON
    }
  } else {
    throw new Error(
      "Usage: bnd write <uri> <data> OR bnd write -f <filepath>"
    );
  }

  if (!uri) {
    throw new Error("URI is required for write operation");
  }

  try {
    const config = await loadConfig();
    const client = await getClient(logger);

    // Handle :key placeholder in URI and accounts program writes
    if (uri.includes(":key")) {
      const accountKey = await loadAccountKey();
      uri = replaceKeyPlaceholder(uri, accountKey.publicKey);
      logger?.info(`Replaced :key with public key`);

      // For accounts domain, wrap in auth structure
      const { domain } = parseUri(uri);
      if (domain.includes("accounts")) {
        const signature = await signPayload(accountKey.privateKey, data);
        logger?.info(`Signed payload with account key`);

        data = {
          auth: [
            {
              pubkey: accountKey.publicKey,
              signature: signature,
            },
          ],
          payload: data,
        };
      }
    }

    const { protocol, domain, path } = parseUri(uri);
    const endpoint = `${config.node}/api/v1/write/${protocol}/${domain}${path}`;
    logger?.http("POST", endpoint);

    const result = await client.write(uri, data);

    if (result.success) {
      console.log(`✓ Write successful`);
      console.log(`  URI: ${uri}`);
      console.log(`  Data: ${JSON.stringify(data)}`);
      if (result.record?.ts) {
        console.log(`  Timestamp: ${new Date(result.record.ts).toISOString()}`);
      }
    } else {
      throw new Error(result.error || "Write failed with no error message");
    }
  } finally {
    await closeClient(logger);
  }
}

/**
 * Handle `bnd read` command
 */
export async function read(uri: string, verbose = false): Promise<void> {
  const logger = createLogger(verbose);

  if (!uri) {
    throw new Error("URI required. Usage: bnd read <uri>");
  }

  try {
    const config = await loadConfig();
    const client = await getClient(logger);

    // Handle :key placeholder in URI
    if (uri.includes(":key")) {
      const accountKey = await loadAccountKey();
      uri = replaceKeyPlaceholder(uri, accountKey.publicKey);
      logger?.info(`Replaced :key with public key`);
    }

    const { protocol, domain, path } = parseUri(uri);
    const endpoint = `${config.node}/api/v1/read/${protocol}/${domain}${path}`;
    logger?.http("GET", endpoint);

    const result = await client.read(uri);

    if (result.success && result.record) {
      console.log(`✓ Read successful`);
      console.log(`  URI: ${uri}`);
      console.log(`  Data: ${JSON.stringify(result.record.data, null, 2)}`);
      console.log(`  Timestamp: ${new Date(result.record.ts).toISOString()}`);
    } else if (!result.success) {
      throw new Error(result.error || "Read failed");
    } else {
      console.log(`✓ Read complete, but no data found at ${uri}`);
    }
  } finally {
    await closeClient(logger);
  }
}

/**
 * Handle `bnd list` command
 */
export async function list(uri: string, verbose = false, options?: { page?: number; limit?: number }): Promise<void> {
  const logger = createLogger(verbose);

  if (!uri) {
    throw new Error("URI required. Usage: bnd list <uri>");
  }

  try {
    const config = await loadConfig();
    const client = await getClient(logger);

    // Handle :key placeholder in URI
    if (uri.includes(":key")) {
      const accountKey = await loadAccountKey();
      uri = replaceKeyPlaceholder(uri, accountKey.publicKey);
      logger?.info(`Replaced :key with public key`);
    }

    const { protocol, domain, path } = parseUri(uri);
    const queryStr = new URLSearchParams(options as Record<string, string>).toString();
    const endpoint = `${config.node}/api/v1/list/${protocol}/${domain}${path}${queryStr ? `?${queryStr}` : ""}`;
    logger?.http("GET", endpoint);

    const result = await client.list(uri, options);

    if (result.success) {
      console.log(`✓ List successful`);
      console.log(`  URI: ${uri}`);
      console.log(`  Total: ${result.pagination.total || result.data.length} items`);
      console.log(`  Page: ${result.pagination.page}/${Math.ceil((result.pagination.total || 0) / (result.pagination.limit || 50))}`);
      console.log("");
      console.log("Items:");
      for (const item of result.data) {
        const itemName = ((item as unknown) as Record<string, unknown>).name || item.uri || "unknown";
        const itemTime = ((item as unknown) as Record<string, unknown>).timestamp || ((item as unknown) as Record<string, unknown>).ts || Date.now();
        console.log(`  - ${itemName} (${new Date(Number(itemTime)).toISOString()})`);
      }
    } else {
      throw new Error(result.error || "List failed");
    }
  } finally {
    await closeClient(logger);
  }
}

/**
 * Show configuration
 */
export async function showConfig(): Promise<void> {
  const config = await loadConfig();
  const path = getConfigPath();

  console.log("Current Configuration:");
  console.log(`  Config file: ${path}`);
  console.log(`  Node: ${config.node || "(not set)"}`);
  console.log(`  Account: ${config.account || "(not set)"}`);

  if (Object.keys(config).length === 0) {
    console.log("");
    console.log("To configure the CLI, run:");
    console.log("  bnd conf node <node-url>");
    console.log("  bnd conf account <key-path>");
  }
}

/**
 * Show help
 */
export function showHelp(): void {
  console.log(`
b3nd CLI - Development and debugging tool for b3nd nodes

USAGE:
  bnd [options] <command> [arguments]

COMMANDS:
  account create [path]    Generate Ed25519 key pair and configure it
  conf node <url>          Set the node URL
  conf account <path>      Set the account key path
  write <uri> <data>       Write data to a URI
  write -f <filepath>      Write data from a JSON file
  read <uri>               Read data from a URI
  list <uri>               List items at a URI
  config                   Show current configuration
  help                     Show this help message

OPTIONS:
  -v, --verbose            Show detailed operation logs for debugging

EXAMPLES:
  bnd account create
  bnd account create path/to/my/account.key
  bnd conf node https://testnet-evergreen.fire.cat

  bnd write tmp://some/path "this is a nice little payload"
  bnd read tmp://some/path

  bnd write -f mypayload.json
  bnd read store://account/:key/profile
  bnd list store://account/:key/books

DEBUGGING:
  bnd --verbose write test://read-test/foobar "foobar"
  bnd -v read test://read-test/foobar
  bnd --verbose list store://account/:key/books

DOCUMENTATION:
  https://github.com/bandeira-tech/b3nd-sdk
`);
}
