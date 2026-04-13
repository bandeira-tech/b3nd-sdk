# 10. The Machine That Reads Mail

The medium changes for the last time.

Paper traveled by horse, by ship, by rail. Letters took days, weeks, months. The
postal system was fast compared to walking, but slow compared to speaking.

The new medium is electromagnetic signals on wires and airwaves. Messages travel
at the speed of light. A conversation that took weeks by post happens in
milliseconds. The medium has no weight, no distance, no practical delay.

This changes the physics again. And as before, the new physics creates new gifts
and new threats.

## The Physics of the Digital Medium

**Speed.** Messages cross the globe in milliseconds. A conversation that once
required months of correspondence can be completed in a second. This is the
gift. The threat: attacks, forgeries, and floods arrive just as fast. There is
no human gatekeeper fast enough to check every message. The medium is too fast
for human oversight — so the machine must validate on its own.

**Perfect copying.** A physical letter had to be painstakingly transcribed by
hand to create a duplicate. A digital message duplicates in microseconds at zero
cost. This enables replication, backup, broadcast — every gift of copy. The
threat: forgery is trivially easy. If a seal is just a pattern of bits, copying
it is as easy as copying the message. Proof of identity must be _mathematically_
unforgeable, not just physically hard to reproduce.

**Global reach.** Any address is reachable from anywhere. There is no "local" in
the digital medium. A node in Lisbon can receive a message from Tokyo with no
intermediary. This makes the postal metaphor real at planetary scale. The
threat: anyone on Earth can try to send to any address. Access control can't
rely on physical proximity — the walls and doors from speech, the locked
mailboxes from paper, don't exist. Boundaries must be mathematical.

**Opacity.** The medium runs through machines — processors, memory, disk,
network cards. The conversation is hidden behind layers of code, circuit logic,
and abstraction. You can't watch a computer process a message the way you can
watch a postal clerk sort mail. The machinery is invisible. This is not a gift
or a threat — it's a challenge. And it's the specific challenge that b3nd
addresses.

## What the Machine Does

Underneath the opacity, what does the machine actually do?

The same thing the clerk does. The same thing the post office does.

**In speech:** a person at a desk listens to requests and follows the room's
rules. "I'd like to file a document." "Here's what we have on record." "Please
remove this from the file."

**In paper:** a post office accepts mail, sorts it into boxes, lets recipients
retrieve their mail, and discards expired items.

**In digital:** a b3nd node does exactly four things:

| Verb      | What it does                       | The human version                                 |
| --------- | ---------------------------------- | ------------------------------------------------- |
| `receive` | Accept a message at an address     | The clerk accepts your document                   |
| `read`    | Look up what's at an address       | The clerk finds your file                         |
| `list`    | Browse what's filed under a prefix | The clerk says "here's everything in this drawer" |
| `delete`  | Remove a message                   | The clerk shreds a document                       |

That's the entire vocabulary. Four verbs. Every interaction with a b3nd node is
one of these four operations. Every complex system built on b3nd — trading
platforms, consensus chains, authentication flows, content apps — composes from
these four verbs.

```
receive([["mutable://open/notes/hello", {}, { text: "hello world" }]])
  → The node files "hello world" at the address "mutable://open/notes/hello"

read("mutable://open/notes/hello")
  → The node retrieves what's at that address

list("mutable://open/notes/")
  → The node lists everything filed under "mutable://open/notes/"

delete("mutable://open/notes/hello")
  → The node removes what's at that address
```

## The Schema: House Rules

Every room has rules. A courtroom has rules about who can speak and what counts
as evidence. A library has rules about volume and behavior. A private office has
rules about who can enter.

In b3nd, the **schema** is the house rules. It defines what kind of messages
this node accepts.

A Firecat node (b3nd's public network protocol) accepts messages to these
addresses:

| Address type                   | Who can write         | Persistence | Use case                        |
| ------------------------------ | --------------------- | ----------- | ------------------------------- |
| `mutable://open/...`           | Anyone                | Rewritable  | Public data, bulletin boards    |
| `mutable://accounts/{key}/...` | Only the keyholder    | Rewritable  | Personal data, profiles         |
| `immutable://open/...`         | Anyone, once          | Write-once  | Permanent public records        |
| `immutable://inbox/{key}/...`  | Anyone, once          | Write-once  | Private messages, notifications |
| `hash://sha256/{hash}`         | Anyone, hash-verified | Permanent   | Content-addressed storage       |
| `link://accounts/{key}/...`    | Only the keyholder    | Rewritable  | Pointers, references            |

Each row is a room with specific rules. The node reads the address, identifies
which room the message is for, and applies the corresponding rules. If the
message doesn't pass — wrong signature, wrong format, wrong address — it's
rejected. The node doesn't read the content. It reads the address and enforces
the rules.

Just like a courtroom clerk who won't accept a filing that doesn't meet the
court's requirements. Just like a post office that won't deliver a letter
without a valid address.

## The Three-Layer View

|               | Speech (clerk)                | Paper (post office)       | Digital (b3nd node)        |
| ------------- | ----------------------------- | ------------------------- | -------------------------- |
| **Receives**  | Listens to what you say       | Accepts your letter       | `receive([[uri, values, data]])` |
| **Files**     | Remembers or writes it down   | Sorts into mailbox        | Stores at the URI          |
| **Retrieves** | Tells you what was said       | Gives you your mail       | `read(uri)`                |
| **Lists**     | "Here's what we have on file" | Lists items in a box      | `list(prefix)`             |
| **Validates** | "You can't speak here, sir"   | "This address is invalid" | Schema rejects the message |
| **Removes**   | Shreds a document             | Discards expired mail     | `delete(uri)`              |

The machine is not mysterious. It's a clerk at a counter, following the room's
rules. The medium changed from air to paper to electromagnetic signals. The role
didn't. Receive, file, retrieve, list, validate. That's a node. That's a post
office. That's a clerk.

The only difference is speed: the digital clerk processes millions of messages
per second. The rules are the same. The conversation is the same. The medium
made it faster and global — and made it invisible, which is why b3nd exists: to
make the conversation visible again.
