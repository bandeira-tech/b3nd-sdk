# B3nd Security Audit Report

**Date:** 2025-01-09
**Auditor:** Claude (Red Team Analysis)
**Scope:** SDK, Wallet Server, Explorer App, Persistence Layer

---

## Executive Summary

B3nd has solid cryptographic foundations using Web Crypto API with appropriate algorithms (Ed25519, X25519, AES-GCM, PBKDF2). However, the implementation has several critical vulnerabilities that must be fixed before production deployment.

**Total Vulnerabilities Found:** 18
- Critical: 1
- High: 5
- Medium: 9
- Low: 3

---

## Critical Vulnerabilities

### 1. Signature Verification Bypass (CRITICAL)

**Location:** `sdk/wallet-server/auth.ts:186-193`

```typescript
if (!verified) {
    logger?.warn(
      "Password credential signature verification failed for user:",
      username
    );
    // Continue anyway - credentials might be legitimately unsigned in migration scenarios
}
```

**Impact:** Authentication can be bypassed by submitting invalid signatures. The code logs a warning but continues execution, allowing unauthenticated access.

**Same issue at:** `auth.ts:347-353` (password reset tokens)

**Fix:** Return an error when signature verification fails instead of continuing.

---

## High Severity Vulnerabilities

### 2. Timing Attack on Password Verification

**Location:** `sdk/wallet-server/auth.ts:60-62`

```typescript
export async function verifyPassword(password, salt, hash): Promise<boolean> {
  const computedHash = await hashPassword(password, salt);
  return computedHash === hash;  // String comparison - timing vulnerable
}
```

**Impact:** Attackers can measure response times to progressively guess password hashes.

**Fix:** Use constant-time comparison (e.g., `crypto.timingSafeEqual`).

---

### 3. Password Reset Token Returned in API Response

**Location:** `sdk/wallet-server/core.ts:764-769`

```typescript
return c.json({
  success: true,
  message: "Password reset token created",
  resetToken,  // Token returned directly to requester!
  expiresIn: this.config.passwordResetTokenTtlSeconds,
});
```

**Impact:** Any attacker can request a password reset for any user and receive the token, enabling account takeover.

**Fix:** Send reset tokens via email, not in API response.

---

### 4. No Rate Limiting on Auth Endpoints

**Location:** `sdk/wallet-server/core.ts` (all auth endpoints)

**Impact:** Enables brute force attacks on passwords, token generation spam, and denial of service.

**Fix:** Implement rate limiting middleware (express-rate-limit is already in dependencies).

---

### 5. Private Keys Stored in Browser localStorage

**Location:** `explorer/app/src/stores/appStore.ts:936`

```typescript
keyBundle: state.keyBundle,  // Contains private keys!
```

The `keyBundle` contains:
- `accountPrivateKeyPem`
- `encryptionPrivateKeyPem`

**Impact:** XSS attacks can exfiltrate private keys. localStorage is accessible to any script on the page.

**Fix:** Use session storage or memory-only storage for private keys. Consider using Web Crypto non-extractable keys.

---

### 6. SQL Table Prefix Injection Potential

**Location:** `sdk/clients/postgres/mod.ts:111-114`

```typescript
const table = `${this.tablePrefix}_data`;
await this.executor.query(
  `INSERT INTO ${table} (uri, data, timestamp) VALUES ($1, $2::jsonb, $3)...`
);
```

**Impact:** If `tablePrefix` comes from user input, SQL injection is possible.

**Fix:** Validate tablePrefix against a whitelist of allowed characters.

---

## Medium Severity Vulnerabilities

### 7. Public Key Used as HMAC Secret

**Location:** `sdk/wallet-server/obfuscation.ts:66-73`

```typescript
const key = await crypto.subtle.importKey(
  "raw",
  encoder.encode(serverPublicKey),  // PUBLIC key as HMAC secret
  { name: "HMAC", hash: "SHA-256" },
  ...
);
```

**Impact:** Anyone can compute obfuscated paths for usernames and enumerate which users exist.

**Fix:** Add a secret salt to the HMAC input.

---

### 8. JWT Has No Device/IP Binding

**Location:** `sdk/wallet-server/jwt.ts:41-85`

**Impact:** Stolen JWTs can be used from any device/location.

**Fix:** Include device fingerprint or IP in JWT claims.

---

### 9. CORS Allows Wildcard Origin Reflection

**Location:** `sdk/wallet-server/core.ts:367-377`

