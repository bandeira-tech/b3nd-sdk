import { getConfigPath, loadConfig, updateConfig } from "./config.ts";
import { closeRig, getRig } from "./client.ts";
import { createLogger, Logger } from "./logger.ts";
import { dirname, parse } from "@std/path";
import { ensureDir } from "@std/fs";
import { encodeHex } from "@std/encoding/hex";
import {
  decrypt,
  type EncryptedPayload,
  pemToCryptoKey,
} from "@b3nd/sdk/encrypt";
import { loadEncryptionKey } from "./keys.ts";

/**
 * Compute SHA256 hash of binary data
 * @param data - Binary data to hash
 * @returns Hex-encoded SHA256 hash
 */
async function computeSha256(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    data as BufferSource,
  );
  return encodeHex(new Uint8Array(hashBuffer));
}

/**
 * Parse URI into protocol, domain, and path
 * Example: test://read-test/foobar -> { protocol: "test", domain: "read-test", path: "/foobar" }
 */
function parseUri(
  uri: string,
): { protocol: string; domain: string; path: string } {
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
    throw new Error(
      "Account key path required. Usage: bnd conf account <path>",
    );
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
      ["sign", "verify"],
    );

    // Export keys
    const privateKeyBuffer = await crypto.subtle.exportKey(
      "pkcs8",
      keyPair.privateKey,
    );
    const publicKeyBuffer = await crypto.subtle.exportKey(
      "raw",
      keyPair.publicKey,
    );

    // Convert private key to PEM format (PKCS8)
    const privateKeyBase64 = btoa(
      String.fromCharCode(...new Uint8Array(privateKeyBuffer)),
    );
    const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${
      privateKeyBase64.match(/.{1,64}/g)?.join("\n")
    }\n-----END PRIVATE KEY-----`;

    // Convert public key to hex
    const publicKeyHex = encodeHex(new Uint8Array(publicKeyBuffer));

    // Determine output path
    const keyPath = outputPath ||
      `${Deno.env.get("HOME")}/.bnd/accounts/default.key`;

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
      `Failed to create account: ${
        error instanceof Error ? error.message : String(error)
      }`,
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
      ["deriveBits"],
    );

    // Export keys
    const privateKeyBuffer = await crypto.subtle.exportKey(
      "pkcs8",
      keyPair.privateKey,
    );
    const publicKeyBuffer = await crypto.subtle.exportKey(
      "raw",
      keyPair.publicKey,
    );

    // Convert private key to PEM format (PKCS8)
    const privateKeyBase64 = btoa(
      String.fromCharCode(...new Uint8Array(privateKeyBuffer)),
    );
    const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${
      privateKeyBase64.match(/.{1,64}/g)?.join("\n")
    }\n-----END PRIVATE KEY-----`;

    // Convert public key to hex
    const publicKeyHex = encodeHex(new Uint8Array(publicKeyBuffer));

    // Determine output path
    const keyPath = outputPath ||
      `${Deno.env.get("HOME")}/.bnd/encryption/default.key`;

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
      `Failed to create encryption key: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Handle `bnd conf encrypt` command to set encryption key file
 */
export async function confEncrypt(keyPath: string): Promise<void> {
  if (!keyPath) {
    throw new Error(
      "Encryption key path required. Usage: bnd conf encrypt <path>",
    );
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
 * Handle `bnd send` command — send data to the network via the rig.
 *
 * - With identity + encryption: rig.sendEncrypted() (auto-signs + encrypts)
 * - With identity: rig.send() (auto-signs, content-addressed envelope)
 * - Without identity: rig.receive() (raw message, for open URIs)
 *
 * The rig handles signing, encryption, and envelope construction.
 * The CLI just parses input and delegates.
 */
export async function send(args: string[], verbose = false): Promise<void> {
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
    // Direct URI and data: bnd send <uri> <data>
    uri = args[0];
    try {
      data = JSON.parse(args[1]);
    } catch {
      data = args[1]; // Treat as string if not JSON
    }
  } else {
    throw new Error(
      "Usage: bnd send <uri> <data> OR bnd send -f <filepath>",
    );
  }

  if (!uri) {
    throw new Error("URI is required");
  }

  try {
    const config = await loadConfig();
    const rig = await getRig(logger);

    // Handle :key placeholder in URI
    if (uri.includes(":key")) {
      if (!rig.identity) {
        throw new Error(
          ":key placeholder requires an identity. Run: bnd account create",
        );
      }
      uri = replaceKeyPlaceholder(uri, rig.identity.pubkey);
      logger?.info(
        `Replaced :key → ${rig.identity.pubkey.substring(0, 12)}...`,
      );
    }

    // Delegate to the rig based on capabilities
    if (rig.canSign) {
      if (config.encrypt && rig.canEncrypt) {
        // Signed + encrypted envelope
        logger?.info("Sending encrypted envelope (rig.sendEncrypted)");
        const result = await rig.sendEncrypted({
          inputs: [],
          outputs: [[uri, data]],
        });
        console.log(`✓ Send successful (signed + encrypted)`);
        console.log(`  Hash: ${result.uri}`);
        console.log(`  Output: ${uri}`);
        console.log(`  Value: ${JSON.stringify(data)}`);
      } else {
        // Signed envelope
        logger?.info("Sending signed envelope (rig.send)");
        const result = await rig.send({
          inputs: [],
          outputs: [[uri, data]],
        });
        console.log(`✓ Send successful (signed)`);
        console.log(`  Hash: ${result.uri}`);
        console.log(`  Output: ${uri}`);
        console.log(`  Value: ${JSON.stringify(data)}`);
      }
    } else {
      // No identity — raw message for open URIs
      logger?.info("Sending raw message (rig.receive, no identity)");
      const result = await rig.receive([uri, data]);
      if (result.accepted) {
        console.log(`✓ Send successful (unsigned)`);
        console.log(`  URI: ${uri}`);
        console.log(`  Value: ${JSON.stringify(data)}`);
      } else {
        throw new Error(result.error || "Send failed");
      }
    }
  } finally {
    await closeRig(logger);
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
    const rig = await getRig(logger);

    // Handle :key placeholder in URI
    if (uri.includes(":key")) {
      if (!rig.identity) {
        throw new Error(
          ":key placeholder requires an identity. Run: bnd account create",
        );
      }
      uri = replaceKeyPlaceholder(uri, rig.identity.pubkey);
      logger?.info(
        `Replaced :key → ${rig.identity.pubkey.substring(0, 12)}...`,
      );
    }

    const { protocol, domain, path } = parseUri(uri);
    const endpoint = `${config.node}/api/v1/read/${protocol}/${domain}${path}`;
    logger?.http("GET", endpoint);

    const result = await rig.read(uri);

    if (result.success && result.record) {
      console.log(`✓ Read successful`);
      console.log(`  URI: ${uri}`);

      // Always show the raw stored data first
      console.log(
        `  Stored Data: ${JSON.stringify(result.record.data, null, 2)}`,
      );

      // Try to decrypt if encryption key is configured
      const config = await loadConfig();
      if (
        config.encrypt && result.record.data &&
        typeof result.record.data === "object"
      ) {
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
              const privateKey = await pemToCryptoKey(
                encryptionKey.privateKeyPem,
                "X25519",
              );
              const decryptedData = JSON.parse(
                new TextDecoder().decode(
                  await decrypt(encryptedPayload, privateKey),
                ),
              );

              // Show decrypted value separately
              console.log(
                `  Decrypted Payload: ${JSON.stringify(decryptedData)}`,
              );
              logger?.info(`Decrypted payload`);
            } catch (error) {
              logger?.error(
                `Decryption failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
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
    await closeRig(logger);
  }
}

