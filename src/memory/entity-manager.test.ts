/**
 * Tests for entity graph manager
 */

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, beforeEach } from "vitest";
import { EntityGraphManager } from "./entity-manager.js";
import { ensureMemoryIndexSchema } from "./memory-schema.js";
import type { Entity, Relationship } from "./entity-types.js";

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

describe("entity-manager", () => {
  let db: DatabaseSync;
  let manager: EntityGraphManager;

  beforeEach(() => {
    db = createTestDatabase();
    manager = new EntityGraphManager(db);
  });

  describe("storeEntity and queryEntities", () => {
    it("should store and retrieve a single entity", () => {
      const entity: Entity = {
        id: "e1",
        type: "Person",
        name: "Alice",
        description: "Test person",
        properties: { age: 30 },
        extractedAt: Date.now(),
      };

      manager.storeEntity(entity);

      const entities = manager.queryEntities();
      expect(entities).toHaveLength(1);
      expect(entities[0]?.name).toBe("Alice");
      expect(entities[0]?.type).toBe("Person");
    });

    it("should store multiple entities", () => {
      const entities: Entity[] = [
        {
          id: "e1",
          type: "Person",
          name: "Alice",
          properties: {},
          extractedAt: Date.now(),
        },
        {
          id: "e2",
          type: "Organization",
          name: "Acme Corp",
          properties: {},
          extractedAt: Date.now(),
        },
      ];

      manager.storeEntities(entities);

      const stored = manager.queryEntities();
      expect(stored).toHaveLength(2);
    });

    it("should replace entity with same id", () => {
      const entity1: Entity = {
        id: "e1",
        type: "Person",
        name: "Alice",
        properties: {},
        extractedAt: Date.now(),
      };

      const entity2: Entity = {
        id: "e1",
        type: "Person",
        name: "Alice Updated",
        properties: {},
        extractedAt: Date.now(),
      };

      manager.storeEntity(entity1);
      manager.storeEntity(entity2);

      const entities = manager.queryEntities();
      expect(entities).toHaveLength(1);
      expect(entities[0]?.name).toBe("Alice Updated");
    });

    it("should filter entities by type", () => {
      manager.storeEntities([
        {
          id: "e1",
          type: "Person",
          name: "Alice",
          properties: {},
          extractedAt: Date.now(),
        },
        {
          id: "e2",
          type: "Organization",
          name: "Acme Corp",
          properties: {},
          extractedAt: Date.now(),
        },
      ]);

      const persons = manager.queryEntities({ type: "Person" });
      expect(persons).toHaveLength(1);
      expect(persons[0]?.type).toBe("Person");
    });

    it("should filter entities by name", () => {
      manager.storeEntities([
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
      ]);

      const result = manager.queryEntities({ name: "lic" });
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("Alice");
    });

    it("should limit query results", () => {
      manager.storeEntities([
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
          type: "Person",
          name: "Charlie",
          properties: {},
          extractedAt: Date.now(),
        },
      ]);

      const result = manager.queryEntities({ limit: 2 });
      expect(result).toHaveLength(2);
    });
  });

  describe("storeRelationship and queryRelationships", () => {
    beforeEach(() => {
      manager.storeEntities([
        {
          id: "e1",
          type: "Person",
          name: "Alice",
          properties: {},
          extractedAt: Date.now(),
        },
        {
          id: "e2",
          type: "Organization",
          name: "Acme Corp",
          properties: {},
          extractedAt: Date.now(),
        },
      ]);
    });

    it("should store and retrieve a relationship", () => {
      const relationship: Relationship = {
        id: "r1",
        type: "worksFor",
        sourceEntityId: "e1",
        targetEntityId: "e2",
        properties: {},
        extractedAt: Date.now(),
      };

      manager.storeRelationship(relationship);

      const relationships = manager.queryRelationships();
      expect(relationships).toHaveLength(1);
      expect(relationships[0]?.type).toBe("worksFor");
    });

    it("should filter relationships by type", () => {
      manager.storeRelationships([
        {
          id: "r1",
          type: "worksFor",
          sourceEntityId: "e1",
          targetEntityId: "e2",
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
      ]);

      const result = manager.queryRelationships({ type: "knows" });
      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe("knows");
    });

    it("should filter relationships by source entity", () => {
      manager.storeRelationships([
        {
          id: "r1",
          type: "worksFor",
          sourceEntityId: "e1",
          targetEntityId: "e2",
          properties: {},
          extractedAt: Date.now(),
        },
        {
          id: "r2",
          type: "worksFor",
          sourceEntityId: "e2",
          targetEntityId: "e1",
          properties: {},
          extractedAt: Date.now(),
        },
      ]);

      const result = manager.queryRelationships({ sourceEntityId: "e1" });
      expect(result).toHaveLength(1);
      expect(result[0]?.sourceEntityId).toBe("e1");
    });

    it("should filter relationships by target entity", () => {
      manager.storeRelationships([
        {
          id: "r1",
          type: "worksFor",
          sourceEntityId: "e1",
          targetEntityId: "e2",
          properties: {},
          extractedAt: Date.now(),
        },
      ]);

      const result = manager.queryRelationships({ targetEntityId: "e2" });
      expect(result).toHaveLength(1);
      expect(result[0]?.targetEntityId).toBe("e2");
    });
  });

  describe("storeEntityGraph", () => {
    it("should store entity graph with entities and relationships", () => {
      const graph = {
        entities: [
          {
            id: "e1",
            type: "Person" as const,
            name: "Alice",
            properties: {},
            extractedAt: Date.now(),
          },
          {
            id: "e2",
            type: "Organization" as const,
            name: "Acme Corp",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
        relationships: [
          {
            id: "r1",
            type: "worksFor" as const,
            sourceEntityId: "e1",
            targetEntityId: "e2",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
      };

      manager.storeEntityGraph(graph);

      const entities = manager.queryEntities();
      const relationships = manager.queryRelationships();

      expect(entities).toHaveLength(2);
      expect(relationships).toHaveLength(1);
    });
  });

  describe("getEntityGraph", () => {
    beforeEach(() => {
      manager.storeEntityGraph({
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
            type: "Organization",
            name: "Acme Corp",
            properties: {},
            extractedAt: Date.now(),
          },
          {
            id: "e3",
            type: "Person",
            name: "Bob",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
        relationships: [
          {
            id: "r1",
            type: "worksFor",
            sourceEntityId: "e1",
            targetEntityId: "e2",
            properties: {},
            extractedAt: Date.now(),
          },
          {
            id: "r2",
            type: "knows",
            sourceEntityId: "e1",
            targetEntityId: "e3",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
      });
    });

    it("should get entity graph for a specific entity", () => {
      const graph = manager.getEntityGraph("e1");

      expect(graph.entities).toHaveLength(3);
      expect(graph.relationships).toHaveLength(2);
    });

    it("should return empty graph for non-existent entity", () => {
      const graph = manager.getEntityGraph("non-existent");

      expect(graph.entities).toHaveLength(0);
      expect(graph.relationships).toHaveLength(0);
    });
  });

  describe("getStats", () => {
    it("should return statistics about entities and relationships", () => {
      manager.storeEntityGraph({
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
            type: "Organization",
            name: "Acme Corp",
            properties: {},
            extractedAt: Date.now(),
          },
          {
            id: "e3",
            type: "Person",
            name: "Bob",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
        relationships: [
          {
            id: "r1",
            type: "worksFor",
            sourceEntityId: "e1",
            targetEntityId: "e2",
            properties: {},
            extractedAt: Date.now(),
          },
          {
            id: "r2",
            type: "knows",
            sourceEntityId: "e1",
            targetEntityId: "e3",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
      });

      const stats = manager.getStats();

      expect(stats.totalEntities).toBe(3);
      expect(stats.totalRelationships).toBe(2);
      expect(stats.entityTypeBreakdown.Person).toBe(2);
      expect(stats.entityTypeBreakdown.Organization).toBe(1);
      expect(stats.relationshipTypeBreakdown.worksFor).toBe(1);
      expect(stats.relationshipTypeBreakdown.knows).toBe(1);
    });
  });

  describe("clear", () => {
    it("should clear all entities and relationships", () => {
      manager.storeEntityGraph({
        entities: [
          {
            id: "e1",
            type: "Person",
            name: "Alice",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
        relationships: [
          {
            id: "r1",
            type: "knows",
            sourceEntityId: "e1",
            targetEntityId: "e1",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
      });

      manager.clear();

      const entities = manager.queryEntities();
      const relationships = manager.queryRelationships();

      expect(entities).toHaveLength(0);
      expect(relationships).toHaveLength(0);
    });
  });
});
