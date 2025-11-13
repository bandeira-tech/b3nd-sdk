import { updateConfig, loadConfig, getConfigPath } from "./config.ts";
import { getClient, closeClient } from "./client.ts";
import { createLogger, Logger } from "./logger.ts";
import { parse, dirname } from "@std/path";
import { ensureDir } from "@std/fs";
import { encodeHex } from "@std/encoding/hex";
import { encrypt, decrypt, type EncryptedPayload } from "@b3nd/sdk/encrypt";

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
 * Account key - stored as PEM file
 */
interface AccountKey {
  privateKeyPem: string; // PKCS8 PEM encoded Ed25519 private key
  publicKeyHex: string; // Hex encoded public key
}

/**
 * Encryption key - stored as PEM file
 */
interface EncryptionKey {
  privateKeyPem: string; // PKCS8 PEM encoded X25519 private key
  publicKeyHex: string; // Hex encoded public key
}

/**
 * Convert PEM string to CryptoKey (Ed25519 or X25519)
 */
async function pemToCryptoKey(pem: string, algorithm: "Ed25519" | "X25519" = "Ed25519"): Promise<CryptoKey> {
  // Extract base64 content from PEM
  const base64 = pem
    .split('\n')
    .filter(line => !line.startsWith('-----'))
    .join('');

  // Decode base64 to bytes
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Import as PKCS8 private key
  if (algorithm === "Ed25519") {
    return await crypto.subtle.importKey(
      "pkcs8",
      bytes,
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["sign"]
    );
  } else {
    return await crypto.subtle.importKey(
      "pkcs8",
      bytes,
      { name: "X25519", namedCurve: "X25519" },
      false,
      ["deriveBits"]
    );
  }
}

/**
 * Load account key from configured path (PEM format)
 */