/**
 * Handle `bnd list` command
 */
export async function list(
  uri: string,
  verbose = false,
  options?: { page?: number; limit?: number },
): Promise<void> {
  const logger = createLogger(verbose);

  if (!uri) {
    throw new Error("URI required. Usage: bnd list <uri>");
  }

  try {
    const config = await loadConfig();
    const rig = await getRig(logger);

    // Handle :key placeholder in URI
    if (uri.includes(":key")) {
      if (!rig.identity) {
        throw new Error(
          ":key placeholder requires an identity. Run: bnd account create",
        );
      }
      uri = replaceKeyPlaceholder(uri, rig.identity.pubkey);
      logger?.info(
        `Replaced :key → ${rig.identity.pubkey.substring(0, 12)}...`,
      );
    }

    const { protocol, domain, path } = parseUri(uri);
    const queryStr = new URLSearchParams(options as Record<string, string>)
      .toString();
    const endpoint = `${config.node}/api/v1/list/${protocol}/${domain}${path}${
      queryStr ? `?${queryStr}` : ""
    }`;
    logger?.http("GET", endpoint);

    const result = await rig.list(uri, options);

    if (result.success) {
      console.log(`✓ List successful`);
      console.log(`  URI: ${uri}`);
      console.log(
        `  Total: ${result.pagination.total || result.data.length} items`,
      );
      console.log(
        `  Page: ${result.pagination.page}/${
          Math.ceil(
            (result.pagination.total || 0) / (result.pagination.limit || 50),
          )
        }`,
      );
      console.log("");
      console.log("Items:");
      for (const item of result.data) {
        const itemName = ((item as unknown) as Record<string, unknown>).name ||
          item.uri || "unknown";
        const itemTime =
          ((item as unknown) as Record<string, unknown>).timestamp ||
          ((item as unknown) as Record<string, unknown>).ts || Date.now();
        console.log(
          `  - ${itemName} (${new Date(Number(itemTime)).toISOString()})`,
        );
      }
    } else {
      throw new Error(result.error || "List failed");
    }
  } finally {
    await closeRig(logger);
  }
}

