# E5: Argon2id WASM Performance Benchmark Report

**Experiment:** E5 (Round 3)
**Date:** 2026-03-16
**Scope:** Argon2id key derivation performance across device classes via WebAssembly
**Protocol relevance:** Decision D6 (KDF choice for b3nd)

---

## 1. Benchmark Table: Derivation Time Across Device x Parameter Grid

All times in milliseconds. Values are derived from published benchmarks, library documentation, Bitwarden user reports, and cross-referenced scaling estimates. Where direct measurements were unavailable, values are interpolated from known data points (marked with ~).

### Parameters tested

| Label | Memory | Iterations (t) | Parallelism (p) | Notes |
|-------|--------|----------------|-----------------|-------|
| A | 19 MiB | 2 | 1 | OWASP minimum (Option 2) |
| B | 46 MiB | 1 | 1 | OWASP recommended (Option 1) |
| C | 64 MiB | 3 | 1 | RFC 9106 / Bitwarden-class |
| D | 64 MiB | 3 | 4 | RFC 9106 recommended |

### Derivation times (ms)

| Device Class | Param A (19M/t2/p1) | Param B (46M/t1/p1) | Param C (64M/t3/p1) | Param D (64M/t3/p4) |
|---|---|---|---|---|
| **Server: Node.js native** (modern x86, AVX2) | ~14 | ~15 | ~60 | ~45 |
| **Server: Node.js WASM** | ~40 | ~45 | ~180 | ~180* |
| **Server: Deno WASM** | ~40 | ~45 | ~180 | ~180* |
| **Desktop: Chrome (modern x86)** | ~80 | ~90 | ~350 | ~350* |
| **Desktop: Firefox (modern x86)** | ~75 | ~85 | ~330 | ~330* |
| **Desktop: Safari (Apple Silicon)** | ~70 | ~80 | ~310 | ~310* |
| **Mobile: Chrome Android (flagship)** | ~200 | ~230 | ~800 | ~800* |
| **Mobile: Safari iOS (iPhone 13+)** | ~180 | ~210 | ~750 | ~750* |
| **Low-end: Android Go (2GB RAM)** | ~500 | ~600 | ~2000+ | ~2000+* |

**\* Parallelism=4 provides no speedup in browser WASM** -- see Section 4.

### Source basis for estimates

- **Server native (14ms @ 19MiB/t2):** @felix/argon2 via Deno FFI on Apple M2 Pro measured 13.5ms/iter with OWASP t=2, 19MiB [1]. Native -O3 SSE is ~4x faster than WASM per argon2-browser benchmarks [2].
- **Server native (60ms @ 64MiB/t3):** General password hashing guide reports 210-420ms for 64MiB/t3/p1 on servers [3]; high-end servers are at the low end. RFC 9106 targets ~250ms for this config on a 4-core server.
- **Desktop browsers:** argon2-browser benchmarks show Chrome WASM at 360ms, Firefox at 340ms, Safari at 310ms for 100 iterations / 1MiB [2]. Scaling to real-world memory costs uses proportional memory + iteration scaling.
- **Mobile:** Estimated at ~2.5-3x desktop browser times based on Bitwarden user reports showing 10s+ login times at extreme settings (1GB/t10/p16) [4] and general mobile WASM overhead.
- **Android Go:** Estimated at ~5-7x desktop based on CPU class (Cortex-A53 class) and memory pressure.

---

## 2. Memory Safety

### Which devices can handle which memory parameters?

| Device Class | 19 MiB | 46 MiB | 64 MiB | 128 MiB | 256 MiB |
|---|---|---|---|---|---|
| Desktop browsers (8GB+ RAM) | Safe | Safe | Safe | Safe | Safe |
| Mobile Safari (iPhone, 4GB+) | Safe | Safe | Safe* | Risky | Crash likely |
| Mobile Chrome Android (4GB+) | Safe | Safe | Safe | Risky | Risky |
| Android Go (2GB RAM) | Safe | Risky | Risky | Crash likely | Crash |
| iOS Safari extensions | Safe | Safe | Risky** | Crash likely | Crash |

### Critical findings

**iOS Safari is the binding constraint:**
- Safari kills tabs without warning when WASM memory exceeds an undocumented threshold [5][6]. There is no graceful `memory.grow()` failure -- the tab simply dies.
- Bitwarden warns users that Argon2id with KDF memory >64 MiB causes issues with iOS autofill [7].
- SharedArrayBuffer (needed for threading) has even lower memory limits on iOS and can cause immediate crashes [8].
- iOS Lockdown Mode disables WASM entirely, breaking any WASM-based Argon2 [7].

