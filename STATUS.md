# Status of implementation of visions and designs from README.md

We are approaching this problem for the 5th time or so and this is a new breakthrough after a while.

We have now designed Persistence which deals with the URL based persistence and delegates to the protocols and domains to implement their usage of the data and access control.

This allows us to do things like delegating to the constructor the setup of signatures validations, and acces based on file content and path, and thus fixing the design of the persistence layer, and relying on upstream to figure out other concerns.

This introduces clearer layers to the design and hopefuly allows us to further disentangle layers going forward.

So

b3nd/persistence defines types and simple mechanics of write and read from the persistent storage based on a given schema that defines protocol://domain programs and their write validation functions, where access and formats can be enforced as needed.

b3nd/auth defines the validation functions for programs that require authentication of access to enable persistent writes, and does that requiring a formatted payload that encodes signatures and pubkeys that are then validated against different strategies.

now granted there may be more restructuring and renaming on the books, that's what we want to find out too.
now we still want some other components to be created, that's

b3nd/encrypt that provides client functions to encrypt and decrypt payloads to be sent to storage to enable support for encrypted private data.

b3nd/httpapi that provides an HTTP API controller to serve custom config persistence.

b3nd/explorer that uses the b3nd/httpapi in a webapp to explore the data in persistence.

and then also the support for different backends for persistence, like redis and so on, and better support for distinct protocol features, i.e. separating concerns between program/domain and protocol.