/**
 * Handle `bnd delete` command
 */
export async function del(uri: string, verbose = false): Promise<void> {
  const logger = createLogger(verbose);

  if (!uri) {
    throw new Error("URI required. Usage: bnd delete <uri>");
  }

  try {
    const rig = await getRig(logger);

    // Handle :key placeholder in URI
    if (uri.includes(":key")) {
      if (!rig.identity) {
        throw new Error(
          ":key placeholder requires an identity. Run: bnd account create",
        );
      }
      uri = replaceKeyPlaceholder(uri, rig.identity.pubkey);
      logger?.info(
        `Replaced :key → ${rig.identity.pubkey.substring(0, 12)}...`,
      );
    }

    const { protocol, domain, path } = parseUri(uri);
    const config = await loadConfig();
    const endpoint =
      `${config.node}/api/v1/delete/${protocol}/${domain}${path}`;
    logger?.http("DELETE", endpoint);

    const result = await rig.delete(uri);

    if (result.success) {
      console.log(`✓ Delete successful`);
      console.log(`  URI: ${uri}`);
    } else {
      throw new Error(result.error || "Delete failed");
    }
  } finally {
    await closeRig(logger);
  }
}

/**
 * Handle `bnd health` command
 */
export async function health(verbose = false): Promise<void> {
  const logger = createLogger(verbose);

  try {
    const config = await loadConfig();
    if (!config.node) {
      throw new Error(
        "No node configured. Run: bnd conf node <url>",
      );
    }

    const rig = await getRig(logger);
    const endpoint = `${config.node}/api/v1/health`;
    logger?.http("GET", endpoint);

    const result = await rig.health();

    console.log(`Node: ${config.node}`);
    console.log(`Status: ${result.status}`);
    if (result.message) {
      console.log(`Message: ${result.message}`);
    }
    if (result.details) {
      for (const [key, value] of Object.entries(result.details)) {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      }
    }

    // Also get schema
    try {
      const schema = await rig.getSchema();
      console.log(`Protocols: ${schema.length}`);
      for (const s of schema) {
        console.log(`  - ${s}`);
      }
    } catch {
      // Schema might not be available
    }
  } finally {
    await closeRig(logger);
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
b3nd CLI - Command-line interface for the b3nd rig

USAGE:
  bnd [options] <command> [arguments]

RIG OPERATIONS:
  send <uri> <data>        Send data to a URI (auto-signs when identity is set)
  send -f <filepath>       Send data from a JSON file
  read <uri>               Read data from a URI
  list <uri>               List items at a URI
  watch <uri>              Watch a URI for changes (reactive polling)
  delete <uri>             Delete data at a URI
  health                   Check node health and schema

CONTENT:
  upload <file>            Upload file (content-addressed)
  upload -r <dir>          Upload directory recursively (content-addressed)
  deploy <dir> <target>    Deploy site with content-addressed storage + authenticated links

IDENTITY:
  account create [path]    Generate Ed25519 key pair (PEM format)
  encrypt create [path]    Generate X25519 encryption key pair (PEM format)

CONFIGURATION:
  conf node <url>          Set the node URL
  conf account <path>      Set the account key path
  conf encrypt <path>      Set the encryption key path
  config                   Show current configuration
  server-keys env          Generate server keys and print .env entries

NODE MANAGEMENT:
  node keygen [path]       Generate Ed25519 + X25519 keypairs for a managed node
  node env <keyfile>       Output Phase 2 env vars from a node key file
  node config push <file>  Sign and push node config
  node config get <nodeId> Read current config for a node
  node status <nodeId>     Read node heartbeat status

NETWORK:
  network create <name>    Create a network manifest file
  network up <manifest>    Push configs and start a local network
  network status <id|path> Read all node statuses in a network

OPTIONS:
  -v, --verbose            Show detailed operation logs for debugging
  help                     Show this help message

SETUP:
  bnd account create
  bnd conf node http://localhost:3000

PROTOCOLS:
  hash://sha256/<hash>     Content-addressed immutable storage
  link://accounts/:key/<path>   Authenticated link to another URI
  link://open/<path>            Public link to another URI
  mutable://accounts/:key/...   Mutable authenticated storage
  immutable://accounts/:key/... Immutable authenticated storage

EXAMPLES:
  # Send data (auto-signs with identity)
  bnd send mutable://accounts/:key/profile '{"name":"Alice"}'
  bnd read mutable://accounts/:key/profile

  # Upload a file (content-addressed)
  bnd upload ./image.png

  # Deploy a site (content-addressed + authenticated links)
  bnd deploy ./dist mutable://accounts/:key/mysite

  # Watch a URI for changes
  bnd watch mutable://accounts/:key/profile

DEBUGGING:
  bnd --verbose send mutable://accounts/:key/profile '{"name":"Alice"}'
  bnd -v read hash://sha256/abc123...
  bnd config

DOCUMENTATION:
  https://github.com/bandeira-tech/b3nd-sdk
`);
}

/**
 * Handle `bnd upload` command - upload files to content-addressed storage
 *
 * Usage:
 *   bnd upload <file>       Upload a single file to hash://sha256/<hash>
 *   bnd upload -r <dir>     Upload directory recursively (content-addressed)
 *
 * Returns the hash URI(s) for the uploaded content.
 */
export async function upload(
  args: string[],
  verbose = false,
): Promise<Map<string, string>> {
  const logger = createLogger(verbose);

  // Parse -r flag for recursive upload
  const recursive = args[0] === "-r";
  const pathArg = recursive ? args[1] : args[0];

  if (!pathArg) {
    throw new Error(
      "Usage: bnd upload <file> OR bnd upload -r <dir>",
    );
  }

  // Map of relative path -> hash URI
  const hashMap = new Map<string, string>();

  try {
    const rig = await getRig(logger);

    // Get file info
    const stat = await Deno.stat(pathArg);

    if (stat.isDirectory && !recursive) {
      throw new Error("Directory requires -r flag. Usage: bnd upload -r <dir>");
    }

    if (!stat.isDirectory && recursive) {
      throw new Error("Cannot use -r flag with a file");
    }

    let uploadCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    if (stat.isDirectory) {
      // Recursive directory upload
      console.log(`Uploading directory (content-addressed): ${pathArg}`);
      console.log("");

      for await (const entry of walkDirectory(pathArg)) {
        // Get relative path from base directory
        const relativePath = entry.path.substring(pathArg.length).replace(
          /^\//,
          "",
        );

        try {
          const fileData = await Deno.readFile(entry.path);
          const hash = await computeSha256(fileData);
          const hashUri = `hash://sha256/${hash}`;
          logger?.info(
            `${relativePath} -> ${hashUri} (${fileData.length} bytes)`,
          );

          // Write to content-addressed storage
          const result = await rig.receive([hashUri, fileData]);

          if (result.accepted) {
            hashMap.set(relativePath, hashUri);
            console.log(
              `  ✓ ${relativePath} -> ${hashUri.substring(0, 40)}...`,
            );
            uploadCount++;
          } else if (
            result.error?.includes("exists") ||
            result.error?.includes("immutable")
          ) {
            // Content already exists (deduplication)
            hashMap.set(relativePath, hashUri);
            console.log(
              `  ○ ${relativePath} -> ${hashUri.substring(0, 40)}... [exists]`,
            );
            skippedCount++;
          } else {
            console.log(`  ✗ ${relativePath}: ${result.error}`);
            errorCount++;
          }
        } catch (error) {
          console.log(
            `  ✗ ${relativePath}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          errorCount++;
        }
      }
    } else {
      // Single file upload
      const fileName = pathArg.split("/").pop() || pathArg;

      console.log(`Uploading file (content-addressed): ${pathArg}`);
      console.log("");

      const fileData = await Deno.readFile(pathArg);
      const hash = await computeSha256(fileData);
      const hashUri = `hash://sha256/${hash}`;
      logger?.info(`${fileName} -> ${hashUri} (${fileData.length} bytes)`);

      const result = await rig.receive([hashUri, fileData]);

      if (result.accepted) {
        hashMap.set(fileName, hashUri);
        console.log(`  ✓ ${fileName}`);
        console.log(`  URI: ${hashUri}`);
        uploadCount++;
      } else if (
        result.error?.includes("exists") || result.error?.includes("immutable")
      ) {
        hashMap.set(fileName, hashUri);
        console.log(`  ○ ${fileName} [already exists]`);
        console.log(`  URI: ${hashUri}`);
        skippedCount++;
      } else {
        console.log(`  ✗ ${fileName}: ${result.error}`);
        errorCount++;
      }
    }

    console.log("");
    console.log(
      `Upload complete: ${uploadCount} new, ${skippedCount} deduplicated, ${errorCount} errors`,
    );

    if (errorCount > 0) {
      Deno.exit(1);
    }

    return hashMap;
  } finally {
    await closeRig(logger);
  }
}

