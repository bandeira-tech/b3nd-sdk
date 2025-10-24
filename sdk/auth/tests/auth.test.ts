import {
  authValidation,
  createPubkeyBasedAccess,
  createRelativePathAccess,
  createCombinedAccess,
} from "../mod.ts";
import { assertEquals } from "@std/assert";
import { encodeHex, decodeHex } from "@std/encoding/hex";

type TestUser = {
  // Ed25519 compat privateKey:
  privateKey: CryptoKey;
  publicKey: CryptoKey;
};

async function createTestUser(): Promise<TestUser> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "Ed25519",
      namedCurve: "Ed25519",
    },
    true,
    ["sign", "verify"],
  );
  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
  };
}

async function renderPubkey(publicKey: CryptoKey): Promise<string> {
  const exportedKey = await crypto.subtle.exportKey("raw", publicKey);
  return encodeHex(new Uint8Array(exportedKey));
}

async function renderSignature<T>(
  privateKey: CryptoKey,
  payload: T,
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("Ed25519", privateKey, data);
  return encodeHex(new Uint8Array(signature));
}

async function createSignatures<T>(users: TestUser[], payload: T) {
  const signatures = [];
  for (const user of users) {
    signatures.push({
      pubkey: await renderPubkey(user.publicKey),
      signature: await renderSignature<T>(user.privateKey, payload),
    });
  }
  return signatures;
}

async function signTestUser<T>(value: T) {
  const user = await createTestUser();
  const signature = await createSignatures([user], value);
  return signature;
}

Deno.test("pubkey-based access control", async () => {
  const user = await createTestUser();
  const pubkey = await renderPubkey(user.publicKey);

  const payload = { message: "test data" };
  const auth = await createSignatures([user], payload);

  const getWriteAccess = createPubkeyBasedAccess();
  const validation = authValidation(getWriteAccess);

  // Test with correct pubkey as first path component
  const result = await validation({
    uri: `test://users/${pubkey}/documents/doc1`,
    value: { auth, payload },
  });

  assertEquals(result, true);

  // Test with wrong pubkey in path (should fail)
  const wrongResult = await validation({
    uri: "test://users/wrongpubkey/documents/doc1",
    value: { auth, payload },
  });

  assertEquals(wrongResult, false);
});

Deno.test("signature verification", async () => {
  const user = await createTestUser();
  const payload = { message: "test payload", timestamp: Date.now() };

  // Create signature
  const signature = await renderSignature(user.privateKey, payload);
  const pubkey = await renderPubkey(user.publicKey);

  // Verify signature manually
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));
  const signatureBytes = decodeHex(signature);

  const isValid = await crypto.subtle.verify(
    "Ed25519",
    user.publicKey,
    signatureBytes,
    data,
  );

  assertEquals(isValid, true);
  assertEquals(typeof pubkey, "string");
  assertEquals(pubkey.length, 64);
});

Deno.test("multiple users signing", async () => {
  const users = [
    await createTestUser(),
    await createTestUser(),
    await createTestUser(),
  ];

  const payload = "multi-user test";
  const signatures = await createSignatures(users, payload);

  assertEquals(signatures.length, 3);

  // Verify each signature is unique
  const pubkeys = signatures.map((s) => s.pubkey);
  const uniquePubkeys = new Set(pubkeys);
  assertEquals(uniquePubkeys.size, 3);

  // Verify all signatures are valid format
  for (const sig of signatures) {
    assertEquals(typeof sig.pubkey, "string");
    assertEquals(typeof sig.signature, "string");
    assertEquals(sig.pubkey.length, 64);
    assertEquals(sig.signature.length, 128);
  }
});

