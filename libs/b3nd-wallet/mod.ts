// Wallet service has been removed. All exports throw at runtime so the UI
// surfaces an error rather than crashing silently.

export type SessionKeypair = {
  publicKeyHex: string;
  privateKeyHex: string;
};

const gone = (fn: string): never => {
  throw new Error(`${fn}: wallet service has been removed`);
};

export const generateSessionKeypair = (): Promise<SessionKeypair> =>
  Promise.resolve(gone("generateSessionKeypair"));

export class WalletClient {
  constructor(_url: string) {}
  signup(..._args: unknown[]): never { return gone("WalletClient.signup"); }
  login(..._args: unknown[]): never { return gone("WalletClient.login"); }
  setSession(..._args: unknown[]): never { return gone("WalletClient.setSession"); }
  getPublicKeys(..._args: unknown[]): never { return gone("WalletClient.getPublicKeys"); }
  proxyWrite(..._args: unknown[]): never { return gone("WalletClient.proxyWrite"); }
}
