/**
 * Entity and relationship extraction service
 * Extracts structured entities and relationships from conversation text
 * using LLM and aligns them with Schema.org types
 */

import { randomUUID } from "node:crypto";
import type {
  Entity,
  EntityExtractionConfig,
  EntityGraph,
  Relationship,
  SchemaOrgEntityType,
  SchemaOrgRelationType,
} from "./entity-types.js";

export type EntityExtractionResult = {
  entities: Entity[];
  relationships: Relationship[];
  error?: string;
};

type ExtractedEntityRaw = {
  type: string;
  name: string;
  description?: string;
  properties?: Record<string, unknown>;
};

type ExtractedRelationshipRaw = {
  type: string;
  source: string;
  target: string;
  properties?: Record<string, unknown>;
};

type LLMResponse = {
  entities: ExtractedEntityRaw[];
  relationships: ExtractedRelationshipRaw[];
};

/**
 * Entity extraction prompt that guides the LLM to extract Schema.org aligned entities
 */
const ENTITY_EXTRACTION_PROMPT = `Extract entities and relationships from the following text. 
Follow Schema.org vocabulary for entity types and relationship types.

Entity types (use these Schema.org types):
- Person: individuals, users, contacts
- Organization: companies, groups, teams
- Place: locations, cities, addresses
- Event: meetings, appointments, activities
- Product: items, tools, software
- CreativeWork: documents, articles, media
- Action: tasks, todos, activities
- Intangible: concepts, ideas, skills
- Date: specific dates
- Time: specific times
- Thing: generic entities

Relationship types (use these Schema.org properties):
- knows: person knows another person
- worksFor: person works for organization
- attendee: person attending event
- location: entity is located at place
- about: entity is about another entity
- mentions: entity mentions another entity
- creator: entity was created by person
- participant: entity participates in another
- associatedWith: entities are associated
- relatedTo: entities are related
- temporal: time-based relationship
- owns: person owns entity
- memberOf: person is member of organization

Return JSON with:
{
  "entities": [{"type": "Person", "name": "John", "description": "colleague", "properties": {}}],
  "relationships": [{"type": "knows", "source": "John", "target": "Alice", "properties": {}}]
}

Text to analyze:
`;

/**
 * Validates if a string is a valid Schema.org entity type
 */
function isValidEntityType(type: string): type is SchemaOrgEntityType {
  const validTypes: SchemaOrgEntityType[] = [
    "Person",
    "Organization",
    "Place",
    "Event",
    "Thing",
    "Product",
    "CreativeWork",
    "Action",
    "Intangible",
    "Date",
    "Time",
  ];
  return validTypes.includes(type as SchemaOrgEntityType);
}

/**
 * Validates if a string is a valid Schema.org relationship type
 */
function isValidRelationType(type: string): type is SchemaOrgRelationType {
  const validTypes: SchemaOrgRelationType[] = [
    "knows",
    "worksFor",
    "attendee",
    "location",
    "about",
    "mentions",
    "creator",
    "participant",
    "associatedWith",
    "relatedTo",
    "temporal",
    "owns",
    "memberOf",
  ];
  return validTypes.includes(type as SchemaOrgRelationType);
}

/**
 * Normalize entity names for matching
 */
function normalizeEntityName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Extract entities and relationships from text using an LLM provider
 */
export async function extractEntitiesFromText(
  text: string,
  options: {
    config?: EntityExtractionConfig;
    llmExtract?: (prompt: string) => Promise<string>;
    sourceSessionFile?: string;
    sourceChunkId?: string;
  },
): Promise<EntityExtractionResult> {
  const config = options.config ?? { enabled: true };

  if (!config.enabled) {
    return { entities: [], relationships: [] };
  }

  if (!options.llmExtract) {
    return {
      entities: [],
      relationships: [],
      error: "LLM extraction function not provided",
    };
  }

  try {
    const prompt = ENTITY_EXTRACTION_PROMPT + text;
    const response = await options.llmExtract(prompt);

    // Parse LLM response (expecting JSON)
    let parsed: LLMResponse;
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response.trim();
      parsed = JSON.parse(jsonStr) as LLMResponse;
    } catch {
      return {
        entities: [],
        relationships: [],
        error: "Failed to parse LLM response as JSON",
      };
    }

    const extractedAt = Date.now();
    const entityMap = new Map<string, Entity>();
    const entities: Entity[] = [];

    // Process extracted entities
    for (const rawEntity of parsed.entities ?? []) {
      if (!isValidEntityType(rawEntity.type)) {
        // Default to "Thing" for unknown types
        rawEntity.type = "Thing";
      }

      const entity: Entity = {
        id: randomUUID(),
        type: rawEntity.type as SchemaOrgEntityType,
        name: rawEntity.name,
        description: rawEntity.description,
        properties: rawEntity.properties ?? {},
        sourceSessionFile: options.sourceSessionFile,
        sourceChunkId: options.sourceChunkId,
        extractedAt,
        confidence: 0.8, // Default confidence
      };

      entities.push(entity);
      entityMap.set(normalizeEntityName(entity.name), entity);
    }

    // Apply max entities limit if configured
    const maxEntities = config.maxEntitiesPerChunk ?? 50;
    if (entities.length > maxEntities) {
      entities.splice(maxEntities);
    }

    // Process extracted relationships
    const relationships: Relationship[] = [];
    for (const rawRel of parsed.relationships ?? []) {
      if (!isValidRelationType(rawRel.type)) {
        // Skip invalid relationship types
        continue;
      }

      const sourceEntity = entityMap.get(normalizeEntityName(rawRel.source));
      const targetEntity = entityMap.get(normalizeEntityName(rawRel.target));

      if (!sourceEntity || !targetEntity) {
        // Skip relationships with missing entities
        continue;
      }

      const relationship: Relationship = {
        id: randomUUID(),
        type: rawRel.type as SchemaOrgRelationType,
        sourceEntityId: sourceEntity.id,
        targetEntityId: targetEntity.id,
        properties: rawRel.properties ?? {},
        sourceSessionFile: options.sourceSessionFile,
        sourceChunkId: options.sourceChunkId,
        extractedAt,
        confidence: 0.8, // Default confidence
      };

      relationships.push(relationship);
    }

    return { entities, relationships };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      entities: [],
      relationships: [],
      error: `Entity extraction failed: ${message}`,
    };
  }
}

/**
 * Merge multiple entity extraction results into a single graph
 */
export function mergeEntityGraphs(graphs: EntityGraph[]): EntityGraph {
  const entityMap = new Map<string, Entity>();
  const relationshipSet = new Set<string>();
  const relationships: Relationship[] = [];

  for (const graph of graphs) {
    for (const entity of graph.entities) {
      const key = `${entity.type}:${normalizeEntityName(entity.name)}`;
      if (!entityMap.has(key)) {
        entityMap.set(key, entity);
      }
    }

    for (const rel of graph.relationships) {
      const key = `${rel.type}:${rel.sourceEntityId}:${rel.targetEntityId}`;
      if (!relationshipSet.has(key)) {
        relationshipSet.add(key);
        relationships.push(rel);
      }
    }
  }

  return {
    entities: Array.from(entityMap.values()),
    relationships,
  };
}
