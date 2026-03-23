# Round 4: Cross-Front Synthesis

**Goal:** Combine findings from Rounds 1-3 across all 6 research fronts into emergent insights, resolve open items, and produce an integrated protocol architecture.

**Date:** 2026-03-16

---

## Experiments

### Batch 1 (parallel)

**S1: End-to-End Protocol Architecture**
- Synthesize all 7 decisions (D1-D7) into a coherent protocol specification
- Define the message lifecycle from SDK call to confirmed slot
- Map how crypto (D6/D7), consensus (D1/D2), privacy (D3), economics (D4/D5) compose
- Identify integration conflicts and resolution
- Deliverable: Protocol architecture document with sequence diagrams

**S2: Large Committee Simulation (K≥15)**
- Extend E2 simulation for K=11,13,15,21 to find the BFT boundary (f=0.33)
- Test stake-weighted selection with anti-whale caps at larger K
- Measure committee overlap probability across epochs
- Validate the dynamic scaling formula from D2
- Deliverable: Simulation results + updated parameter table

**S3: Constant-Rate Traffic Shaping Protocol**
- Design the padding protocol that E3 showed is needed
- Define node emission rate, padding strategy, and burst handling
- Analyze bandwidth overhead at various traffic levels (1K, 10K, 100K msgs/day)
- Model adversary capabilities against constant-rate padding
- Deliverable: Traffic shaping specification + overhead analysis

### Batch 2 (parallel)

**S4: View-Change Protocol Design**
- Address E7's identified gap: proposer failure is unmodeled
- Design timeout-based view-change for the temporal consensus protocol
- Define leader election, timeout calculation, and Byzantine leader handling
- TLA+ sketch for the view-change extension
- Deliverable: View-change protocol spec + TLA+ fragment

**S5: Wire Format & Encoding Synthesis**
- Resolve base64 vs hex for hybrid signatures (E8 open item)
- Define complete message wire format: headers, payload, signatures, fees
- Size budget analysis for all message types under hybrid PQ
- Backward compatibility with classical-only nodes
- Deliverable: Wire format specification + size tables

**S6: Unified Threat Model**
- Cross-front attack surface: crypto + network + consensus + economics combined
- Identify attack chains that span multiple fronts (e.g., economic attack enabling consensus attack)
- Categorize by severity, likelihood, and mitigation status
- Map each threat to the specific Round 3 evidence that addresses (or doesn't address) it
- Deliverable: Threat matrix + mitigation map

---

## Success Criteria

Round 4 succeeds when:
1. All 7 decisions compose into a single coherent architecture (S1)
2. BFT-level committee parameters are determined (S2)
3. Privacy architecture is complete with traffic shaping (S3)
4. No unmodeled failure modes remain in consensus (S4)
5. Wire format is fully specified with PQ support (S5)
6. All known threats have identified mitigations (S6)