async function loadAccountKey(): Promise<{ privateKeyPem: string; publicKeyHex: string }> {
  const config = await loadConfig();
  if (!config.account) {
    throw new Error(
      "No account configured. Run: bnd account create"
    );
  }

  try {
    const content = await Deno.readTextFile(config.account);

    // Parse as simple format: PEM + optional public key on last line
    const lines = content.trim().split('\n');
    let publicKeyHex = "";
    let pemLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("PUBLIC_KEY_HEX=")) {
        publicKeyHex = line.substring("PUBLIC_KEY_HEX=".length);
      } else {
        pemLines.push(line);
      }
    }

    const privateKeyPem = pemLines.join('\n');

    if (!publicKeyHex) {
      throw new Error("Public key not found in account key file");
    }

    return { privateKeyPem, publicKeyHex };
  } catch (error) {
    throw new Error(
      `Failed to load account key from ${config.account}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Load encryption key from configured path (PEM format)
 */
async function loadEncryptionKey(): Promise<{ privateKeyPem: string; publicKeyHex: string }> {
  const config = await loadConfig();
  if (!config.encrypt) {
    throw new Error(
      "No encryption key configured. Run: bnd encrypt create"
    );
  }

  try {
    const content = await Deno.readTextFile(config.encrypt);

    // Parse as simple format: PEM + optional public key on last line
    const lines = content.trim().split('\n');
    let publicKeyHex = "";
    let pemLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("PUBLIC_KEY_HEX=")) {
        publicKeyHex = line.substring("PUBLIC_KEY_HEX=".length);
      } else {
        pemLines.push(line);
      }
    }

    const privateKeyPem = pemLines.join('\n');

    if (!publicKeyHex) {
      throw new Error("Public key not found in encryption key file");
    }

    return { privateKeyPem, publicKeyHex };
  } catch (error) {
    throw new Error(
      `Failed to load encryption key from ${config.encrypt}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Sign payload with account private key (PEM format)
 */
async function signPayload(privateKeyPem: string, payload: unknown): Promise<string> {
  try {
    const privateKey = await pemToCryptoKey(privateKeyPem, "Ed25519");

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
 * Handle `bnd account create` command - generates Ed25519 key pair in PEM format
 */
export async function accountCreate(outputPath?: string): Promise<void> {
  try {
    // Generate Ed25519 key pair for signing
    const keyPair = await crypto.subtle.generateKey(
      "Ed25519",
      true, // extractable
      ["sign", "verify"]
    );

    // Export keys
    const privateKeyBuffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const publicKeyBuffer = await crypto.subtle.exportKey("raw", keyPair.publicKey);

    // Convert private key to PEM format (PKCS8)
    const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(privateKeyBuffer)));
    const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${privateKeyBase64.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`;

    // Convert public key to hex
    const publicKeyHex = encodeHex(new Uint8Array(publicKeyBuffer));

    // Determine output path
    const keyPath = outputPath || `${Deno.env.get("HOME")}/.bnd/accounts/default.key`;

    // Create directory if needed
    await ensureDir(dirname(keyPath));

    // Write file with PEM + public key hex
    const content = `${privateKeyPem}\nPUBLIC_KEY_HEX=${publicKeyHex}`;
    await Deno.writeTextFile(keyPath, content);

    // Set permissions to 0600 (read/write for owner only)
    await Deno.chmod(keyPath, 0o600);

    // Configure the account
    await updateConfig("account", keyPath);

    console.log(`✓ Account key created`);
    console.log(`  Public key: ${publicKeyHex}`);
    console.log(`  Key file: ${keyPath}`);
    console.log(`  Config updated`);
  } catch (error) {
    throw new Error(
      `Failed to create account: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Handle `bnd encrypt create` command - generates X25519 encryption key pair in PEM format
 */
export async function encryptCreate(outputPath?: string): Promise<void> {
  try {
    // Generate X25519 key pair for encryption
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "X25519",
        namedCurve: "X25519",
      },
      true,
      ["deriveBits"]
    );

    // Export keys
    const privateKeyBuffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const publicKeyBuffer = await crypto.subtle.exportKey("raw", keyPair.publicKey);

    // Convert private key to PEM format (PKCS8)
    const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(privateKeyBuffer)));
    const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${privateKeyBase64.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`;

    // Convert public key to hex
    const publicKeyHex = encodeHex(new Uint8Array(publicKeyBuffer));

    // Determine output path
    const keyPath = outputPath || `${Deno.env.get("HOME")}/.bnd/encryption/default.key`;

    // Create directory if needed
    await ensureDir(dirname(keyPath));

    // Write file with PEM + public key hex
    const content = `${privateKeyPem}\nPUBLIC_KEY_HEX=${publicKeyHex}`;
    await Deno.writeTextFile(keyPath, content);

    // Set permissions to 0600 (read/write for owner only)
    await Deno.chmod(keyPath, 0o600);

    // Configure encryption
    await updateConfig("encrypt", keyPath);

    console.log(`✓ Encryption key created`);
    console.log(`  Public key: ${publicKeyHex}`);
    console.log(`  Key file: ${keyPath}`);
    console.log(`  Config updated`);
  } catch (error) {
    throw new Error(
      `Failed to create encryption key: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Handle `bnd conf encrypt` command to set encryption key file
 */
export async function confEncrypt(keyPath: string): Promise<void> {
  if (!keyPath) {
    throw new Error("Encryption key path required. Usage: bnd conf encrypt <path>");
  }

  // Verify file exists and is readable
  try {
    await Deno.readTextFile(keyPath);
  } catch {
    throw new Error(`Cannot read encryption key file: ${keyPath}`);
  }

  await updateConfig("encrypt", keyPath);
}

/**
 * Handle `bnd write` command
 */
export async function write(args: string[], verbose = false): Promise<void> {
  const logger = createLogger(verbose);

  let uri: string | null = null;
  let data: unknown = null;
  let originalData: unknown = null;  // Keep track of original before encryption

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

  // Save original data before encryption
  originalData = data;

  try {
    const config = await loadConfig();
    const client = await getClient(logger);

    // Handle :key placeholder in URI and accounts program writes
    if (uri.includes(":key")) {
      const accountKey = await loadAccountKey();
      uri = replaceKeyPlaceholder(uri, accountKey.publicKeyHex);
      logger?.info(`Replaced :key with public key`);

      // For accounts domain, wrap in auth structure
      const { domain } = parseUri(uri);
      if (domain.includes("accounts")) {
        // Check if encryption is enabled
        const config = await loadConfig();
        if (config.encrypt) {
          try {
            const encryptionKey = await loadEncryptionKey();
            const encryptedPayload = await encrypt(data, encryptionKey.publicKeyHex);
            logger?.info(`Encrypted payload`);

            const signature = await signPayload(accountKey.privateKeyPem, encryptedPayload);
            logger?.info(`Signed encrypted payload with account key`);

            data = {
              auth: [
                {
                  pubkey: accountKey.publicKeyHex,
                  signature: signature,
                },
              ],
              payload: encryptedPayload,
            };
          } catch (error) {
            throw new Error(`Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          const signature = await signPayload(accountKey.privateKeyPem, data);
          logger?.info(`Signed payload with account key`);

          data = {
            auth: [
              {
                pubkey: accountKey.publicKeyHex,
                signature: signature,
              },
            ],
            payload: data,
          };
        }
      }
    }

    const { protocol, domain, path } = parseUri(uri);
    const endpoint = `${config.node}/api/v1/write/${protocol}/${domain}${path}`;
    logger?.http("POST", endpoint);

    const result = await client.write(uri, data);

    if (result.success) {
      console.log(`✓ Write successful`);
      console.log(`  URI: ${uri}`);
      console.log(`  Encrypted: ${config.encrypt ? "yes" : "no"}`);
      console.log(`  Value: ${JSON.stringify(originalData)}`);
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
      uri = replaceKeyPlaceholder(uri, accountKey.publicKeyHex);
      logger?.info(`Replaced :key with public key`);
    }

    const { protocol, domain, path } = parseUri(uri);
    const endpoint = `${config.node}/api/v1/read/${protocol}/${domain}${path}`;
    logger?.http("GET", endpoint);

    const result = await client.read(uri);

    if (result.success && result.record) {
      console.log(`✓ Read successful`);
      console.log(`  URI: ${uri}`);

      // Always show the raw stored data first
      console.log(`  Stored Data: ${JSON.stringify(result.record.data, null, 2)}`);

      // Try to decrypt if encryption key is configured
      const config = await loadConfig();
      if (config.encrypt && result.record.data && typeof result.record.data === "object") {
        const data = result.record.data as any;

        // Check if this is an auth structure with an encrypted payload
        if (data.payload && typeof data.payload === "object") {
          const payload = data.payload;

          // Check if the payload looks like an encrypted payload (has data, nonce, ephemeralPublicKey)
          if (payload.data && payload.nonce && payload.ephemeralPublicKey) {
            try {
              const encryptionKey = await loadEncryptionKey();
              const encryptedPayload: EncryptedPayload = {
                data: payload.data,
                nonce: payload.nonce,
                ephemeralPublicKey: payload.ephemeralPublicKey,
              };

              // Import X25519 private key for decryption
              const privateKey = await pemToCryptoKey(encryptionKey.privateKeyPem, "X25519");
              const decryptedData = await decrypt(encryptedPayload, privateKey);

              // Show decrypted value separately
              console.log(`  Decrypted Payload: ${JSON.stringify(decryptedData)}`);
              logger?.info(`Decrypted payload`);
            } catch (error) {
              logger?.error(`Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      }

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
      uri = replaceKeyPlaceholder(uri, accountKey.publicKeyHex);
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
  console.log(`  Encryption key: ${config.encrypt || "(not set)"}`);

  if (Object.keys(config).length === 0) {
    console.log("");
    console.log("To configure the CLI, run:");
    console.log("  bnd account create");
    console.log("  bnd conf node <node-url>");
    console.log("  bnd encrypt create");
    console.log("  bnd conf encrypt <path>");
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
  account create [path]    Generate Ed25519 key pair (PEM format)
  encrypt create [path]    Generate X25519 encryption key pair (PEM format)
  conf node <url>          Set the node URL
  conf account <path>      Set the account key path
  conf encrypt <path>      Set the encryption key path
  write <uri> <data>       Write data to a URI
  write -f <filepath>      Write data from a JSON file
  read <uri>               Read data from a URI
  list <uri>               List items at a URI
  config                   Show current configuration
  server-keys env         Generate server keys and print .env entries
  help                     Show this help message

OPTIONS:
  -v, --verbose            Show detailed operation logs for debugging

SETUP - Single Account:
  bnd account create
  bnd conf node http://localhost:3000
  bnd encrypt create
  bnd conf encrypt ~/.bnd/encryption/default.key

SETUP - Multiple Accounts:
  # Create accounts
  bnd account create ~/.bnd/accounts/alice.key
  bnd account create ~/.bnd/accounts/bob.key

  # Switch accounts
  bnd conf account ~/.bnd/accounts/alice.key

  # Create encryption keys
  bnd encrypt create ~/.bnd/encryption/alice.key
  bnd conf encrypt ~/.bnd/encryption/alice.key

EXAMPLES:
  # Basic operations
  bnd write tmp://some/path "this is a nice little payload"
  bnd read tmp://some/path

  # Account-based writes with automatic signing
  bnd write mutable://accounts/:key/profile '{"name":"Alice"}'
  bnd read mutable://accounts/:key/profile

  # Switch to different account
  bnd conf account ~/.bnd/accounts/bob.key
  bnd write mutable://accounts/:key/profile '{"name":"Bob"}'

DEBUGGING:
  bnd --verbose write test://read-test/foobar "foobar"
  bnd -v read test://read-test/foobar
  bnd config

DOCUMENTATION:
  https://github.com/bandeira-tech/b3nd-sdk
`);
}

/**
 * Generate server identity (Ed25519) and encryption (X25519) keys
 * and print .env-compatible lines. Also writes .env.keys in CWD.
 */
export async function serverKeysEnv(): Promise<void> {
  function bytesToBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes));
  }
  function formatPrivateKeyPem(base64: string): string {
    const lines = base64.match(/.{1,64}/g) || [];
    return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`;
  }

  async function genEd25519(): Promise<{ privateKeyPem: string; publicKeyHex: string }> {
    const kp = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair;
    const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
    const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
    const privateKeyPem = formatPrivateKeyPem(bytesToBase64(new Uint8Array(priv)));
    const publicKeyHex = Array.from(new Uint8Array(pub)).map(b=>b.toString(16).padStart(2,"0")).join("");
    return { privateKeyPem, publicKeyHex };
  }

  async function genX25519(): Promise<{ privateKeyPem: string; publicKeyHex: string }> {
    const kp = await crypto.subtle.generateKey({ name: "X25519", namedCurve: "X25519" }, true, ["deriveBits"]) as CryptoKeyPair;
    const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
    const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
    const privateKeyPem = formatPrivateKeyPem(bytesToBase64(new Uint8Array(priv)));
    const publicKeyHex = Array.from(new Uint8Array(pub)).map(b=>b.toString(16).padStart(2,"0")).join("");
    return { privateKeyPem, publicKeyHex };
  }

  const id = await genEd25519();
  const enc = await genX25519();

  const envText = `# b3nd Server Keys\n# Generated: ${new Date().toISOString()}\n\nSERVER_IDENTITY_PRIVATE_KEY_PEM="${id.privateKeyPem.replace(/\n/g, "\\n")}"\nSERVER_IDENTITY_PUBLIC_KEY_HEX="${id.publicKeyHex}"\nSERVER_ENCRYPTION_PRIVATE_KEY_PEM="${enc.privateKeyPem.replace(/\n/g, "\\n")}"\nSERVER_ENCRYPTION_PUBLIC_KEY_HEX="${enc.publicKeyHex}"\n`;

  console.log(envText);
  try {
    await Deno.writeTextFile(".env.keys", envText);
    console.log("✓ Wrote .env.keys (copy values into your .env and delete the file)");
  } catch (_) {
    // ignore write error
  }
}
