// Mongo executor for MongoClient, following the same pattern as the Postgres
// executor but using the official MongoDB driver. This module is installation-
// specific so the core SDK stays decoupled from any concrete driver.

import { MongoClient as NativeMongoClient } from "npm:mongodb";

import type { MongoExecutor } from "../../libs/b3nd-client-mongo/mod.ts";

export async function createMongoExecutor(
  connectionString: string,
  databaseName: string,
  collectionName: string,
): Promise<MongoExecutor> {
  const client = new NativeMongoClient(connectionString);
  await client.connect();
  const db = client.db(databaseName);
  const collection = db.collection(collectionName);

  return {
    async insertOne(doc) {
      const res = await collection.insertOne(doc);
      return { acknowledged: res.acknowledged };
    },
    async updateOne(filter, update, options) {
      const res = await collection.updateOne(filter, update, options);
      return {
        matchedCount: res.matchedCount,
        modifiedCount: res.modifiedCount,
        upsertedId: res.upsertedId,
      };
    },
    async findOne(filter) {
      const doc = await collection.findOne(filter);
      return (doc ?? null) as Record<string, unknown> | null;
    },
    async findMany(filter) {
      const docs = await collection.find(filter).toArray();
      return docs as Record<string, unknown>[];
    },
    async deleteOne(filter) {
      const res = await collection.deleteOne(filter);
      return { deletedCount: res.deletedCount };
    },
    async ping() {
      await db.command({ ping: 1 });
      return true;
    },
    async cleanup() {
      await client.close();
    },
  };
}