/**
 * Walk directory recursively, yielding file entries
 */
async function* walkDirectory(dir: string): AsyncGenerator<{ path: string }> {
  for await (const entry of Deno.readDir(dir)) {
    const fullPath = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      yield* walkDirectory(fullPath);
    } else if (entry.isFile) {
      yield { path: fullPath };
    }
  }
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
    return `-----BEGIN PRIVATE KEY-----\n${
      lines.join("\n")
    }\n-----END PRIVATE KEY-----`;
  }

  async function genEd25519(): Promise<
    { privateKeyPem: string; publicKeyHex: string }
  > {
    const kp = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]) as CryptoKeyPair;
    const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
    const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
    const privateKeyPem = formatPrivateKeyPem(
      bytesToBase64(new Uint8Array(priv)),
    );
    const publicKeyHex = Array.from(new Uint8Array(pub)).map((b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
    return { privateKeyPem, publicKeyHex };
  }

  async function genX25519(): Promise<
    { privateKeyPem: string; publicKeyHex: string }
  > {
    const kp = await crypto.subtle.generateKey(
      { name: "X25519", namedCurve: "X25519" },
      true,
      ["deriveBits"],
    ) as CryptoKeyPair;
    const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
    const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
    const privateKeyPem = formatPrivateKeyPem(
      bytesToBase64(new Uint8Array(priv)),
    );
    const publicKeyHex = Array.from(new Uint8Array(pub)).map((b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
    return { privateKeyPem, publicKeyHex };
  }

  const id = await genEd25519();
  const enc = await genX25519();

  const envText = `# b3nd Server Keys\n# Generated: ${
    new Date().toISOString()
  }\n\nSERVER_IDENTITY_PRIVATE_KEY_PEM="${
    id.privateKeyPem.replace(/\n/g, "\\n")
  }"\nSERVER_IDENTITY_PUBLIC_KEY_HEX="${id.publicKeyHex}"\nSERVER_ENCRYPTION_PRIVATE_KEY_PEM="${
    enc.privateKeyPem.replace(/\n/g, "\\n")
  }"\nSERVER_ENCRYPTION_PUBLIC_KEY_HEX="${enc.publicKeyHex}"\n`;

  console.log(envText);
  try {
    await Deno.writeTextFile(".env.keys", envText);
    console.log(
      "✓ Wrote .env.keys (copy values into your .env and delete the file)",
    );
  } catch (_) {
    // ignore write error
  }
}

/**
 * Handle `bnd watch` command - watch a URI for changes and print updates
 *
 * Usage:
 *   bnd watch <uri>                    Watch with default 2s interval
 *   bnd watch <uri> --interval 5000   Watch with 5s interval
 */
export async function watch(args: string[], verbose = false): Promise<void> {
  const logger = createLogger(verbose);

  // Parse URI and --interval flag
  let uri: string | null = null;
  let intervalMs = 2000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--interval" && args[i + 1]) {
      intervalMs = parseInt(args[i + 1], 10);
      if (isNaN(intervalMs) || intervalMs < 100) {
        throw new Error("Interval must be a number >= 100 (ms)");
      }
      i++; // skip next arg
    } else if (!uri) {
      uri = args[i];
    }
  }

  if (!uri) {
    throw new Error(
      "URI required. Usage: bnd watch <uri> [--interval <ms>]",
    );
  }

  try {
    const { getRig } = await import("./client.ts");
    const rig = await getRig(logger);

    // Handle :key placeholder in URI
    if (uri.includes(":key")) {
      if (!rig.identity) {
        throw new Error(
          ":key placeholder requires an identity. Run: bnd account create",
        );
      }
      uri = replaceKeyPlaceholder(uri, rig.identity.pubkey);
      logger?.info(
        `Replaced :key → ${rig.identity.pubkey.substring(0, 12)}...`,
      );
    }

    console.log(`Watching: ${uri}`);
    console.log(`Interval: ${intervalMs}ms`);
    console.log(`Press Ctrl+C to stop`);
    console.log("");

    const controller = new AbortController();

    // Handle Ctrl+C gracefully
    const onSignal = () => {
      console.log("\n✓ Watch stopped");
      controller.abort();
    };
    Deno.addSignalListener("SIGINT", onSignal);

    try {
      let changeCount = 0;
      for await (
        const value of rig.watch(uri, {
          intervalMs,
          signal: controller.signal,
        })
      ) {
        changeCount++;
        const timestamp = new Date().toISOString();
        console.log(
          `[${timestamp}] Change #${changeCount}:`,
        );
        console.log(`  ${JSON.stringify(value, null, 2)}`);
        console.log("");
      }
    } finally {
      try {
        Deno.removeSignalListener("SIGINT", onSignal);
      } catch {
        // ignore if already removed
      }
    }
  } finally {
    const { closeRig } = await import("./client.ts");
    await closeRig(logger);
  }
}

