export type { MemoryIndexManager, MemorySearchResult } from "./manager.js";
export { getMemorySearchManager, type MemorySearchManagerResult } from "./search-manager.js";
export type {
  Entity,
  EntityGraph,
  Relationship,
  SchemaOrgEntityType,
  SchemaOrgRelationType,
  EntityExtractionConfig,
} from "./entity-types.js";
export { extractEntitiesFromText, mergeEntityGraphs } from "./entity-extractor.js";
export {
  EntityGraphManager,
  type EntityQueryOptions,
  type RelationshipQueryOptions,
} from "./entity-manager.js";
