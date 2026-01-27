/**
 * Tests for entity extraction and Schema.org alignment
 */

import { describe, expect, it } from "vitest";
import {
  extractEntitiesFromText,
  mergeEntityGraphs,
} from "./entity-extractor.js";
import type { EntityExtractionConfig } from "./entity-types.js";

describe("entity-extractor", () => {
  describe("extractEntitiesFromText", () => {
    it("should return empty result when disabled", async () => {
      const config: EntityExtractionConfig = {
        enabled: false,
      };

      const result = await extractEntitiesFromText("John works at Acme Corp", {
        config,
      });

      expect(result.entities).toHaveLength(0);
      expect(result.relationships).toHaveLength(0);
    });

    it("should return error when LLM function not provided", async () => {
      const config: EntityExtractionConfig = {
        enabled: true,
      };

      const result = await extractEntitiesFromText("John works at Acme Corp", {
        config,
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("LLM extraction function not provided");
    });

    it("should extract entities and relationships from text", async () => {
      const config: EntityExtractionConfig = {
        enabled: true,
      };

      const mockLLM = async (_prompt: string) => {
        return JSON.stringify({
          entities: [
            {
              type: "Person",
              name: "John",
              description: "employee",
              properties: { role: "developer" },
            },
            {
              type: "Organization",
              name: "Acme Corp",
              description: "company",
              properties: { industry: "technology" },
            },
          ],
          relationships: [
            {
              type: "worksFor",
              source: "John",
              target: "Acme Corp",
              properties: {},
            },
          ],
        });
      };

      const result = await extractEntitiesFromText("John works at Acme Corp", {
        config,
        llmExtract: mockLLM,
      });

      expect(result.error).toBeUndefined();
      expect(result.entities).toHaveLength(2);
      expect(result.relationships).toHaveLength(1);

      const person = result.entities.find((e) => e.type === "Person");
      expect(person).toBeDefined();
      expect(person?.name).toBe("John");
      expect(person?.description).toBe("employee");

      const org = result.entities.find((e) => e.type === "Organization");
      expect(org).toBeDefined();
      expect(org?.name).toBe("Acme Corp");

      const rel = result.relationships[0];
      expect(rel?.type).toBe("worksFor");
    });

    it("should handle LLM response in markdown code block", async () => {
      const mockLLM = async (_prompt: string) => {
        return "```json\n" +
          JSON.stringify({
            entities: [{ type: "Person", name: "Alice", properties: {} }],
            relationships: [],
          }) +
          "\n```";
      };

      const result = await extractEntitiesFromText("Alice is here", {
        config: { enabled: true },
        llmExtract: mockLLM,
      });

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]?.name).toBe("Alice");
    });

    it("should default to Thing for invalid entity types", async () => {
      const mockLLM = async (_prompt: string) => {
        return JSON.stringify({
          entities: [{ type: "InvalidType", name: "Something", properties: {} }],
          relationships: [],
        });
      };

      const result = await extractEntitiesFromText("Something happened", {
        config: { enabled: true },
        llmExtract: mockLLM,
      });

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]?.type).toBe("Thing");
    });

    it("should skip relationships with invalid types", async () => {
      const mockLLM = async (_prompt: string) => {
        return JSON.stringify({
          entities: [
            { type: "Person", name: "Alice", properties: {} },
            { type: "Person", name: "Bob", properties: {} },
          ],
          relationships: [
            { type: "invalidRelation", source: "Alice", target: "Bob", properties: {} },
          ],
        });
      };

      const result = await extractEntitiesFromText("Alice and Bob", {
        config: { enabled: true },
        llmExtract: mockLLM,
      });

      expect(result.entities).toHaveLength(2);
      expect(result.relationships).toHaveLength(0);
    });

    it("should skip relationships with missing entities", async () => {
      const mockLLM = async (_prompt: string) => {
        return JSON.stringify({
          entities: [{ type: "Person", name: "Alice", properties: {} }],
          relationships: [
            { type: "knows", source: "Alice", target: "UnknownPerson", properties: {} },
          ],
        });
      };

      const result = await extractEntitiesFromText("Alice", {
        config: { enabled: true },
        llmExtract: mockLLM,
      });

      expect(result.entities).toHaveLength(1);
      expect(result.relationships).toHaveLength(0);
    });

    it("should limit entities per chunk", async () => {
      const config: EntityExtractionConfig = {
        enabled: true,
        maxEntitiesPerChunk: 2,
      };

      const mockLLM = async (_prompt: string) => {
        return JSON.stringify({
          entities: [
            { type: "Person", name: "Alice", properties: {} },
            { type: "Person", name: "Bob", properties: {} },
            { type: "Person", name: "Charlie", properties: {} },
          ],
          relationships: [],
        });
      };

      const result = await extractEntitiesFromText("Alice, Bob, and Charlie", {
        config,
        llmExtract: mockLLM,
      });

      expect(result.entities).toHaveLength(2);
    });

    it("should handle parsing errors gracefully", async () => {
      const mockLLM = async (_prompt: string) => {
        return "This is not JSON";
      };

      const result = await extractEntitiesFromText("Some text", {
        config: { enabled: true },
        llmExtract: mockLLM,
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Failed to parse LLM response");
    });

    it("should include source metadata when provided", async () => {
      const mockLLM = async (_prompt: string) => {
        return JSON.stringify({
          entities: [{ type: "Person", name: "Alice", properties: {} }],
          relationships: [],
        });
      };

      const result = await extractEntitiesFromText("Alice", {
        config: { enabled: true },
        llmExtract: mockLLM,
        sourceSessionFile: "session-123.jsonl",
        sourceChunkId: "chunk-456",
      });

      expect(result.entities[0]?.sourceSessionFile).toBe("session-123.jsonl");
      expect(result.entities[0]?.sourceChunkId).toBe("chunk-456");
    });
  });

  describe("mergeEntityGraphs", () => {
    it("should merge multiple entity graphs", () => {
      const graph1 = {
        entities: [
          {
            id: "e1",
            type: "Person" as const,
            name: "Alice",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
        relationships: [],
      };

      const graph2 = {
        entities: [
          {
            id: "e2",
            type: "Person" as const,
            name: "Bob",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
        relationships: [],
      };

      const merged = mergeEntityGraphs([graph1, graph2]);

      expect(merged.entities).toHaveLength(2);
    });

    it("should deduplicate entities by type and name", () => {
      const graph1 = {
        entities: [
          {
            id: "e1",
            type: "Person" as const,
            name: "Alice",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
        relationships: [],
      };

      const graph2 = {
        entities: [
          {
            id: "e2",
            type: "Person" as const,
            name: "alice",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
        relationships: [],
      };

      const merged = mergeEntityGraphs([graph1, graph2]);

      expect(merged.entities).toHaveLength(1);
    });

    it("should deduplicate relationships", () => {
      const entity1 = {
        id: "e1",
        type: "Person" as const,
        name: "Alice",
        properties: {},
        extractedAt: Date.now(),
      };

      const entity2 = {
        id: "e2",
        type: "Person" as const,
        name: "Bob",
        properties: {},
        extractedAt: Date.now(),
      };

      const graph1 = {
        entities: [entity1, entity2],
        relationships: [
          {
            id: "r1",
            type: "knows" as const,
            sourceEntityId: "e1",
            targetEntityId: "e2",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
      };

      const graph2 = {
        entities: [entity1, entity2],
        relationships: [
          {
            id: "r2",
            type: "knows" as const,
            sourceEntityId: "e1",
            targetEntityId: "e2",
            properties: {},
            extractedAt: Date.now(),
          },
        ],
      };

      const merged = mergeEntityGraphs([graph1, graph2]);

      expect(merged.relationships).toHaveLength(1);
    });
  });
});
