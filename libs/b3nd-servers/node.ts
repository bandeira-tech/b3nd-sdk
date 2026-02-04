import type {
  NodeProtocolInterface,
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
  Schema,
} from "../b3nd-core/types.ts";
import type { Node } from "../b3nd-compose/types.ts";

export interface ServerFrontend {
  listen: (port: number) => void | Promise<void>;
  fetch: (req: Request) => Response | Promise<Response>;
  configure: (
    opts:
      | {
        backend: {
          write: NodeProtocolWriteInterface;
          read: NodeProtocolReadInterface;
        };
        schema: Schema;
        node?: Node;
      }
      | { client: NodeProtocolInterface },
  ) => void;
}

export interface ServerNodeOptions {
  frontend: ServerFrontend;
  backend?: {
    write: NodeProtocolWriteInterface;
    read: NodeProtocolReadInterface;
  };
  schema?: Schema;
  node?: Node;
  client?: NodeProtocolInterface;
}

export function createServerNode(options: ServerNodeOptions): {
  serverHandler: (req: Request) => Response | Promise<Response>;
  listen: (port: number) => void | Promise<void>;
} {
  if (!options?.frontend) throw new Error("frontend is required");

  const { frontend, client } = options;

  // New simplified path: { frontend, client }
  if (client) {
    frontend.configure({ client });
    return {
      serverHandler: (req: Request) => frontend.fetch(req),
      listen: (port: number) => frontend.listen(port),
    };
  }

  // Legacy path: { frontend, backend, schema, node }
  if (!options?.backend?.write || !options?.backend?.read) {
    throw new Error("backend write/read are required");
  }
  if (!options?.schema) throw new Error("schema is required");

  const { backend, schema, node } = options;
  frontend.configure({ backend: backend!, schema: schema!, node });

  return {
    serverHandler: (req: Request) => frontend.fetch(req),
    listen: (port: number) => frontend.listen(port),
  };
}