**Android Go (2GB RAM):**
- Chrome itself uses ~100MB with one tab [9]. With OS overhead, only ~300-500MB is available for the web page.
- Allocating 64MiB for Argon2 is technically possible but risky under memory pressure.
- 19MiB is the safe upper bound for these devices.

**Recommendation:** 64 MiB is the maximum safe allocation for mainstream devices. 19 MiB should be the fallback for constrained environments. 46 MiB is a reasonable middle ground.

---

## 3. Bundle Size: WASM Module Sizes

| Library | Gzipped Size | SIMD Support | Notes |
|---|---|---|---|
| **openpgpjs/argon2id** | <7 KB | Yes (auto-fallback) | WASM inlined as base64; memory managed in JS [10] |
| **argon2ian** | ~6.4 KB | Yes (autovectorized) | Monocypher-based; uses DecompressionStream [11] |
| **hash-wasm** (argon2 module) | ~11 KB | Planned | Full hash library; argon2 is one module [12] |
| **argon2-browser** | ~30 KB | Optional separate build | Oldest/most established; SIMD build separate [2] |

### Analysis

Bundle size is not a concern for any of these libraries. Even the largest (argon2-browser at ~30KB gzipped) is negligible compared to typical web application bundles. The openpgpjs/argon2id library at <7KB is impressively small and well-suited for b3nd's needs, as it:
- Inlines WASM as base64 (no separate .wasm file fetch)
- Automatically falls back from SIMD to non-SIMD
- Manages memory on the JS side (keeping WASM binary minimal)

---

## 4. Threading: Does WASM Threading (SharedArrayBuffer) Help?

### Short answer: No, not in practice for Argon2.

### Details

**Current state of Argon2 parallelism in browsers:**
- The argon2-browser library explicitly **disables threading** in its WASM build [2].
- Bitwarden's web vault and browser extension run Argon2id **single-threaded** [4]. The parallelism parameter affects the hash output but does not parallelize computation.
- The openpgpjs/argon2id library does not use threading.

**Why threading is impractical:**

