import { decodeHex } from "@std/encoding/hex";

interface ServerKeys {
  identityKey: {
    privateKeyPem: string;
    publicKeyHex: string;
  };
  encryptionKey: {
    privateKeyPem: string;
    publicKeyHex: string;
  };
}

export function loadServerKeys(): ServerKeys {
  const unwrapEnvValue = (value: string) => {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  };

  const identityPrivateKeyPemRaw = Deno.env.get(
    "SERVER_IDENTITY_PRIVATE_KEY_PEM",
  );
  const identityPublicKeyHexRaw = Deno.env.get(
    "SERVER_IDENTITY_PUBLIC_KEY_HEX",
  );
  const encryptionPrivateKeyPemRaw = Deno.env.get(
    "SERVER_ENCRYPTION_PRIVATE_KEY_PEM",
  );
  const encryptionPublicKeyHexRaw = Deno.env.get(
    "SERVER_ENCRYPTION_PUBLIC_KEY_HEX",
  );

  if (!identityPrivateKeyPemRaw) {
    throw new Error(
      "SERVER_IDENTITY_PRIVATE_KEY_PEM environment variable is required",
    );
  }

  if (!identityPublicKeyHexRaw) {
    throw new Error(
      "SERVER_IDENTITY_PUBLIC_KEY_HEX environment variable is required",
    );
  }

  if (!encryptionPrivateKeyPemRaw) {
    throw new Error(
      "SERVER_ENCRYPTION_PRIVATE_KEY_PEM environment variable is required",
    );
  }

  if (!encryptionPublicKeyHexRaw) {
    throw new Error(
      "SERVER_ENCRYPTION_PUBLIC_KEY_HEX environment variable is required",
    );
  }

  const identityPrivateKeyPem = unwrapEnvValue(identityPrivateKeyPemRaw);
  const identityPublicKeyHex = unwrapEnvValue(identityPublicKeyHexRaw);
  const encryptionPrivateKeyPem = unwrapEnvValue(encryptionPrivateKeyPemRaw);
  const encryptionPublicKeyHex = unwrapEnvValue(encryptionPublicKeyHexRaw);

  if (identityPublicKeyHex.length !== 64) {
    throw new Error(
      `SERVER_IDENTITY_PUBLIC_KEY_HEX must be exactly 64 hex characters (32 bytes), got ${identityPublicKeyHex.length}.`,
    );
  }
  if (encryptionPublicKeyHex.length !== 64) {
    throw new Error(
      `SERVER_ENCRYPTION_PUBLIC_KEY_HEX must be exactly 64 hex characters (32 bytes), got ${encryptionPublicKeyHex.length}.`,
    );
  }

  try {
    decodeHex(identityPublicKeyHex);
  } catch {
    throw new Error("SERVER_IDENTITY_PUBLIC_KEY_HEX is not valid hex");
  }

  try {
    decodeHex(encryptionPublicKeyHex);
  } catch {
    throw new Error("SERVER_ENCRYPTION_PUBLIC_KEY_HEX is not valid hex");
  }

  if (
    !identityPrivateKeyPem.includes("-----BEGIN") ||
    !identityPrivateKeyPem.includes("-----END")
  ) {
    throw new Error("SERVER_IDENTITY_PRIVATE_KEY_PEM is not valid PEM format");
  }

  if (
    !encryptionPrivateKeyPem.includes("-----BEGIN") ||
    !encryptionPrivateKeyPem.includes("-----END")
  ) {
    throw new Error(
      "SERVER_ENCRYPTION_PRIVATE_KEY_PEM is not valid PEM format",
    );
  }

  console.log("✅ Server keys validated:");
  console.log(`   Identity: ${identityPublicKeyHex.substring(0, 16)}...`);
  console.log(`   Encryption: ${encryptionPublicKeyHex.substring(0, 16)}...`);

  return {
    identityKey: {
      privateKeyPem: identityPrivateKeyPem,
      publicKeyHex: identityPublicKeyHex,
    },
    encryptionKey: {
      privateKeyPem: encryptionPrivateKeyPem,
      publicKeyHex: encryptionPublicKeyHex,
    },
  };
}
