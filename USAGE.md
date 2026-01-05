b3nd is a distributed backend protocol for online applications, it's designed to work plug and play for builders and developers of all levels to integrate their applications with a high availability and scalable backend and data solution that ensures their data is safe and durable, and this design also provides several emerging features to build off of in the future.

Quick Overview
==============

the way to think about b3nd is that it's an open backend api that anyone can use, and it supports several types of usages to serve all types of applications, from personal projects and vibe coded apps, to full fledged products to millions of users.

b3nd is really simple, you can read/write and manage data that is always setup as a url and a payload, so the payload is stored on the given location and can be accessed and managed from there.

these urls must use one of the available programs in the b3nd protocol, these programs impose rules and requirements for data to be written to them, for example, some of the programs require payloads to be signed and authenticated and users can only write to their own path, like

```
mutable://accounts/:userpubkey/path/to/my/data
```

to write to mutable://accounts you must write to the pubkey that is signing the message, so only the that account can write to that path.

another one is the inbox program which allows messages to be sent to a given pubkey

```
immutable://inbox/:targetpubkey/path/to/messagepayload
```

Public Network
--------------

B3nd is a public network of decentralized nodes interested and invested in providing accessible backend solutions to modern builders and developers, therefore all the data written to b3nd is public and accessible, and the SDK provides all the tools needed to write, read and manage encrypted data for the app global states and events and also for user data.
