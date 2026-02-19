---
name: b3nd
description: B3nd conceptual overview — what B3nd is, how it works in plain language, the three roles (app builders, protocol designers, infrastructure operators), core ideas (addresses, messages, validation, signing, privacy levels), and example use cases (recipe apps, journals, small business). Use for introductory questions, non-technical explanations, and understanding what B3nd does before diving into code. Building an app on Firecat? See the firecat skill. Creating a DePIN protocol? See the b3nd-framework skill.
---

# B3nd

Your app has things — recipes, journal entries, contacts, invoices, photos.
Each thing gets an address. You send things to their addresses, and later you
(or the people you choose) can read them back.

That's what B3nd does. It gives your app's things addresses, checks that what
you send belongs where you're sending it, and lets you control who can see what.
You never pick a database. You never rent a server. You never install anything
on a computer. The network handles all of that.

Think of it like the postal system for your data. You put something in an
envelope, write an address on it, and drop it in the mailbox. The post office
checks the address is real and delivers it. Whether the post office keeps a copy
is the postmaster's business, not yours. You just care that your letter arrived.

## What Your App Looks Like on B3nd

**A recipe app.** Each recipe has its own address. Your personal recipes are
private — only you can read them. Your published recipes are public — anyone
with the address can read them. You share a family recipe collection with your
sister by giving her the password. No account system, no server to maintain.
The recipes just live at their addresses.

**A journal app.** Every entry is encrypted with your key before it leaves your
device. The network stores it but can't read it. Nobody can — not the network
operators, not anyone who finds the address. Only you, with your key. Your
journal is truly private.

**A small business.** Your client list and invoices each have addresses. You
share the invoices folder with your accountant using a password you both know.
She can read invoices but not your client notes. You control what's visible
to whom, without setting up permissions on a server you'd have to manage.

**The pattern is always the same.** You think about your things and your people.
The network handles everything else — where the data physically lives, how
it gets from place to place, how it stays safe. You never see the
infrastructure. You just use addresses.

## The Three Roles

There are three kinds of people in the B3nd world. Most people only ever need
to be the first kind.

**App builders** think about things and people. What does my app store? Who
should see it? What should happen when someone adds something new? App builders
describe their app in terms their users understand — recipes, entries,
invoices — and B3nd takes care of the rest.

**Protocol designers** write the rules. They decide what kinds of things are
allowed, how addresses work, and what checks happen when something is sent.
Think of them as the people who designed the postal system — they decided that
envelopes need addresses and stamps, so that the rest of us don't have to think
about mail routing.

**Infrastructure operators** run the computers. They keep the network running,
decide how much data to store, and choose what hardware to use. They're the
postmasters — they make sure the mail gets delivered, but they don't read it
and they don't decide what you're allowed to send.

You only need to be an app builder. The rules and infrastructure already
exist for you to use.

## Core Ideas

If you want to understand what's happening behind the scenes, read on. Otherwise,
skip straight to "Going Deeper" below for the technical references.

These are the building blocks underneath B3nd. You don't need to memorize them,
but understanding them will help you see why things work the way they do.

**Everything has an address.** In technical terms, these are called URIs —
think of them as street addresses for your data. A recipe, a journal entry,
a profile — each one has a unique address that never changes.

**Messages carry your data.** When you want to save or update something, you
put it in a message and send it to an address. This is the only way data moves
in B3nd — always in one direction, always to an address.

**The network checks if things belong.** Every address has rules about what
can be sent there and by whom. These rules are called validation (or just
"the checks"). If something doesn't pass the checks, it's rejected — it
never happened.

**You own your data with a key.** Your key is what proves you are you. When you
sign something with your key, the network knows it came from you. Nobody can
fake your signature. (In technical terms, this uses a kind of digital signature
called Ed25519 — unforgeable by design.)

**You choose who sees what.** Data can be public (anyone can read it),
protected (anyone with a shared password can read it), or private (only the
person you choose can read it, using encryption). The network never sees the
unencrypted version of private data — it's encrypted before it leaves your
device.

**The network doesn't promise to keep copies.** B3nd is a delivery system, not
a storage guarantee. Whether a particular computer on the network holds onto
your data after delivering it is up to the operator of that computer. This is
by design — no one computer going down can lose your data, and no one company
controls it.

## Going Deeper

When you move from concepts to code, the technical docs use more precise names
for the ideas above. Here's how they map:

| What we called it here | What the technical docs call it |
| ---------------------- | ------------------------------- |
| Address                | URI                             |
| Message                | Message (same word, now a typed tuple `[uri, data]`) |
| The checks             | Validation / schema             |
| Rules for an address   | Program (`scheme://hostname`)   |
| Key / signature        | Ed25519 signing / auth          |
| Envelope               | Envelope (now a typed structure with `auth`, `inputs`, `outputs`) |
| The network            | Node (one computer in the network) |

With that vocabulary in hand, here's where to go next:

- **Building an app on Firecat?** Start with [FIRECAT.md > Quick Start](./FIRECAT.md)
  for working code in 60 seconds, then browse server setup, browser apps,
  and testing sections.

- **Creating your own DePIN network?** See [FRAMEWORK.md](./FRAMEWORK.md) for
  the B3nd SDK, protocol examples, node setup, and how to package your
  protocol as an SDK.

- **Running B3nd infrastructure?** See [OPERATORS.md](./OPERATORS.md) for
  node deployment, managed mode, backends, monitoring, replication,
  and multi-node networks.

- **Curious why B3nd works this way?** See [FAQ.md](./FAQ.md) for design
  rationale, trade-offs, and architectural decisions.