Deno.test("relative path access control", async () => {
  const storage: Record<string, any> = {};
  const read = (url: string) => Promise.resolve(storage[url]);

  const alice = await createTestUser();
  const bob = await createTestUser();
  const charlie = await createTestUser();

  const alicePubkey = await renderPubkey(alice.publicKey);
  const bobPubkey = await renderPubkey(bob.publicKey);
  const charliePubkey = await renderPubkey(charlie.publicKey);

  // Setup access control files
  storage["test://project/shared/.access/"] = {
    writeAccess: [alicePubkey, bobPubkey],
  };

  storage["test://project/shared/documents/~>"] = {
    writeAccess: [charliePubkey],
  };

  const getWriteAccess = createRelativePathAccess(read);
  const validation = authValidation(getWriteAccess);

  // Test Alice has access via .access/ file
  const payload1 = { action: "edit", content: "Alice's edit" };
  const auth1 = await createSignatures([alice], payload1);

  const result1 = await validation({
    uri: "test://project/shared/file.txt",
    value: { auth: auth1, payload: payload1 },
  });
  assertEquals(result1, true);

  // Test Charlie has access via ./~> file
  const payload2 = { action: "edit", content: "Charlie's edit" };
  const auth2 = await createSignatures([charlie], payload2);

  const result2 = await validation({
    uri: "test://project/shared/documents/doc.txt",
    value: { auth: auth2, payload: payload2 },
  });
  assertEquals(result2, true);

  // Test unauthorized user
  const unauthorizedUser = await createTestUser();
  const payload3 = { action: "edit", content: "Unauthorized edit" };
  const auth3 = await createSignatures([unauthorizedUser], payload3);

  const result3 = await validation({
    uri: "test://project/shared/file.txt",
    value: { auth: auth3, payload: payload3 },
  });
  assertEquals(result3, false);
});

Deno.test("cascading access control", async () => {
  const storage: Record<string, any> = {};
  const read = (url: string) => Promise.resolve(storage[url]);

  const admin = await createTestUser();
  const user = await createTestUser();

  const adminPubkey = await renderPubkey(admin.publicKey);
  const userPubkey = await renderPubkey(user.publicKey);

  // Setup cascading access: admin has access at root level
  storage["test://project/.access/"] = {
    writeAccess: [adminPubkey],
  };

  // User has access at deeper level
  storage["test://project/user-area/.access/"] = {
    writeAccess: [userPubkey],
  };

  const getWriteAccess = createRelativePathAccess(read);
  const validation = authValidation(getWriteAccess);

  // Test admin can write anywhere (cascading from root)
  const payload1 = { action: "admin_action" };
  const auth1 = await createSignatures([admin], payload1);

  const result1 = await validation({
    uri: "test://project/user-area/deep/nested/file.txt",
    value: { auth: auth1, payload: payload1 },
  });
  assertEquals(result1, true);

  // Test user can write in their area
  const payload2 = { action: "user_action" };
  const auth2 = await createSignatures([user], payload2);

  const result2 = await validation({
    uri: "test://project/user-area/file.txt",
    value: { auth: auth2, payload: payload2 },
  });
  assertEquals(result2, true);

  // Test user cannot write outside their area
  const result3 = await validation({
    uri: "test://project/admin-only/file.txt",
    value: { auth: auth2, payload: payload2 },
  });
  assertEquals(result3, false);
});

Deno.test("combined access control", async () => {
  const storage: Record<string, any> = {};
  const read = (url: string) => Promise.resolve(storage[url]);

  const owner = await createTestUser();
  const collaborator = await createTestUser();

  const ownerPubkey = await renderPubkey(owner.publicKey);
  const collaboratorPubkey = await renderPubkey(collaborator.publicKey);

  // Setup access control files
  storage[`test://users/${ownerPubkey}/shared/.access/`] = {
    writeAccess: [collaboratorPubkey],
  };

  const getWriteAccess = createCombinedAccess(read);
  const validation = authValidation(getWriteAccess);

  // Test owner has access via pubkey-based control
  const payload1 = { action: "owner_edit" };
  const auth1 = await createSignatures([owner], payload1);

  const result1 = await validation({
    uri: `test://users/${ownerPubkey}/private/file.txt`,
    value: { auth: auth1, payload: payload1 },
  });
  assertEquals(result1, true);

  // Test collaborator has access via relative path control
  const payload2 = { action: "collab_edit" };
  const auth2 = await createSignatures([collaborator], payload2);

  const result2 = await validation({
    uri: `test://users/${ownerPubkey}/shared/document.txt`,
    value: { auth: auth2, payload: payload2 },
  });
  assertEquals(result2, true);

  // Test collaborator cannot access private area
  const result3 = await validation({
    uri: `test://users/${ownerPubkey}/private/file.txt`,
    value: { auth: auth2, payload: payload2 },
  });
  assertEquals(result3, false);
});

