b3nd/sdk provides client/server application protocol with multiple backend
support and batteries included

b3nd/sdk is intended to support the design of allowing applications to manage
their data schemas on their clientside frontends and use a secure and scalable
backend solution that is flexible both ways both for the client app and the
backend provider

b3nd/sdk is used in applications that are nodes to a network that may be local
and made of 1 and can run even on your browser using local storage or indexeddb
or in memory even, same for a script, or can connect to an http api that runs a
simple deno kv or sqlite backend, or connects with multiple other nodes via
websocket and http to broadcast and distribute persistence

## Target Module Components Topology

b3nd/sdk

- backends/{memory,http,websocket,localStorage,denokv,postgres,...}
- client
- types

b3nd/sdk/backends export unified interfaces for different backends, they require
initialization with shared standards like backend schema that maps program urls
(protocol://toplevel) to validation functions, and also take custom
configuration related to the actual backend, i.e. connection string for
postgres, url for websocket and http and so on

b3nd/sdk/client exports unified interface to route message for multiple
backends, it's initialized with a client schema that maps programs urls
(protocol://toplevel) to target backend instance programs

So while backend schema defines what programs are supported and available in a
backend instance, the client schema defines what programs are routed to what
backends

This way browser apps can communicate with multiple http and websocket backends,
as well as have a local instance; also http apis and websocket servers can be
setup in meshes to work together for HA or other distributed designs

## Development

b3nd/sdk must

- ALWAYS have a test for each component to automate validation and simplify
  troubleshooting
- NEVER catch/hide/garble errors
- ALWAYS leave it to the user to decide how to best handle errors for their
  applications
