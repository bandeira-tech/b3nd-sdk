import type {
  NodeProtocolInterface,
  NodeProtocolReadInterface,
  NodeProtocolWriteInterface,
  Schema,
} from "../src/types.ts";

export interface ServerFrontend {
  listen: (port: number) => void | Promise<void>;
  fetch: (req: Request) => Response | Promise<Response>;
  configure: (
    opts: {
      backend: { write: NodeProtocolInterface; read: NodeProtocolInterface };
      schema: Schema;
    },
  ) => void;
  getApp: <T>() => T;
}

export interface ServerNodeOptions {
  frontend: ServerFrontend;
  backend: {
    write: NodeProtocolWriteInterface;
    read: NodeProtocolReadInterface;
  };
  schema: Schema;
}

export function createServerNode(options: ServerNodeOptions) {
  if (!options?.frontend) throw new Error("frontend is required");
  if (!options?.backend?.write || !options?.backend?.read) {
    throw new Error("backend write/read are required");
  }
  if (!options?.schema) throw new Error("schema is required");

  const { frontend, backend, schema } = options;
  frontend.configure({ backend, schema });

  return {
    serverHandler: (req: Request) => frontend.fetch(req),
    listen: (port: number) => frontend.listen(port),
  };
}