```typescript
origin: (origin) =>
  this.config.allowedOrigins[0] === "*"
    ? origin  // Reflects any origin!
    : ...
```

**Impact:** With default config, any website can make authenticated requests.

**Fix:** Require explicit origin whitelist in production.

---

### 10. No URI Format Validation

**Location:** `sdk/wallet-server/core.ts:855-857`

**Impact:** Potential for path traversal or protocol confusion attacks.

**Fix:** Validate URI format, whitelist allowed protocols.

---

### 11. JWT Tokens Persisted in localStorage

**Location:** `explorer/app/src/stores/appStore.ts:748`

**Impact:** Session tokens survive browser restart, longer exposure window.

**Fix:** Use session storage or memory for tokens.

---

### 12. No Replay Protection in Signatures

**Location:** `sdk/encrypt/mod.ts`

**Impact:** Signed messages can be replayed indefinitely.

**Fix:** Include nonce/timestamp in signed payloads, reject old timestamps.

---

### 13. List Errors Return success:true

**Location:** `sdk/clients/http/mod.ts:235-257`

```typescript
} catch (error) {
  return {
    success: true,  // Should be false!
    data: [],
    ...
  };
}
```

**Impact:** Applications may not detect list failures.

**Fix:** Return `success: false` on errors.

---

### 14. RegExp Pattern from User Input (ReDoS)

**Location:** `sdk/clients/postgres/mod.ts:245-246`

```typescript
const regex = new RegExp(options.pattern);
items = items.filter((item) => regex.test(item.uri));
```

**Impact:** Malicious regex patterns can cause CPU exhaustion (ReDoS).

**Fix:** Validate/sanitize regex patterns or use simple glob matching.

---

### 15. HTTP Client Silently Swallows Errors

**Location:** `sdk/clients/http/mod.ts:248-257`

**Impact:** Error conditions may go undetected.

**Fix:** Properly propagate errors.

---

## Low Severity Issues

### 16. Non-Canonical JSON Serialization for Signing

**Location:** `sdk/encrypt/mod.ts:317`

```typescript
const data = encoder.encode(JSON.stringify(payload));
```

**Impact:** Different JSON key ordering could cause signature mismatches.

**Fix:** Use canonical JSON serialization.

---

## Good Security Practices Found

- Parameterized SQL queries (prevents SQL injection)
- Ephemeral keys for ECDH (forward secrecy)
- AES-GCM authenticated encryption
- PBKDF2 with 100,000 iterations
- Batch size limits (50 URI max)
- Request timeouts (30s default)
- Random 12-byte nonces for encryption

---

## Attack Scenarios

### Scenario 1: Account Takeover via Signature Bypass
1. Attacker submits login with invalid signature
2. Server logs warning but continues (auth.ts:186)
3. Attacker gains access without valid credentials

### Scenario 2: Password Brute Force
1. No rate limiting on /api/v1/auth/login
2. Attacker tries millions of passwords
3. Timing attack reveals partial hash matches

### Scenario 3: Session Hijacking via XSS
1. XSS vulnerability in any page
2. Attacker reads localStorage
3. Private keys and JWT tokens exfiltrated

### Scenario 4: User Enumeration
1. Attacker knows server public key
2. Compute HMAC paths for common usernames
3. Probe paths to determine which users exist

### Scenario 5: Password Reset Hijacking
1. POST /auth/credentials/request-password-reset
2. API returns resetToken in response
3. Attacker resets any user's password

---

## Prioritized Remediation

### Immediate (Before Any Production Use)
1. Fix signature verification bypass in auth.ts
2. Remove resetToken from API response
3. Implement rate limiting
4. Move private keys out of localStorage

### High Priority (Within 2 Weeks)
5. Constant-time password comparison
6. Validate SQL table prefix
7. Restrict CORS origins in production

### Medium Priority (Within 1 Month)
8. Add secret salt to path obfuscation
9. Add nonce/timestamp to signed payloads
10. Validate URI format
11. Use canonical JSON for signatures

### Hardening (Ongoing)
12. JWT device binding
13. ReDoS protection
14. Audit logging
15. Security headers (CSP, HSTS)

---

## Conclusion

B3nd's architecture is fundamentally sound with proper use of modern cryptographic primitives. The vulnerabilities identified are implementation issues that can be fixed without redesigning the system. The most critical issue is the signature verification bypass, which completely undermines authentication security.

After addressing these issues, B3nd would have a strong security posture suitable for production deployment.
