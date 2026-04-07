# 12. Making Deals

Alice has a book. Bob has a different book. They want to trade.

This is one of the oldest human interactions. And how it works depends entirely
on the medium.

## In Speech

Alice and Bob are in the same room.

Alice says: "I'll give you my book if you give me yours." Bob says: "Deal." They
hand the books to each other simultaneously.

The exchange is **atomic** — both sides happen at once because both parties are
present. Neither can run away with both books because the other is standing
right there. The medium of air, which requires physical presence, provides
atomicity for free.

Witnesses are optional but available — anyone else in the room saw the trade
happen. If there's a dispute later, the witnesses can confirm.

## In Paper

Alice is in Lisbon. Bob is in Tokyo. They want to trade by mail.

The problem is immediate: if Alice sends her book first, she has to trust that
Bob will send his. If Bob sends first, he has to trust Alice. The medium of
paper — physical objects traveling through space and time — means the exchange
can't be simultaneous. Someone goes first, and that person takes a risk.

Humans invented solutions to this:

**Contracts.** Alice and Bob sign an agreement: "Alice will send Book A. Bob
will send Book B. Both shipments must complete within 30 days. Failure to
deliver is a breach." The contract doesn't make the exchange simultaneous, but
it creates legal consequences for cheating. Trust shifts from the medium to the
institution of law.

**Escrow.** A trusted third party holds both items until both arrive. Alice
sends her book to Carol (the escrow agent). Bob sends his book to Carol. Once
Carol has both, she forwards Alice's book to Bob and Bob's book to Alice. The
exchange is effectively atomic because Carol holds everything until both sides
fulfill their obligation.

**Notarized exchange.** The contract is witnessed by a notary whose stamp gives
it legal force. The notary doesn't hold the goods, but their involvement raises
the cost of cheating.

Each solution adds parties (escrow agent, notary, courts) and structure
(contracts, deadlines, penalties) to compensate for what the medium took away:
physical presence and simultaneous exchange.

## In Digital

The digital medium can do something paper couldn't: **true atomic exchange
without a trusted third party.**

In b3nd, the `send()` function creates an **envelope** — a single message that
bundles multiple operations into one indivisible action:

```typescript
await send({
  payload: {
    inputs: [
      "mutable://accounts/alice-key/tokens/50", // Alice's 50 tokens (consumed)
      "mutable://accounts/bob-key/documents/xyz", // Bob's document (consumed)
    ],
    outputs: [
      [
        "mutable://accounts/bob-key/tokens/50", // 50 tokens → Bob
        signedByAlice({ amount: 50 }),
      ],
      [
        "mutable://accounts/alice-key/documents/xyz", // Document → Alice
        signedByBob({ doc: "xyz-content" }),
      ],
    ],
  },
}, client);
```

This envelope says: consume these inputs, create these outputs. **Either all
operations succeed or none do.** Alice's tokens move to Bob AND Bob's document
moves to Alice in a single, indivisible step. There is no moment where Alice has
lost her tokens but hasn't received the document. There is no moment where Bob
has lost his document but hasn't received the tokens.

The node validates the envelope as a whole:

- Are the inputs valid? Do they exist? Are they signed by the right parties?
- Do the outputs follow the rules? (Conservation: inputs must cover outputs)
- Are all signatures correct?

If everything checks out, the entire envelope is applied atomically. If any part
fails, nothing happens.

## The Envelope as a Notarized Contract

Look at what the envelope contains:

1. Alice's signature on the token transfer (she authorized sending 50 tokens to
   Bob)
2. Bob's signature on the document transfer (he authorized sending the document
   to Alice)
3. Both signatures in one package — a single document that proves both parties
   agreed

This is a notarized contract. The node is the notary. It checks the signatures,
verifies the terms are balanced, and executes the exchange. The difference from
paper notarization: no human notary is needed, the verification is mathematical,
and the execution is instant.

## Fee Collection

The same envelope mechanism handles fees. Every write to the network can include
a payment:

```
inputs:
  - Alice's 50-token balance
outputs:
  - 49 tokens → Bob (the trade)
  - 1 token → node operator (the fee)
```

The room charges a fee for speaking, and the rules enforce it. Just like a
courtroom that charges filing fees, or a postal system that charges for stamps.
The fee is part of the envelope — it's not a separate transaction, it's part of
the deal.

Conservation means you can't cheat: the total value of outputs must equal the
total value of inputs. You can't create tokens from nothing. You can't claim to
have paid if you don't have the balance.

## The Three-Layer View

|                        | Speech (room)                             | Paper (mail)                         | Digital (b3nd)                                 |
| ---------------------- | ----------------------------------------- | ------------------------------------ | ---------------------------------------------- |
| **Atomicity**          | Physical presence — simultaneous exchange | Contracts, escrow — structured trust | Envelope — cryptographic atomicity             |
| **Trust source**       | "I can see you holding the book"          | "The contract is legally binding"    | "The signatures are mathematically valid"      |
| **Third party needed** | No (both present)                         | Yes (escrow, notary, courts)         | No (node validates the math)                   |
| **Cheating requires**  | Grabbing both books and running           | Breaching a contract (legal risk)    | Forging a cryptographic signature (impossible) |
| **Speed**              | Instant (handshake)                       | Days to months                       | Milliseconds                                   |
| **Witnessing**         | Others in the room                        | Notary stamp, court records          | The envelope itself is the proof               |

## The Pattern

The desire is ancient: two parties want to exchange things they value. The
conversation is simple: "I'll give you X if you give me Y." "Deal."

In speech, the medium makes this easy — presence provides atomicity. In paper,
the medium breaks atomicity — distance means someone goes first. So humans
invent contracts, escrow, and notaries.

In digital, the medium enables something genuinely new: **atomic exchange
without a trusted third party.** The envelope contains both sides of the deal,
both signatures, and the node executes it as one indivisible step. The
mathematics of the signature replaces the physical presence of the handshake.

The conversation hasn't changed. The deal hasn't changed. The medium made it
possible to execute the same deal, with the same guarantees, between strangers
on opposite sides of the planet, in milliseconds, without trusting anyone.