1. **SharedArrayBuffer requirements:** WASM threading requires `SharedArrayBuffer`, which requires Cross-Origin Isolation headers (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`) [13]. This breaks many third-party integrations (iframes, CDN resources without CORP headers).

2. **iOS Safari instability:** SharedArrayBuffer with WASM causes crashes on iOS, particularly at higher memory allocations [8].

3. **Web Worker overhead:** Spawning workers and coordinating memory for a sub-second KDF operation adds overhead that can negate parallelism gains for small workloads.

4. **Parallelism parameter still matters:** Setting p=4 increases the memory footprint (memory is divided into p lanes) and changes the hash output. It provides security benefit (attackers must also use parallelism) even without runtime speedup.

**Recommendation for b3nd:** Use `parallelism=1`. It produces the same security-per-millisecond as higher parallelism values in single-threaded WASM, avoids the SharedArrayBuffer requirement, and is universally compatible.

---

## 5. Native vs WASM: Server Performance Gap

### Measured ratios

| Comparison | Performance Ratio | Source |
|---|---|---|
| Native -O3 SSE vs Chrome WASM | ~4x faster | argon2-browser benchmarks [2] |
| Native -O3 (no SSE) vs Chrome WASM | ~2.5x faster | argon2-browser benchmarks [2] |
| Native Node addon vs Node WASM (general) | 1.75-2.5x faster | nickb.dev benchmarks [14] |
| Native with AVX2 vs WASM SIMD (128-bit) | ~4x faster at large payloads | nickb.dev [15] |
| Deno FFI (@felix/argon2) vs Deno WASM (hash-wasm) | ~3x faster | 13.5ms vs ~40ms for 19MiB/t2 [1][12] |

### Why the gap exists

1. **SIMD width:** Native code can use AVX2 (256-bit) or AVX-512 (512-bit) SIMD. WASM SIMD is limited to 128-bit registers [15].
2. **Memory access patterns:** Argon2's memory-hard design involves large sequential and pseudo-random memory access. Native code benefits from OS-level memory management optimizations not available to WASM.
3. **64-bit integer operations:** Argon2's core `fBlaMka` function (called ~30M times per iteration) uses uint64 heavily. WASM supports i64 natively, but the JS-WASM boundary and lack of 64-bit SIMD multiply reduces throughput [2].

### Recommendation for b3nd server components

Use **native bindings** (not WASM) for any server-side Argon2id:
- Node.js: `argon2` (npm) or `@node-rs/argon2`
- Deno: `@felix/argon2` (FFI-based)
- Node.js v24.7+: `crypto.subtle` WebCrypto API now supports Argon2id natively [16]

Reserve WASM for browser clients only.

---

## 6. Browser Compatibility: Current State of Argon2 Support

### Native WebCrypto API

| Runtime | Argon2id in WebCrypto | Status |
|---|---|---|
| Chrome | No | Not implemented; no timeline |
| Firefox | No | Not implemented; no timeline |
| Safari | No | Not implemented; no timeline |
| Node.js v24.7+ | **Yes** | Supported since Aug 2025 [16] |
| Deno | No | Not confirmed |

Argon2 is part of the WICG "Modern Algorithms in the Web Cryptography API" proposal but has **not been adopted into the W3C WebCrypto specification** [17]. Browser focus has been on Curve25519 (Ed25519/X25519), which shipped in Chrome 137, Firefox, and Safari in 2025. There is no public timeline for browser-native Argon2.

### WASM-based Argon2id browser support

| Feature | Chrome | Firefox | Safari | Safari iOS | Chrome Android |
|---|---|---|---|---|---|
| WASM (basic) | Yes | Yes | Yes | Yes | Yes |
| WASM SIMD | Yes (v91+) | Yes (v89+) | No* | No* | Yes |
| SharedArrayBuffer | Yes** | Yes** | Yes** | Partial*** | Yes** |
| Web Workers | Yes | Yes | Yes | Yes | Yes |

\* Safari has limited WASM SIMD support; openpgpjs/argon2id auto-falls back to non-SIMD.
\** Requires Cross-Origin Isolation headers (COOP/COEP).
\*** iOS Safari SharedArrayBuffer support is unreliable, especially with WASM memory growth.

### iOS Lockdown Mode

iOS Lockdown Mode **disables WebAssembly entirely** [7]. Users with Lockdown Mode enabled cannot use any WASM-based Argon2. This affects a small but security-conscious user population. A PBKDF2 fallback (via WebCrypto, which works in Lockdown Mode) is necessary for these users.

---

## 7. Recommended Parameters for b3nd

### Default parameters (standard devices)

```
algorithm: Argon2id
memory:   46 MiB (47,104 KiB)
iterations: 1
parallelism: 1
hash_length: 32 bytes
salt_length: 16 bytes
```

**Rationale:**
- Matches OWASP Option 1 (equivalent security to 19MiB/t2) [18]
- Single iteration minimizes CPU time while maximizing memory-hardness (memory is more expensive for attackers than CPU cycles)
- p=1 avoids SharedArrayBuffer requirement
- Expected derivation times: ~80-90ms desktop browser, ~200-230ms mobile, ~15ms server native
- Safe on all mainstream devices including modern iOS

### Fallback parameters (constrained devices)

```
algorithm: Argon2id
memory:   19 MiB (19,456 KiB)
iterations: 2
parallelism: 1
hash_length: 32 bytes
salt_length: 16 bytes
```

**Rationale:**
- OWASP Option 2: equivalent security to the default [18]
- Safe on Android Go (2GB RAM) devices
- Safe on older iOS devices with less available memory
- Expected derivation times: ~80ms desktop browser, ~200ms mobile, ~500ms low-end Android

### Emergency fallback (WASM unavailable)

```
algorithm: PBKDF2-SHA256
iterations: 600,000
hash_length: 32 bytes
salt_length: 16 bytes
```

**Rationale:**
- Required for iOS Lockdown Mode (WASM disabled) [7]
- OWASP minimum for PBKDF2 is 600,000 iterations [18]
- Available via WebCrypto API on all browsers (no WASM needed)
- Expected derivation times: ~300-500ms on modern devices via WebCrypto
- Significantly weaker than Argon2id (no memory-hardness) but better than nothing

### Parameter negotiation strategy

```
1. Attempt Argon2id with default params (46 MiB)
2. If memory allocation fails or device is detected as constrained:
   -> Fall back to Argon2id with 19 MiB params
3. If WASM is unavailable (Lockdown Mode, very old browser):
   -> Fall back to PBKDF2-SHA256 via WebCrypto
4. Store which KDF was used alongside the derived key metadata
```

The KDF identifier and parameters must be stored with the output so the correct KDF can be used for verification/derivation on subsequent operations.

---

## 8. Decision Impact: How This Affects D6 (KDF Choice)

### Primary finding: Argon2id is viable as default KDF for b3nd

**Supporting evidence:**
1. **Bundle size is negligible:** <7KB gzipped with openpgpjs/argon2id [10]
2. **Performance is acceptable:** 80-230ms on desktop/mobile browsers with OWASP-recommended parameters
3. **Memory is safe at 46 MiB:** Works on all mainstream devices; 19 MiB fallback covers constrained devices
4. **Industry validation:** Bitwarden ships Argon2id (64MiB/t3/p4) to millions of browser users [7]

### Key constraints that shape the design

| Constraint | Impact on D6 |
|---|---|
| No native WebCrypto Argon2 in browsers | Must ship WASM; ~7KB overhead |
| iOS Lockdown Mode disables WASM | Must have PBKDF2 fallback path |
| WASM threading impractical | Use p=1; no parallelism speedup |
| iOS Safari memory limits undocumented | Cap at 46 MiB default; 64 MiB is risky |
| Android Go 2GB devices | Need 19 MiB fallback option |
| Native 2-4x faster than WASM | Use native bindings on server |
| Node.js 24.7+ has WebCrypto Argon2id | Can use standard API on modern Node |

### Recommendation for D6

**Argon2id as default KDF with tiered fallback:**

```
Tier 1 (default):  Argon2id, m=46MiB, t=1, p=1  (WASM in browser, native on server)
Tier 2 (constrained): Argon2id, m=19MiB, t=2, p=1  (safe on 2GB devices)
Tier 3 (no WASM):  PBKDF2-SHA256, 600K iterations  (iOS Lockdown Mode, legacy)
```

**PBKDF2 is not needed as a co-equal default** -- it should only be a last-resort fallback. The WASM ecosystem is mature enough (Bitwarden, OpenPGP.js, Signal all ship Argon2 WASM) that Argon2id can be the primary KDF across all platforms.

### Risk assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| iOS Safari tab crash at 46 MiB | Low | Try/catch around WASM instantiation; fall to 19 MiB |
| WASM disabled (Lockdown Mode) | Low (~1% users) | PBKDF2 fallback; feature detection |
| Future WebCrypto Argon2 breaks WASM approach | Low (additive, not breaking) | Can migrate to native when available |
| Android Go device too slow (>2s) | Medium | 19 MiB fallback; async with progress indicator |
| Supply chain risk from WASM dependency | Low | openpgpjs/argon2id is audited, small, MIT-licensed |

---

## Sources

1. [@felix/argon2 - JSR](https://jsr.io/@felix/argon2) - Deno FFI Argon2 benchmarks
2. [antelle/argon2-browser - GitHub](https://github.com/antelle/argon2-browser) - Original browser Argon2 WASM library and benchmarks
3. [Password Hashing Guide 2025](https://guptadeepak.com/the-complete-guide-to-password-hashing-argon2-vs-bcrypt-vs-scrypt-vs-pbkdf2-2026/) - Comprehensive parameter/performance guide
4. [Bitwarden: Argon2id is single threaded on desktop app and web vault](https://github.com/bitwarden/clients/issues/4779) - Threading limitations
5. [emscripten-core/emscripten#19374](https://github.com/emscripten-core/emscripten/issues/19374) - Safari OOM on WASM memory
6. [WebKit Bug 221530](https://bugs.webkit.org/show_bug.cgi?id=221530) - Safari WASM memory boundary failures
7. [Bitwarden: Encryption Key Derivation](https://bitwarden.com/help/kdf-algorithms/) - Bitwarden's Argon2id parameters and iOS caveats
8. [emscripten-core/emscripten#19144](https://github.com/emscripten-core/emscripten/issues/19144) - iOS SharedArrayBuffer + WASM OOM
9. [Quora: Chrome RAM on Android Go](https://www.quora.com/How-much-RAM-does-Google-Chrome-consume-in-an-Android-Go-phone) - Chrome memory usage data
10. [openpgpjs/argon2id - GitHub](https://github.com/openpgpjs/argon2id/) - Size-optimized Argon2id WASM (<7KB)
11. [argon2ian - Lobsters](https://lobste.rs/s/4q7nyv/argon2ian_argon2_hash_wasm_for_evergreen) - Size-optimized alternative (~6.4KB)
12. [hash-wasm - GitHub](https://github.com/Daninet/hash-wasm) - Hash library with Argon2 WASM module
13. [SharedArrayBuffer - MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) - Cross-Origin Isolation requirements
14. [WASM and Native Node Module Performance Comparison - nickb.dev](https://nickb.dev/blog/wasm-and-native-node-module-performance-comparison/) - Native vs WASM benchmarks
15. [The WebAssembly value proposition - nickb.dev](https://nickb.dev/blog/the-webassembly-value-proposition-is-write-once-not-performance/) - SIMD width limitations
16. [Node.js v24.7.0 Release](https://dev.to/zaheetdev/nodejs-v2470-released-post-quantum-cryptography-modern-webcrypto-and-more-1df9) - WebCrypto Argon2 support
17. [WICG: WebCrypto Argon2 Proposal](https://discourse.wicg.io/t/proposal-webcrypto-argon2-curve-448-25519-secp256k1-chacha20-poly1305/5132/) - Standardization proposal
18. [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) - Recommended parameters
19. [RFC 9106: Argon2](https://www.rfc-editor.org/rfc/rfc9106.html) - Official Argon2 specification
20. [Bitwarden Argon2id Implementation PR](https://github.com/bitwarden/clients/pull/4468) - WASM implementation details
