import type { BackendResolver } from "@bandeira-tech/b3nd-core/rig";
import { S3Store } from "@bandeira-tech/b3nd-stores/s3";
import { createS3Executor } from "../s3-executor.ts";

export function s3Backend(): BackendResolver {
  return {
    protocols: ["s3:"],
    resolve: (url) => {
      const parsed = new URL(url);
      const bucket = parsed.hostname;
      const prefix = parsed.pathname.length > 1
        ? parsed.pathname.substring(1)
        : "";
      const executor = createS3Executor(bucket, prefix);
      return new S3Store(bucket, executor, prefix);
    },
  };
}