Deno.test("multiple path cascading", async () => {
  const storage: Record<string, any> = {};
  const read = (url: string) => Promise.resolve(storage[url]);

  const admin = await createTestUser();
  const projectLead = await createTestUser();
  const developer = await createTestUser();

  const adminPubkey = await renderPubkey(admin.publicKey);
  const projectLeadPubkey = await renderPubkey(projectLead.publicKey);
  const developerPubkey = await renderPubkey(developer.publicKey);

  // Setup cascading permissions
  storage["test://company/.access/"] = {
    writeAccess: [adminPubkey],
  };

  storage["test://company/projects/.access/"] = {
    writeAccess: [projectLeadPubkey],
  };

  storage["test://company/projects/web-app/.access/"] = {
    writeAccess: [developerPubkey],
  };

  const getWriteAccess = createRelativePathAccess(read);
  const validation = authValidation(getWriteAccess);

  // Test deep path gets all cascading permissions
  const payload = { action: "deep_edit" };

  // Admin should have access (from root)
  const adminAuth = await createSignatures([admin], payload);
  const adminResult = await validation({
    uri: "test://company/projects/web-app/src/components/Button.tsx",
    value: { auth: adminAuth, payload },
  });
  assertEquals(adminResult, true);

  // Project lead should have access (from projects level)
  const leadAuth = await createSignatures([projectLead], payload);
  const leadResult = await validation({
    uri: "test://company/projects/web-app/src/components/Button.tsx",
    value: { auth: leadAuth, payload },
  });
  assertEquals(leadResult, true);

  // Developer should have access (from web-app level)
  const devAuth = await createSignatures([developer], payload);
  const devResult = await validation({
    uri: "test://company/projects/web-app/src/components/Button.tsx",
    value: { auth: devAuth, payload },
  });
  assertEquals(devResult, true);

  // Unauthorized user should not have access
  const unauthorized = await createTestUser();
  const unauthorizedAuth = await createSignatures([unauthorized], payload);
  const unauthorizedResult = await validation({
    uri: "test://company/projects/web-app/src/components/Button.tsx",
    value: { auth: unauthorizedAuth, payload },
  });
  assertEquals(unauthorizedResult, false);
});

Deno.test("comprehensive cascading demonstration", async () => {
  const storage: Record<string, any> = {};
  const read = (url: string) => Promise.resolve(storage[url]);

  // Create test users
  const rootAdmin = await createTestUser();
  const projectManager = await createTestUser();
  const developer = await createTestUser();
  const guest = await createTestUser();

  const rootAdminPubkey = await renderPubkey(rootAdmin.publicKey);
  const projectManagerPubkey = await renderPubkey(projectManager.publicKey);
  const developerPubkey = await renderPubkey(developer.publicKey);
  const guestPubkey = await renderPubkey(guest.publicKey);

  // Setup cascading access control as described:
  // /foo/bar/baz/bea should check:
  // - /foo/bar/baz/bea
  // - /foo/bar/baz
  // - /foo/bar
  // - /foo

  // Root level access
  storage["test://company/foo/.access/"] = {
    writeAccess: [rootAdminPubkey],
  };

  // Second level access
  storage["test://company/foo/bar/.access/"] = {
    writeAccess: [projectManagerPubkey],
  };

  // Third level access
  storage["test://company/foo/bar/baz/.access/"] = {
    writeAccess: [developerPubkey],
  };

  const getWriteAccess = createRelativePathAccess(read);
  const validation = authValidation(getWriteAccess);

  const testPayload = { action: "write", content: "test content" };
  const deepPath = "test://company/foo/bar/baz/bea";

  // Test 1: Root admin can write anywhere (access from /foo)
  const rootAuth = await createSignatures([rootAdmin], testPayload);
  const rootResult = await validation({
    uri: deepPath,
    value: { auth: rootAuth, payload: testPayload },
  });
  assertEquals(rootResult, true);

  // Test 2: Project manager can write in their scope (access from /foo/bar)
  const managerAuth = await createSignatures([projectManager], testPayload);
  const managerResult = await validation({
    uri: deepPath,
    value: { auth: managerAuth, payload: testPayload },
  });
  assertEquals(managerResult, true);

  // Test 3: Developer can write in their scope (access from /foo/bar/baz)
  const devAuth = await createSignatures([developer], testPayload);
  const devResult = await validation({
    uri: deepPath,
    value: { auth: devAuth, payload: testPayload },
  });
  assertEquals(devResult, true);

  // Test 4: Guest cannot write (no access at any level)
  const guestAuth = await createSignatures([guest], testPayload);
  const guestResult = await validation({
    uri: deepPath,
    value: { auth: guestAuth, payload: testPayload },
  });
  assertEquals(guestResult, false);

  // Test 5: Multiple signatures from different levels should work
  const multiAuth = await createSignatures([rootAdmin, developer], testPayload);
  const multiResult = await validation({
    uri: deepPath,
    value: { auth: multiAuth, payload: testPayload },
  });
  assertEquals(multiResult, true);

  // Test 6: Verify cascading works at different depths
  const midPath = "test://company/foo/bar/other";
  const midResult = await validation({
    uri: midPath,
    value: { auth: rootAuth, payload: testPayload },
  });
  assertEquals(midResult, true);

  // Test 7: Developer cannot write above their level
  const abovePath = "test://company/foo/restricted";
  const restrictedResult = await validation({
    uri: abovePath,
    value: { auth: devAuth, payload: testPayload },
  });
  assertEquals(restrictedResult, false);
});

