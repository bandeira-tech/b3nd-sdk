import b3nd from "@b3nd";

const myclients = {
  localMemoryClient: b3nd.clients.memoryClient({ slots: 100_000 }),
  postgresClient: b3nd.clients.postgresClient(dbUrl),
  httpPeerClients: peers.map((p) => b3nd.clients.httpClient(p.url)),
};

const programsSchema = {
  "fire://board.pub": () => true,
  "fire://rooms.pvt": b3nd.validators.validateMembership("./accesslist"),
  "fire://council.pvt": b3nd.validators.validateMembership("/members"),
  "cat://storage.svc": b3nd.validators.validatePubkeyInPath("/"),
};

const monitoringNode = b3nd.createServerNode({
  frontend: b3nd.servers.httpServer(),
  backend: {
    write: b3nd.clients.noopClient(),
    read: myclients.postgresClient,
  },
  schema: {
    "fire://board.pub": () => true,
  },
});

const publicBackend = {
  write: b3nd.clients.parallelBroadcast([
    myclients.localMemoryClient,
    myclients.postgresClient,
    b3nd.clients.sequenceBroadcast(myclients.httpPeerClients),
  ]),
  read: b3nd.clients.firstMatchSequence([
    myclients.localMemoryClient,
    myclients.postgresClient,
    myclients.httpPeerClients[0],
    myclients.httpPeerClients[1],
    myclients.httpPeerClients[2],
  ]),
};

const realtimeNode = b3nd.createServerNode({
  frontend: b3nd.servers.websocketServer(),
  backend: publicBackend,
  schema: programsSchema,
});

const publicNode = b3nd.createServerNode({
  frontend: b3nd.servers.httpServer(),
  backend: publicBackend,
  schema: programsSchema,
});

monitorinNode.listen(3501);
publicNode.withRequestMiddleware(logging).listen(80);
Deno.serve(realtimeNode.serverHandler, 8080);
