/**
 * @module
 * B3nd Indexer
 *
 * Core type definitions for the indexer system. Provides interfaces for
 * defining indexers, querying indexed data, running aggregation pipelines,
 * and implementing storage backends.
 */

export type {
  AggregateOp,
  AggregationResult,
  AggregationStage,
  FilterOperator,
  IndexerBackend,
  IndexerDefinition,
  IndexFieldDefinition,
  IndexQuery,
  IndexQueryResult,
  SearchOptions,
} from "./types.ts";
