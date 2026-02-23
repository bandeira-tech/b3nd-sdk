/**
 * Vault Handler — Non-custodial OAuth identity service.
 *
 * Verifies OAuth ID tokens and returns deterministic HMAC secrets.
 * The vault never sees or stores user keypairs.
 *
 * This is a handler — the portable unit of backend logic.
 * It plugs into any deployment mode via respondTo():
 *
 * - Embedded in a custom node: when(isAuth, respondTo(vaultHandler, { identity, client }))
 * - Connected remotely: connect(node, { prefix, processor: respondTo(vaultHandler, ...) })
 */

import type { HandlerRequest } from "@b3nd/listener";
import { hmac } from "@b3nd/encrypt";

/**
 * Token verifier — pluggable verification for different OAuth providers.
 */
export interface TokenVerifier {
  /** Verify a token and return the stable subject identifier */
  verify(token: string): Promise<{ sub: string; provider: string; email?: string }>;
}

/**
 * Vault auth request — what the client sends inside the encrypted payload.
 */
export interface VaultAuthRequest {
  /** OAuth provider (e.g., "google", "github") */
  provider: string;
  /** The OAuth ID token to verify */
  token: string;
}

/**
 * Vault auth response — what the vault returns encrypted to the client.
 */
export interface VaultAuthResponse {
  /** The deterministic secret for key derivation */
  secret: string;
  /** The provider that was verified */
  provider: string;
}

/**
 * Vault configuration.
 */
export interface VaultConfig {
  /** The HMAC secret — this is the one secret the vault holds */
  nodeSecret: string;
  /** Map of provider names to token verifiers */
  verifiers: Map<string, TokenVerifier>;
}

/**
 * Create a vault handler.
 *
 * The handler is pure: takes a request, returns a response.
 * It doesn't know about transport, encryption, or deployment.
 * Use respondTo() to handle the envelope.
 *
 * @example
 * ```typescript
 * import { respondTo, connect } from "@b3nd/listener";
 *
 * const handler = createVaultHandler({
 *   nodeSecret: Deno.env.get("VAULT_SECRET")!,
 *   verifiers: new Map([["google", googleVerifier]]),
 * });
 *
 * // As a remote listener:
 * const processor = respondTo(handler, { identity, client });
 * const connection = connect(client, { prefix: inboxPrefix, processor });
 * connection.start();
 *
 * // Or embedded in a node:
 * when(isAuthRequest, respondTo(handler, { identity, client: storageClient }))
 * ```
 */
export function createVaultHandler(
  config: VaultConfig,
): (request: HandlerRequest<VaultAuthRequest>) => Promise<VaultAuthResponse> {
  const { nodeSecret, verifiers } = config;

  return async (request: HandlerRequest<VaultAuthRequest>): Promise<VaultAuthResponse> => {
    const { provider, token } = request.data;

    // Find the verifier for this provider
    const verifier = verifiers.get(provider);
    if (!verifier) {
      throw new Error(`Unsupported auth provider: ${provider}`);
    }

    // Verify the token
    const { sub, provider: verifiedProvider } = await verifier.verify(token);

    // Derive deterministic secret: HMAC(nodeSecret, provider:sub)
    const secret = await hmac(nodeSecret, `${verifiedProvider}:${sub}`);

    return {
      secret,
      provider: verifiedProvider,
    };
  };
}

/**
 * Create a mock token verifier for testing.
 * Accepts any token and uses it directly as the sub.
 */
export function mockVerifier(provider: string): TokenVerifier {
  return {
    async verify(token: string) {
      return { sub: token, provider };
    },
  };
}
