/**
 * Tests for recursive memory consolidation
 */

import { describe, it, expect } from "vitest";
import type { AtomicFact } from "./atomic-fact-types.js";
import {
  calculateFactSimilarity,
  clusterAtomicFacts,
  consolidateCluster,
  recursiveConsolidation,
  calculateConsolidationStats,
  DEFAULT_CONSOLIDATION_CONFIG,
  type LLMConsolidateFunction,
  type FactCluster,
} from "./consolidation.js";

describe("Consolidation", () => {
  const mockFacts: AtomicFact[] = [
    {
      id: "1",
      statement: "Alice started working at Acme Corporation on January 15, 2024.",
      keywords: ["Alice", "Acme", "started"],
      persons: ["Alice"],
      entities: ["Acme Corporation"],
      topic: "employment",
      timestamp: "2024-01-15T00:00:00Z",
      confidence: 0.9,
      extractedAt: Date.now(),
      level: 0,
    },
    {
      id: "2",
      statement: "Alice is a software engineer at Acme Corporation.",
      keywords: ["Alice", "software engineer", "Acme"],
      persons: ["Alice"],
      entities: ["Acme Corporation"],
      topic: "employment",
      timestamp: "2024-01-16T00:00:00Z",
      confidence: 0.95,
      extractedAt: Date.now(),
      level: 0,
    },
    {
      id: "3",
      statement: "Alice received her employee badge at Acme Corporation.",
      keywords: ["Alice", "badge", "Acme"],
      persons: ["Alice"],
      entities: ["Acme Corporation"],
      topic: "employment",
      timestamp: "2024-01-17T00:00:00Z",
      confidence: 0.85,
      extractedAt: Date.now(),
      level: 0,
    },
    {
      id: "4",
      statement: "Bob works at Tech Inc as a product manager.",
      keywords: ["Bob", "Tech Inc", "product manager"],
      persons: ["Bob"],
      entities: ["Tech Inc"],
      topic: "employment",
      timestamp: "2024-01-10T00:00:00Z",
      confidence: 0.9,
      extractedAt: Date.now(),
      level: 0,
    },
  ];

  describe("calculateFactSimilarity", () => {
    it("should calculate high similarity for related facts", () => {
      const similarity = calculateFactSimilarity(
        mockFacts[0],
        mockFacts[1],
        DEFAULT_CONSOLIDATION_CONFIG,
      );

      expect(similarity).toBeGreaterThan(0.5); // Same person, entity, topic
    });

    it("should calculate low similarity for unrelated facts", () => {
      const similarity = calculateFactSimilarity(
        mockFacts[0],
        mockFacts[3],
        DEFAULT_CONSOLIDATION_CONFIG,
      );

      expect(similarity).toBeLessThan(0.5); // Different person and entity
    });

    it("should consider entity overlap", () => {
      const fact1 = { ...mockFacts[0], entities: ["Acme", "Google"] };
      const fact2 = { ...mockFacts[1], entities: ["Acme", "Microsoft"] };

      const similarity = calculateFactSimilarity(
        fact1,
        fact2,
        DEFAULT_CONSOLIDATION_CONFIG,
      );

      expect(similarity).toBeGreaterThan(0); // Some entity overlap
    });

    it("should consider person overlap", () => {
      const fact1 = { ...mockFacts[0], persons: ["Alice", "Bob"] };
      const fact2 = { ...mockFacts[1], persons: ["Alice", "Charlie"] };

      const similarity = calculateFactSimilarity(
        fact1,
        fact2,
        DEFAULT_CONSOLIDATION_CONFIG,
      );

      expect(similarity).toBeGreaterThan(0); // Some person overlap
    });

    it("should consider topic similarity", () => {
      const fact1 = { ...mockFacts[0], topic: "employment" };
      const fact2 = { ...mockFacts[1], topic: "employment" };

      const similarity = calculateFactSimilarity(
        fact1,
        fact2,
        DEFAULT_CONSOLIDATION_CONFIG,
      );

      expect(similarity).toBeGreaterThan(0); // Same topic
    });

    it("should consider temporal proximity", () => {
      const fact1 = { ...mockFacts[0], timestamp: "2024-01-15T00:00:00Z" };
      const fact2 = { ...mockFacts[1], timestamp: "2024-01-16T00:00:00Z" };

      const similarity = calculateFactSimilarity(
        fact1,
        fact2,
        DEFAULT_CONSOLIDATION_CONFIG,
      );

      expect(similarity).toBeGreaterThan(0); // Close in time
    });

    it("should penalize facts far apart in time", () => {
      const fact1 = { ...mockFacts[0], timestamp: "2024-01-01T00:00:00Z" };
      const fact2 = { ...mockFacts[1], timestamp: "2024-12-31T00:00:00Z" };

      const similarity = calculateFactSimilarity(
        fact1,
        fact2,
        DEFAULT_CONSOLIDATION_CONFIG,
      );

      // Should have lower temporal component
      const similarityNoTime = calculateFactSimilarity(
        { ...fact1, timestamp: undefined },
        { ...fact2, timestamp: undefined },
        DEFAULT_CONSOLIDATION_CONFIG,
      );

      expect(similarity).toBeLessThanOrEqual(similarityNoTime);
    });
  });

  describe("clusterAtomicFacts", () => {
    it("should cluster similar facts together", () => {
      const clusters = clusterAtomicFacts(mockFacts, DEFAULT_CONSOLIDATION_CONFIG);

      expect(clusters.length).toBeGreaterThan(0);
      expect(clusters[0].facts.length).toBeGreaterThanOrEqual(3); // Min cluster size
    });

    it("should identify common entities in clusters", () => {
      const clusters = clusterAtomicFacts(mockFacts, DEFAULT_CONSOLIDATION_CONFIG);

      const acmeCluster = clusters.find((c) =>
        c.commonEntities.some((e) => e.toLowerCase().includes("acme")),
      );

      expect(acmeCluster).toBeDefined();
      expect(acmeCluster!.facts.length).toBeGreaterThanOrEqual(3);
    });

    it("should identify common persons in clusters", () => {
      const clusters = clusterAtomicFacts(mockFacts, DEFAULT_CONSOLIDATION_CONFIG);

      const aliceCluster = clusters.find((c) =>
        c.commonPersons.some((p) => p.toLowerCase() === "alice"),
      );

      expect(aliceCluster).toBeDefined();
    });

    it("should respect minimum cluster size", () => {
      const config = { ...DEFAULT_CONSOLIDATION_CONFIG, minFactsForCluster: 5 };
      const clusters = clusterAtomicFacts(mockFacts, config);

      // Should not create clusters if not enough facts
      for (const cluster of clusters) {
        expect(cluster.facts.length).toBeGreaterThanOrEqual(5);
      }
    });

    it("should respect maximum cluster size", () => {
      const config = { ...DEFAULT_CONSOLIDATION_CONFIG, maxFactsPerCluster: 2 };
      const clusters = clusterAtomicFacts(mockFacts, config);

      for (const cluster of clusters) {
        expect(cluster.facts.length).toBeLessThanOrEqual(2);
      }
    });

    it("should calculate coherence score for clusters", () => {
      const clusters = clusterAtomicFacts(mockFacts, DEFAULT_CONSOLIDATION_CONFIG);

      for (const cluster of clusters) {
        expect(cluster.coherenceScore).toBeGreaterThanOrEqual(0);
        expect(cluster.coherenceScore).toBeLessThanOrEqual(1);
      }
    });

    it("should identify temporal range for clusters", () => {
      const clusters = clusterAtomicFacts(mockFacts, DEFAULT_CONSOLIDATION_CONFIG);

      const clusterWithTime = clusters.find((c) => c.timeRange);
      if (clusterWithTime) {
        expect(clusterWithTime.timeRange!.start).toBeDefined();
        expect(clusterWithTime.timeRange!.end).toBeDefined();
      }
    });
  });

  describe("consolidateCluster", () => {
    const mockLLM: LLMConsolidateFunction = async (facts) => {
      return `Alice joined and started working as a software engineer at Acme Corporation in January 2024.`;
    };

    it("should consolidate cluster into single higher-level fact", async () => {
      const cluster: FactCluster = {
        id: "cluster1",
        facts: [mockFacts[0], mockFacts[1], mockFacts[2]],
        topic: "employment",
        commonEntities: ["Acme Corporation"],
        commonPersons: ["Alice"],
        coherenceScore: 0.8,
        createdAt: Date.now(),
      };

      const result = await consolidateCluster(cluster, mockLLM);

      expect(result.consolidatedFact).toBeDefined();
      expect(result.consolidatedFact.level).toBe(1); // One level up from atomic (0)
      expect(result.consolidatedFact.statement).toContain("Alice");
      expect(result.consolidatedFact.statement).toContain("Acme");
    });

    it("should merge entities from all source facts", async () => {
      const cluster: FactCluster = {
        id: "cluster1",
        facts: [mockFacts[0], mockFacts[1]],
        topic: "employment",
        commonEntities: ["Acme Corporation"],
        commonPersons: ["Alice"],
        coherenceScore: 0.8,
        createdAt: Date.now(),
      };

      const result = await consolidateCluster(cluster, mockLLM);

      expect(result.consolidatedFact.entities).toContain("Acme Corporation");
    });

    it("should merge persons from all source facts", async () => {
      const cluster: FactCluster = {
        id: "cluster1",
        facts: [mockFacts[0], mockFacts[1]],
        topic: "employment",
        commonEntities: ["Acme Corporation"],
        commonPersons: ["Alice"],
        coherenceScore: 0.8,
        createdAt: Date.now(),
      };

      const result = await consolidateCluster(cluster, mockLLM);

      expect(result.consolidatedFact.persons).toContain("Alice");
    });

    it("should calculate compression ratio", async () => {
      const cluster: FactCluster = {
        id: "cluster1",
        facts: [mockFacts[0], mockFacts[1], mockFacts[2]],
        topic: "employment",
        commonEntities: ["Acme Corporation"],
        commonPersons: ["Alice"],
        coherenceScore: 0.8,
        createdAt: Date.now(),
      };

      const result = await consolidateCluster(cluster, mockLLM);

      expect(result.metadata.compressionRatio).toBeGreaterThan(1); // Should compress
      expect(result.metadata.factsConsolidated).toBe(3);
    });

    it("should average confidence from source facts", async () => {
      const cluster: FactCluster = {
        id: "cluster1",
        facts: [mockFacts[0], mockFacts[1], mockFacts[2]],
        topic: "employment",
        commonEntities: ["Acme Corporation"],
        commonPersons: ["Alice"],
        coherenceScore: 0.8,
        createdAt: Date.now(),
      };

      const result = await consolidateCluster(cluster, mockLLM);

      const expectedAvg =
        (mockFacts[0].confidence + mockFacts[1].confidence + mockFacts[2].confidence) / 3;

      expect(result.consolidatedFact.confidence).toBeCloseTo(expectedAvg);
    });
  });

  describe("recursiveConsolidation", () => {
    const mockLLM: LLMConsolidateFunction = async (facts) => {
      return `Consolidated: ${facts.length} facts about ${facts[0].persons[0]}`;
    };

    it("should perform recursive consolidation", async () => {
      const result = await recursiveConsolidation(mockFacts, mockLLM, DEFAULT_CONSOLIDATION_CONFIG);

      expect(result.length).toBeGreaterThan(mockFacts.length); // Should add consolidated facts
    });

    it("should create hierarchical levels", async () => {
      const result = await recursiveConsolidation(mockFacts, mockLLM, DEFAULT_CONSOLIDATION_CONFIG);

      const levels = new Set(result.map((f) => f.level));
      expect(levels.size).toBeGreaterThan(1); // Should have multiple levels
    });

    it("should respect max consolidation level", async () => {
      const config = { ...DEFAULT_CONSOLIDATION_CONFIG, maxConsolidationLevel: 2 };
      const result = await recursiveConsolidation(mockFacts, mockLLM, config);

      const maxLevel = Math.max(...result.map((f) => f.level));
      expect(maxLevel).toBeLessThanOrEqual(2);
    });

    it("should stop when not enough facts to cluster", async () => {
      const fewFacts = [mockFacts[0], mockFacts[1]];
      const result = await recursiveConsolidation(fewFacts, mockLLM, DEFAULT_CONSOLIDATION_CONFIG);

      // Should not create many new facts if input is small
      expect(result.length).toBe(fewFacts.length); // No consolidation
    });
  });

  describe("calculateConsolidationStats", () => {
    it("should calculate consolidation statistics", () => {
      const original = mockFacts;
      const consolidated = [
        ...mockFacts,
        {
          id: "5",
          statement: "Consolidated fact",
          keywords: [],
          persons: ["Alice"],
          entities: ["Acme"],
          confidence: 0.9,
          extractedAt: Date.now(),
          level: 1,
        },
      ];

      const stats = calculateConsolidationStats(original, consolidated);

      expect(stats.originalCount).toBe(4);
      expect(stats.consolidatedCount).toBe(1);
      expect(stats.totalCount).toBe(5);
      expect(stats.maxLevel).toBe(1);
    });

    it("should handle no consolidation", () => {
      const stats = calculateConsolidationStats(mockFacts, mockFacts);

      expect(stats.consolidatedCount).toBe(0);
      expect(stats.totalCount).toBe(mockFacts.length);
    });
  });
});