Deno.test("pubkey namespace protection", async () => {
  const storage: Record<string, any> = {};
  const read = (url: string) => Promise.resolve(storage[url]);

  const alice = await createTestUser();
  const bob = await createTestUser();
  const malicious = await createTestUser();

  const alicePubkey = await renderPubkey(alice.publicKey);
  const bobPubkey = await renderPubkey(bob.publicKey);
  const maliciousPubkey = await renderPubkey(malicious.publicKey);

  // Alice gives Bob permission to write in her shared folder
  storage[`test://users/${alicePubkey}/shared/.access/`] = {
    writeAccess: [bobPubkey],
  };

  const getWriteAccess = createCombinedAccess(read);
  const validation = authValidation(getWriteAccess);

  const testPayload = { message: "test write" };

  // Test 1: Alice can write in her own namespace (implicit access)
  const aliceAuth = await createSignatures([alice], testPayload);
  const aliceResult = await validation({
    uri: `test://users/${alicePubkey}/private/document.txt`,
    value: { auth: aliceAuth, payload: testPayload },
  });
  assertEquals(aliceResult, true);

  // Test 2: Bob can write in Alice's shared folder (explicit permission)
  const bobAuth = await createSignatures([bob], testPayload);
  const bobSharedResult = await validation({
    uri: `test://users/${alicePubkey}/shared/collaboration.txt`,
    value: { auth: bobAuth, payload: testPayload },
  });
  assertEquals(bobSharedResult, true);

  // Test 3: Bob cannot write in Alice's private area (no permission)
  const bobPrivateResult = await validation({
    uri: `test://users/${alicePubkey}/private/document.txt`,
    value: { auth: bobAuth, payload: testPayload },
  });
  assertEquals(bobPrivateResult, false);

  // Test 4: Malicious user cannot write anywhere in Alice's namespace
  const maliciousAuth = await createSignatures([malicious], testPayload);
  const maliciousResult = await validation({
    uri: `test://users/${alicePubkey}/anything/file.txt`,
    value: { auth: maliciousAuth, payload: testPayload },
  });
  assertEquals(maliciousResult, false);

  // Test 5: Users cannot write in each other's root namespace without permission
  const crossNamespaceResult = await validation({
    uri: `test://users/${bobPubkey}/files/document.txt`,
    value: { auth: aliceAuth, payload: testPayload },
  });
  assertEquals(crossNamespaceResult, false);

  // Test 6: Bob can write in his own namespace
  const bobOwnResult = await validation({
    uri: `test://users/${bobPubkey}/files/document.txt`,
    value: { auth: bobAuth, payload: testPayload },
  });
  assertEquals(bobOwnResult, true);
});

