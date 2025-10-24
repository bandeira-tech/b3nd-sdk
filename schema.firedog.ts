/*

The Firecat Protocol builds on top of B3ND in 4 ways

1. Firecat Protocol defines the server schema for nodes to support
2. Firecat Protocol defines a network protocol for nodes to share state
3. Firecat Protocol defines a proof of work protocol to update the shared state
4. Firecat Protocol defines the cost of requests

*/

/* SCHEMA for B3nd servers */

/* dog:// enable users to pay for ephemeral volumes */
/* dog:// protocol works as a message broadcast system */
/* dog:// messages are transmitted to peers and dropped */

/* cat:// enable users to pay for retrievable volumes */
/* cat:// payable amount is locked in the volume and can be retrieved */
/* cat://  */

/* dragon:// enable users to pay for persistent volumes */

"dog://users/<user.pubkey>/<app.pubkey>/<target.path>";
"dog://users/<user.pubkey>/<app.pubkey>/<target.path>";
