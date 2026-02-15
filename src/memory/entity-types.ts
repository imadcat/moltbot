/**
 * Entity and relationship types aligned with Schema.org vocabulary
 */

/**
 * Core Schema.org entity types commonly used in conversational contexts
 * Based on https://schema.org/docs/full.html
 */
export type SchemaOrgEntityType =
  | "Person"
  | "Organization"
  | "Place"
  | "Event"
  | "Thing"
  | "Product"
  | "CreativeWork"
  | "Action"
  | "Intangible"
  | "Date"
  | "Time";

/**
 * Schema.org relationship types (properties that connect entities)
 * Based on https://schema.org/docs/datamodel.html
 */
export type SchemaOrgRelationType =
  | "knows"
  | "worksFor"
  | "attendee"
  | "location"
  | "about"
  | "mentions"
  | "creator"
  | "participant"
  | "associatedWith"
  | "relatedTo"
  | "temporal"
  | "owns"
  | "memberOf";

/**
 * Extracted entity with Schema.org alignment
 */
export type Entity = {
  id: string;
  type: SchemaOrgEntityType;
  name: string;
  description?: string;
  properties: Record<string, unknown>;
  sourceSessionFile?: string;
  sourceChunkId?: string;
  extractedAt: number;
  confidence?: number;
};

/**
 * Relationship between entities with Schema.org alignment
 */
export type Relationship = {
  id: string;
  type: SchemaOrgRelationType;
  sourceEntityId: string;
  targetEntityId: string;
  properties: Record<string, unknown>;
  sourceSessionFile?: string;
  sourceChunkId?: string;
  extractedAt: number;
  confidence?: number;
};

/**
 * Entity graph containing entities and their relationships
 */
export type EntityGraph = {
  entities: Entity[];
  relationships: Relationship[];
};

/**
 * Configuration for entity extraction
 */
export type EntityExtractionConfig = {
  enabled: boolean;
  minConfidence?: number;
  maxEntitiesPerChunk?: number;
  extractFromSessions?: boolean;
  extractFromMemoryFiles?: boolean;
};