Deno.test("comprehensive feature demonstration", async () => {
  /**
   * This test demonstrates the complete signature workflow with cascading access control:
   *
   * 1. Pubkey-based namespace protection:
   *    - First path component must be a pubkey that owns that namespace
   *
   * 2. Relative path access control:
   *    - Check for ./~> and ./.access/ files containing { writeAccess: [pubkeys...] }
   *
   * 3. Cascading access:
   *    - For path /foo/bar/baz/bea, check access at:
   *      - /foo/bar/baz/bea, /foo/bar/baz, /foo/bar, /foo
   *    - Higher level access grants downstream access
   *
   * 4. Combined access model:
   *    - Pubkey-based + relative path access work together
   *    - Creates unique, flattened list of authorized pubkeys
   */

  const storage: Record<string, any> = {};
  const read = (url: string) => Promise.resolve(storage[url]);

  // Create a complex organizational structure
  const ceo = await createTestUser();
  const cto = await createTestUser();
  const teamLead = await createTestUser();
  const developer = await createTestUser();
  const intern = await createTestUser();

  const ceoPubkey = await renderPubkey(ceo.publicKey);
  const ctoPubkey = await renderPubkey(cto.publicKey);
  const teamLeadPubkey = await renderPubkey(teamLead.publicKey);
  const developerPubkey = await renderPubkey(developer.publicKey);
  const internPubkey = await renderPubkey(intern.publicKey);

  // Setup organizational access hierarchy
  // CEO has company-wide access
  storage[`test://company/${ceoPubkey}/organization/.access/`] = {
    writeAccess: [ctoPubkey], // CTO can access CEO's org area
  };

  // CTO has technology division access
  storage[`test://company/${ceoPubkey}/organization/tech/.access/`] = {
    writeAccess: [teamLeadPubkey],
  };

  // Team lead has project access
  storage[`test://company/${ceoPubkey}/organization/tech/projects/.access/`] = {
    writeAccess: [developerPubkey],
  };

  // Developer shares some work with intern
  storage[
    `test://company/${ceoPubkey}/organization/tech/projects/app/shared/~>`
  ] = {
    writeAccess: [internPubkey],
  };

  const getWriteAccess = createCombinedAccess(read);
  const validation = authValidation(getWriteAccess);

  const testPayload = { action: "code_review", content: "Approved" };

  // Test cascading access from different levels
  const deepPath = `test://company/${ceoPubkey}/organization/tech/projects/app/src/main.ts`;

  // CEO can write anywhere in their namespace (pubkey-based access)
  const ceoAuth = await createSignatures([ceo], testPayload);
  const ceoResult = await validation({
    uri: deepPath,
    value: { auth: ceoAuth, payload: testPayload },
  });
  assertEquals(
    ceoResult,
    true,
    "CEO should have access to entire company namespace",
  );

  // CTO can write in tech division (cascading from /organization/)
  const ctoAuth = await createSignatures([cto], testPayload);
  const ctoResult = await validation({
    uri: deepPath,
    value: { auth: ctoAuth, payload: testPayload },
  });
  assertEquals(
    ctoResult,
    true,
    "CTO should have cascading access from organization level",
  );

  // Team lead can write in projects (cascading from /tech/)
  const teamLeadAuth = await createSignatures([teamLead], testPayload);
  const teamLeadResult = await validation({
    uri: deepPath,
    value: { auth: teamLeadAuth, payload: testPayload },
  });
  assertEquals(
    teamLeadResult,
    true,
    "Team lead should have cascading access from tech level",
  );

  // Developer can write in app project (cascading from /projects/)
  const developerAuth = await createSignatures([developer], testPayload);
  const developerResult = await validation({
    uri: deepPath,
    value: { auth: developerAuth, payload: testPayload },
  });
  assertEquals(
    developerResult,
    true,
    "Developer should have cascading access from projects level",
  );

  // Intern can only write in shared area
  const internAuth = await createSignatures([intern], testPayload);
  const internMainResult = await validation({
    uri: deepPath,
    value: { auth: internAuth, payload: testPayload },
  });
  assertEquals(
    internMainResult,
    false,
    "Intern should not have access to main source files",
  );

  // But intern can write in shared area
  const sharedPath = `test://company/${ceoPubkey}/organization/tech/projects/app/shared/notes.md`;
  const internSharedResult = await validation({
    uri: sharedPath,
    value: { auth: internAuth, payload: testPayload },
  });
  assertEquals(
    internSharedResult,
    true,
    "Intern should have access to shared area",
  );

  // Test namespace protection - CTO cannot write in other CEO namespaces
  const otherCeo = await createTestUser();
  const otherCeoPubkey = await renderPubkey(otherCeo.publicKey);

  const crossNamespaceResult = await validation({
    uri: `test://company/${otherCeoPubkey}/private/secrets.txt`,
    value: { auth: ctoAuth, payload: testPayload },
  });
  assertEquals(
    crossNamespaceResult,
    false,
    "CTO should not access other CEO namespaces",
  );

  // Test multiple signatures (collaborative work)
  const multiAuth = await createSignatures([teamLead, developer], testPayload);
  const multiResult = await validation({
    uri: deepPath,
    value: { auth: multiAuth, payload: testPayload },
  });
  assertEquals(multiResult, true, "Multiple authorized signatures should work");

  // Test that signature tampering fails
  const tamperPayload = { action: "malicious_change", content: "Hacked!" };
  const tamperResult = await validation({
    uri: deepPath,
    value: { auth: developerAuth, payload: tamperPayload }, // signed for different payload
  });
  assertEquals(tamperResult, false, "Tampered payload should fail validation");
});
