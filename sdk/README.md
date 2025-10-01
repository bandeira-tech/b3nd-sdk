b3nd/sdk provides client/server application protocol with multiple backend support and batteries included

b3nd/sdk is intended to support the design of allowing applications to manage their data schemas on their clientside frontends and use a secure and scalable backend solution that is flexible both ways both for the client app and the backend provider

b3nd/sdk is used in applications that are nodes to a network that may be local and made of 1 and can run even on your browser using local storage or indexeddb or in memory even, same for a script, or can connect to an http api that runs a simple deno kv or sqlite backend, or connects with multiple other nodes via websocket and http to broadcast and distribute persistence

## Development

b3nd/sdk must

- ALWAYS have a test for each component to automate validation and simplify troubleshooting
- NEVER catch/hide/garble errors
- ALWAYS leave it to the user to decide how to best handle errors for their applications
