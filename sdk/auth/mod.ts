import { decodeHex } from "../shared/encoding.ts";

type AuthMessage<T> = {
  auth: { pubkey: string; signature: string }[];
  payload: T;
};

type AuthenticatedWrite<T> = {
  uri: string;
  value: AuthMessage<T>;
};

type GetWriteAccessFn = (url: string) => Promise<string[]>;

type AuthenticationValidationFn<T> = (
  write: AuthenticatedWrite<T>,
) => Promise<boolean>;

async function verifySignature<T>(
  pubkeyHex: string,
  signatureHex: string,
  payload: T,
): Promise<boolean> {
  try {
    const pubkeyBytes = decodeHex(pubkeyHex);
    const publicKey = await crypto.subtle.importKey(
      "raw",
      pubkeyBytes,
      {
        name: "Ed25519",
        namedCurve: "Ed25519",
      },
      false,
      ["verify"],
    );

    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(payload));

    const signatureBytes = decodeHex(signatureHex);

    return await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      signatureBytes,
      data,
    );
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

function buildCascadingPaths(url: string): string[] {
  const parsed = new URL(url);
  const pathParts = parsed.pathname
    .split("/")
    .filter((part) => part.length > 0);
  const paths: string[] = [];
  for (let i = pathParts.length; i > 0; i--) {
    const pathSlice = pathParts.slice(0, i);
    const cascadingPath = `${parsed.protocol}//${parsed.host}/${
      pathSlice.join("/")
    }`;
    paths.push(cascadingPath);
  }

  return paths;
}

async function validateAuthMessage<T>(
  write: AuthenticatedWrite<T>,
  getWriteAccess: GetWriteAccessFn,
): Promise<boolean> {
  const cascadingPaths = buildCascadingPaths(write.uri);

  const authorizedPubkeysArrays = await Promise.all(
    cascadingPaths.map((path) => getWriteAccess(path)),
  );

  const authorizedPubkeys = new Set(authorizedPubkeysArrays.flat());

  // Validate that at least one signature is from an authorized pubkey
  for (const auth of write.value.auth) {
    if (!authorizedPubkeys.has(auth.pubkey)) {
      continue;
    }

    const isValidSignature = await verifySignature(
      auth.pubkey,
      auth.signature,
      write.value.payload,
    );

    if (isValidSignature) {
      return true; // Found valid signature from authorized pubkey
    }
  }

  return false; // No valid signatures from authorized pubkeys
}

export function authValidation<T>(
  getWriteAccess: GetWriteAccessFn,
): AuthenticationValidationFn<T> {
  return (write) => validateAuthMessage<T>(write, getWriteAccess);
}

// Pubkey-based access control implementation
export function createPubkeyBasedAccess(): GetWriteAccessFn {
  return async (url: string): Promise<string[]> => {
    const parsed = new URL(url);
    const pathParts = parsed.pathname
      .split("/")
      .filter((part) => part.length > 0);

    // First part of path should be a pubkey that has implicit access
    if (pathParts.length > 0) {
      const ownerPubkey = pathParts[0];
      return [ownerPubkey];
    }

    return [];
  };
}

// Relative path access control implementation
export function createRelativePathAccess(
  read: (url: string) => Promise<any>,
  relativePaths: string[] = ["./~>", "./.access/"],
): GetWriteAccessFn {
  return async (url: string): Promise<string[]> => {
    const authorizedPubkeys: string[] = [];

    for (const relativePath of relativePaths) {
      try {
        // For relative paths, we need to handle them properly
        let accessUrl: string;
        if (relativePath.startsWith("./")) {
          // Remove ./ and append to the directory path
          const dirPath = url.split("/").slice(0, -1).join("/");
          accessUrl = dirPath + "/" + relativePath.substring(2);
        } else {
          // Direct append
          const baseUrl = url.endsWith("/") ? url : url + "/";
          accessUrl = baseUrl + relativePath;
        }

        const accessData = await read(accessUrl);

        if (
          accessData &&
          accessData.writeAccess &&
          Array.isArray(accessData.writeAccess)
        ) {
          authorizedPubkeys.push(...accessData.writeAccess);
        }
      } catch (error) {
        // Ignore errors when access files don't exist
        continue;
      }
    }

    return authorizedPubkeys;
  };
}

// Combined access control implementation
export function createCombinedAccess(
  read: (url: string) => Promise<any>,
  relativePaths: string[] = ["./~>", "./.access/"],
): GetWriteAccessFn {
  const pubkeyAccess = createPubkeyBasedAccess();
  const relativeAccess = createRelativePathAccess(read, relativePaths);

  return async (url: string): Promise<string[]> => {
    const [pubkeyPubkeys, relativePubkeys] = await Promise.all([
      pubkeyAccess(url),
      relativeAccess(url),
    ]);

    // Combine and deduplicate
    return [...new Set([...pubkeyPubkeys, ...relativePubkeys])];
  };
}