/**
 * Handle `bnd deploy` command - deploy a directory with content-addressed storage + authenticated links
 *
 * Usage:
 *   bnd deploy <dir> <target>
 *
 * Example:
 *   bnd deploy ./dist mutable://accounts/:key/mysite
 *
 * This command:
 * 1. Uploads all files to content-addressed storage at hash://sha256/<hash>
 * 2. Creates authenticated links at link://accounts/:key/<site>/v<timestamp>/<path>
 * 3. Updates the mutable pointer to point to the new version base
 */
export async function deploy(args: string[], verbose = false): Promise<void> {
  const logger = createLogger(verbose);

  const dirPath = args[0];
  const targetUri = args[1];

  if (!dirPath || !targetUri) {
    throw new Error(
      "Usage: bnd deploy <dir> <target>\n" +
        "Example: bnd deploy ./dist mutable://accounts/:key/mysite",
    );
  }

  // Validate target is mutable://accounts/:key/...
  if (!targetUri.startsWith("mutable://accounts/")) {
    throw new Error(
      "Deploy target must be mutable://accounts/:key/<site>\n" +
        "Example: bnd deploy ./dist mutable://accounts/:key/mysite",
    );
  }

  try {
    const rig = await getRig(logger);

    if (!rig.canSign) {
      throw new Error(
        "Deploy requires an identity for signing. Run: bnd account create",
      );
    }

    // Replace :key placeholder using rig identity
    const resolvedTarget = replaceKeyPlaceholder(
      targetUri,
      rig.identity!.pubkey,
    );
    logger?.info(`Target: ${resolvedTarget}`);

    // Extract site path from target (everything after accounts/:key/)
    const targetMatch = resolvedTarget.match(
      /^mutable:\/\/accounts\/([^/]+)\/(.+)$/,
    );
    if (!targetMatch) {
      throw new Error(
        "Invalid target format. Expected: mutable://accounts/:key/<site>",
      );
    }
    const [, pubkey, sitePath] = targetMatch;

    // Generate version timestamp
    const version = `v${Date.now()}`;
    const versionBase = `link://accounts/${pubkey}/${sitePath}/${version}/`;

    console.log(`Deploying ${dirPath} to ${resolvedTarget}`);
    console.log(`Version: ${version}`);
    console.log("");

    // Verify directory exists
    const stat = await Deno.stat(dirPath);
    if (!stat.isDirectory) {
      throw new Error(`${dirPath} is not a directory`);
    }

    // Phase 1: Upload all files to content-addressed storage
    console.log("Phase 1: Uploading content...");
    const hashMap = new Map<string, string>();
    let hashNewCount = 0;
    let hashExistsCount = 0;

    for await (const entry of walkDirectory(dirPath)) {
      const relativePath = entry.path.substring(dirPath.length).replace(
        /^\//,
        "",
      );

      try {
        const fileData = await Deno.readFile(entry.path);
        const hash = await computeSha256(fileData);
        const hashUri = `hash://sha256/${hash}`;

        const result = await rig.receive([hashUri, fileData]);

        if (result.accepted) {
          hashMap.set(relativePath, hashUri);
          console.log(`  ✓ ${relativePath} [new]`);
          hashNewCount++;
        } else if (
          result.error?.includes("exists") ||
          result.error?.includes("immutable")
        ) {
          // Content already exists - that's fine, it's content-addressed
          hashMap.set(relativePath, hashUri);
          console.log(`  ○ ${relativePath} [dedup]`);
          hashExistsCount++;
        } else {
          throw new Error(result.error || "Write failed");
        }
      } catch (error) {
        console.log(
          `  ✗ ${relativePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      }
    }

    console.log(
      `  Hashes: ${hashNewCount} new, ${hashExistsCount} deduplicated`,
    );
    console.log("");

    // Phase 2: Create authenticated links via rig.send()
    console.log("Phase 2: Sending links...");
    let linkCount = 0;

    for (const [relativePath, hashUri] of hashMap) {
      const linkUri = `${versionBase}${relativePath}`;

      const result = await rig.send({
        inputs: [],
        outputs: [[linkUri, hashUri]],
      });

      if (result.accepted) {
        logger?.info(`  ✓ ${linkUri} -> ${hashUri}`);
        linkCount++;
      } else {
        console.log(`  ✗ ${relativePath}: ${result.error}`);
        throw new Error(`Failed to create link for ${relativePath}`);
      }
    }

    console.log(`  Sent ${linkCount} links at ${versionBase}`);
    console.log("");

    // Phase 3: Update mutable pointer via rig.send()
    console.log("Phase 3: Updating pointer...");

    const pointerResult = await rig.send({
      inputs: [],
      outputs: [[resolvedTarget, versionBase]],
    });

    if (!pointerResult.accepted) {
      throw new Error(`Failed to update pointer: ${pointerResult.error}`);
    }

    console.log(`  ✓ ${resolvedTarget} -> ${versionBase}`);
    console.log("");

    // Summary
    console.log("═".repeat(60));
    console.log("Deploy complete!");
    console.log(`  Files: ${hashMap.size}`);
    console.log(
      `  Hashes: ${hashNewCount} new, ${hashExistsCount} deduplicated`,
    );
    console.log(`  Links: ${linkCount}`);
    console.log(`  Version: ${version}`);
    console.log(`  Pointer: ${resolvedTarget}`);
    console.log("═".repeat(60));
  } finally {
    await closeRig(logger);
  }
}
