/**
 * Example: Entity extraction integration with memory manager
 * 
 * This example demonstrates how to integrate entity extraction
 * into the memory indexing workflow.
 */

import type { MoltbotConfig } from "../config/config.js";
import type { MemoryIndexManager } from "./manager.js";
import { EntityGraphManager } from "./entity-manager.js";
import { extractEntitiesFromText } from "./entity-extractor.js";
import type { EntityExtractionConfig } from "./entity-types.js";

/**
 * Extract entities from a memory chunk and store them
 * 
 * This function can be integrated into the memory indexing pipeline
 * to automatically extract entities as chunks are processed.
 */
export async function extractAndStoreEntities(params: {
  manager: MemoryIndexManager;
  chunkId: string;
  chunkText: string;
  sourceFile?: string;
  config?: EntityExtractionConfig;
  llmExtract?: (prompt: string) => Promise<string>;
}): Promise<{ success: boolean; entityCount: number; relationshipCount: number; error?: string }> {
  try {
    // Get database from memory manager (internal API)
    const db = (params.manager as unknown as { db: unknown }).db;
    if (!db || typeof db !== "object") {
      return {
        success: false,
        entityCount: 0,
        relationshipCount: 0,
        error: "Database not available",
      };
    }

    // Create entity manager
    const entityManager = new EntityGraphManager(db as never);

    // Extract entities from chunk text
    const result = await extractEntitiesFromText(params.chunkText, {
      config: params.config,
      llmExtract: params.llmExtract,
      sourceChunkId: params.chunkId,
      sourceSessionFile: params.sourceFile,
    });

    if (result.error) {
      return {
        success: false,
        entityCount: 0,
        relationshipCount: 0,
        error: result.error,
      };
    }

    // Store extracted entities and relationships
    entityManager.storeEntityGraph({
      entities: result.entities,
      relationships: result.relationships,
    });

    return {
      success: true,
      entityCount: result.entities.length,
      relationshipCount: result.relationships.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      entityCount: 0,
      relationshipCount: 0,
      error: message,
    };
  }
}

/**
 * Example LLM extraction function using a hypothetical API
 * 
 * In a real implementation, this would call your configured LLM provider
 */
export async function exampleLLMExtract(prompt: string): Promise<string> {
  // This is a mock implementation
  // In reality, you would call your LLM API here
  
  // Example response format:
  return JSON.stringify({
    entities: [
      {
        type: "Person",
        name: "Alice",
        description: "Team member",
        properties: { role: "engineer" },
      },
      {
        type: "Organization",
        name: "TechCorp",
        description: "Company",
        properties: { industry: "technology" },
      },
    ],
    relationships: [
      {
        type: "worksFor",
        source: "Alice",
        target: "TechCorp",
        properties: {},
      },
    ],
  });
}

/**
 * Example: Query entities related to a search term
 * 
 * This shows how to combine entity queries with memory search
 */
export async function searchEntitiesInMemory(params: {
  manager: MemoryIndexManager;
  entityType?: string;
  namePattern?: string;
  limit?: number;
}): Promise<{
  success: boolean;
  entities: Array<{
    id: string;
    type: string;
    name: string;
    description?: string;
    relatedCount: number;
  }>;
  error?: string;
}> {
  try {
    const db = (params.manager as unknown as { db: unknown }).db;
    if (!db || typeof db !== "object") {
      return {
        success: false,
        entities: [],
        error: "Database not available",
      };
    }

    const entityManager = new EntityGraphManager(db as never);

    // Query entities
    const entities = entityManager.queryEntities({
      type: params.entityType,
      name: params.namePattern,
      limit: params.limit,
    });

    // Enrich with relationship counts
    const enriched = entities.map((entity) => {
      const { outgoing, incoming } = entityManager.getEntityRelationships(entity.id);
      return {
        id: entity.id,
        type: entity.type,
        name: entity.name,
        description: entity.description,
        relatedCount: outgoing.length + incoming.length,
      };
    });

    return {
      success: true,
      entities: enriched,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      entities: [],
      error: message,
    };
  }
}

/**
 * Example: Build a subgraph around an entity
 * 
 * This retrieves an entity and all its direct relationships
 */
export async function buildEntitySubgraph(params: {
  manager: MemoryIndexManager;
  entityId: string;
}): Promise<{
  success: boolean;
  graph?: {
    centerEntity: {
      id: string;
      type: string;
      name: string;
    };
    relatedEntities: Array<{
      id: string;
      type: string;
      name: string;
      relationship: string;
      direction: "outgoing" | "incoming";
    }>;
  };
  error?: string;
}> {
  try {
    const db = (params.manager as unknown as { db: unknown }).db;
    if (!db || typeof db !== "object") {
      return {
        success: false,
        error: "Database not available",
      };
    }

    const entityManager = new EntityGraphManager(db as never);

    // Get entity
    const entity = entityManager.getEntityById(params.entityId);
    if (!entity) {
      return {
        success: false,
        error: "Entity not found",
      };
    }

    // Get relationships
    const { outgoing, incoming } = entityManager.getEntityRelationships(params.entityId);

    // Build related entities list
    const relatedEntities = [];

    for (const rel of outgoing) {
      const target = entityManager.getEntityById(rel.targetEntityId);
      if (target) {
        relatedEntities.push({
          id: target.id,
          type: target.type,
          name: target.name,
          relationship: rel.type,
          direction: "outgoing" as const,
        });
      }
    }

    for (const rel of incoming) {
      const source = entityManager.getEntityById(rel.sourceEntityId);
      if (source) {
        relatedEntities.push({
          id: source.id,
          type: source.type,
          name: source.name,
          relationship: rel.type,
          direction: "incoming" as const,
        });
      }
    }

    return {
      success: true,
      graph: {
        centerEntity: {
          id: entity.id,
          type: entity.type,
          name: entity.name,
        },
        relatedEntities,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
    };
  }
}
