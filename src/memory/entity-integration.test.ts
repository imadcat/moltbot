/**
 * Tests for entity extraction integration examples
 */

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, beforeEach } from "vitest";
import { EntityGraphManager } from "./entity-manager.js";
import { ensureMemoryIndexSchema } from "./memory-schema.js";
import {
  extractAndStoreEntities,
  searchEntitiesInMemory,
  buildEntitySubgraph,
} from "./entity-integration.js";

function createTestDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  ensureMemoryIndexSchema({
    db,
    embeddingCacheTable: "embedding_cache",
    ftsTable: "chunks_fts",
    ftsEnabled: false,
  });
  return db;
}

function createMockManager(db: DatabaseSync) {
  return {
    db,
  } as never;
}

describe("entity-integration", () => {
  let db: DatabaseSync;
  let mockManager: never;

  beforeEach(() => {
    db = createTestDatabase();
    mockManager = createMockManager(db);
  });

  describe("extractAndStoreEntities", () => {
    it("should extract and store entities from chunk text", async () => {
      const mockLLM = async (_prompt: string) => {
        return JSON.stringify({
          entities: [
            {
              type: "Person",
              name: "Alice",
              properties: {},
            },
          ],
          relationships: [],
        });
      };

      const result = await extractAndStoreEntities({
        manager: mockManager,
        chunkId: "chunk-1",
        chunkText: "Alice is a developer",
        config: { enabled: true },
        llmExtract: mockLLM,
      });

      expect(result.success).toBe(true);
      expect(result.entityCount).toBe(1);
      expect(result.relationshipCount).toBe(0);

      // Verify entities were stored
      const entityManager = new EntityGraphManager(db);
      const entities = entityManager.queryEntities();
      expect(entities).toHaveLength(1);
      expect(entities[0]?.name).toBe("Alice");
    });

    it("should handle extraction errors gracefully", async () => {
      const result = await extractAndStoreEntities({
        manager: mockManager,
        chunkId: "chunk-1",
        chunkText: "Some text",
        config: { enabled: true },
        // No LLM function provided
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should store relationships between entities", async () => {
      const mockLLM = async (_prompt: string) => {
        return JSON.stringify({
          entities: [
            {
              type: "Person",
              name: "Alice",
              properties: {},
            },
            {
              type: "Organization",
              name: "TechCorp",
              properties: {},
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
      };

      const result = await extractAndStoreEntities({
        manager: mockManager,
        chunkId: "chunk-1",
        chunkText: "Alice works for TechCorp",
        config: { enabled: true },
        llmExtract: mockLLM,
      });

      expect(result.success).toBe(true);
      expect(result.entityCount).toBe(2);
      expect(result.relationshipCount).toBe(1);

      // Verify relationships were stored
      const entityManager = new EntityGraphManager(db);
      const relationships = entityManager.queryRelationships();
      expect(relationships).toHaveLength(1);
      expect(relationships[0]?.type).toBe("worksFor");
    });
  });

  describe("searchEntitiesInMemory", () => {
    beforeEach(async () => {
      // Seed some test data
      const mockLLM = async (_prompt: string) => {
        return JSON.stringify({
          entities: [
            {
              type: "Person",
              name: "Alice",
              properties: {},
            },
            {
              type: "Person",
              name: "Bob",
              properties: {},
            },
            {
              type: "Organization",
              name: "TechCorp",
              properties: {},
            },
          ],
          relationships: [
            {
              type: "worksFor",
              source: "Alice",
              target: "TechCorp",
              properties: {},
            },
            {
              type: "knows",
              source: "Alice",
              target: "Bob",
              properties: {},
            },
          ],
        });
      };

      await extractAndStoreEntities({
        manager: mockManager,
        chunkId: "chunk-1",
        chunkText: "Alice works for TechCorp and knows Bob",
        config: { enabled: true },
        llmExtract: mockLLM,
      });
    });

    it("should search entities by type", async () => {
      const result = await searchEntitiesInMemory({
        manager: mockManager,
        entityType: "Person",
      });

      expect(result.success).toBe(true);
      expect(result.entities).toHaveLength(2);
      expect(result.entities.every((e) => e.type === "Person")).toBe(true);
    });

    it("should search entities by name pattern", async () => {
      const result = await searchEntitiesInMemory({
        manager: mockManager,
        namePattern: "Ali",
      });

      expect(result.success).toBe(true);
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]?.name).toBe("Alice");
    });

    it("should include relationship counts", async () => {
      const result = await searchEntitiesInMemory({
        manager: mockManager,
        entityType: "Person",
        namePattern: "Alice",
      });

      expect(result.success).toBe(true);
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]?.relatedCount).toBe(2); // worksFor + knows
    });

    it("should limit results", async () => {
      const result = await searchEntitiesInMemory({
        manager: mockManager,
        entityType: "Person",
        limit: 1,
      });

      expect(result.success).toBe(true);
      expect(result.entities).toHaveLength(1);
    });
  });

  describe("buildEntitySubgraph", () => {
    let aliceId: string;
    let bobId: string;
    let techCorpId: string;

    beforeEach(async () => {
      // Seed test data and capture entity IDs
      const entityManager = new EntityGraphManager(db);

      entityManager.storeEntityGraph({
        entities: [
          {
            id: "e1",
            type: "Person",
            name: "Alice",
            properties: {},
            extractedAt: Date.now(),
          },
          {
            id: "e2",
            type: "Person",
            name: "Bob",
            properties: {},
            extractedAt: Date.now(),
          },
          {
            id: "e3",
            type: "Organization",
            name: "TechCorp",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
        relationships: [
          {
            id: "r1",
            type: "worksFor",
            sourceEntityId: "e1",
            targetEntityId: "e3",
            properties: {},
            extractedAt: Date.now(),
          },
          {
            id: "r2",
            type: "knows",
            sourceEntityId: "e1",
            targetEntityId: "e2",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
      });

      aliceId = "e1";
      bobId = "e2";
      techCorpId = "e3";
    });

    it("should build subgraph for an entity", async () => {
      const result = await buildEntitySubgraph({
        manager: mockManager,
        entityId: aliceId,
      });

      expect(result.success).toBe(true);
      expect(result.graph).toBeDefined();
      expect(result.graph?.centerEntity.name).toBe("Alice");
      expect(result.graph?.relatedEntities).toHaveLength(2);
    });

    it("should include relationship directions", async () => {
      const result = await buildEntitySubgraph({
        manager: mockManager,
        entityId: aliceId,
      });

      expect(result.success).toBe(true);
      const related = result.graph?.relatedEntities ?? [];

      const techCorp = related.find((e) => e.name === "TechCorp");
      expect(techCorp?.direction).toBe("outgoing");
      expect(techCorp?.relationship).toBe("worksFor");

      const bob = related.find((e) => e.name === "Bob");
      expect(bob?.direction).toBe("outgoing");
      expect(bob?.relationship).toBe("knows");
    });

    it("should handle non-existent entity", async () => {
      const result = await buildEntitySubgraph({
        manager: mockManager,
        entityId: "non-existent",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should include incoming relationships", async () => {
      const result = await buildEntitySubgraph({
        manager: mockManager,
        entityId: bobId,
      });

      expect(result.success).toBe(true);
      const related = result.graph?.relatedEntities ?? [];

      const alice = related.find((e) => e.name === "Alice");
      expect(alice?.direction).toBe("incoming");
      expect(alice?.relationship).toBe("knows");
    });
  });
});
