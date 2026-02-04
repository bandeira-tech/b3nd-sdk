declare const __dirname: string;

declare module "node:path" {
  const path: any;
  export = path;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

interface ImportMeta {
  url: string;
}
