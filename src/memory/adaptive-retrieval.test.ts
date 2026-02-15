/**
 * Tests for adaptive query-aware retrieval
 */

import { describe, it, expect } from "vitest";
import type { AtomicFact } from "./atomic-fact-types.js";
import {
  analyzeQuery,
  determineRetrievalStrategy,
  calculateRelevance,
  adaptiveRetrieve,
  calculateTokenSavings,
  DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG,
  type QueryComplexity,
} from "./adaptive-retrieval.js";

describe("AdaptiveRetrieval", () => {
  const mockFacts: AtomicFact[] = [
    {
      id: "1",
      statement: "Alice joined Acme Corporation as a software engineer on January 15, 2024.",
      keywords: ["Alice", "Acme", "software engineer", "joined"],
      persons: ["Alice"],
      entities: ["Acme Corporation"],
      topic: "employment",
      timestamp: "2024-01-15T00:00:00Z",
      confidence: 0.9,
      extractedAt: Date.now() - 1000 * 60 * 60 * 24 * 7, // 7 days ago
      level: 0,
    },
    {
      id: "2",
      statement: "Bob leads the product team at Tech Inc.",
      keywords: ["Bob", "Tech Inc", "product team", "leads"],
      persons: ["Bob"],
      entities: ["Tech Inc"],
      topic: "employment",
      timestamp: "2024-01-10T00:00:00Z",
      confidence: 0.85,
      extractedAt: Date.now() - 1000 * 60 * 60 * 24 * 30, // 30 days ago
      level: 0,
    },
    {
      id: "3",
      statement: "Alice and Bob have been collaborating on the new API project.",
      keywords: ["Alice", "Bob", "API", "project", "collaborating"],
      persons: ["Alice", "Bob"],
      entities: [],
      topic: "project",
      timestamp: "2024-01-20T00:00:00Z",
      confidence: 0.95,
      extractedAt: Date.now() - 1000 * 60 * 60 * 24 * 3, // 3 days ago
      level: 0,
    },
    {
      id: "4",
      statement:
        "Alice successfully joined Acme Corporation in engineering and is working on key projects.",
      keywords: ["Alice", "Acme", "engineering", "projects"],
      persons: ["Alice"],
      entities: ["Acme Corporation"],
      topic: "employment",
      confidence: 0.9,
      extractedAt: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
      level: 1, // Consolidated fact
    },
  ];

  describe("analyzeQuery", () => {
    it("should analyze simple query", () => {
      const analysis = analyzeQuery("Where does Alice work?");

      expect(analysis.complexity).toBe("simple");
      expect(analysis.keywords).toContain("alice");
      expect(analysis.keywords).toContain("work");
      expect(analysis.entities).toContain("Alice");
    });

    it("should analyze moderate query", () => {
      const analysis = analyzeQuery("What did Alice do at Acme Corporation last week?");

      expect(analysis.complexity).toBe("moderate");
      expect(analysis.entities).toContain("Alice");
      expect(analysis.entities).toContain("Acme");
      expect(analysis.temporal?.relative).toBe("last");
    });

    it("should analyze complex query", () => {
      const analysis = analyzeQuery("Why did Alice and Bob decide to collaborate on the API project?");

      expect(analysis.complexity).toBe("complex");
      expect(analysis.requiresReasoning).toBe(true);
      expect(analysis.keywords).toContain("why");
    });

    it("should extract keywords excluding stop words", () => {
      const analysis = analyzeQuery("What is the status of the project?");

      expect(analysis.keywords).not.toContain("what");
      expect(analysis.keywords).not.toContain("is");
      expect(analysis.keywords).not.toContain("the");
      expect(analysis.keywords).toContain("status");
      expect(analysis.keywords).toContain("project");
    });

    it("should detect entities (capitalized words)", () => {
      const analysis = analyzeQuery("Did Bob meet Charlie at Microsoft?");

      expect(analysis.entities).toContain("Bob");
      expect(analysis.entities).toContain("Charlie");
      expect(analysis.entities).toContain("Microsoft");
    });

    it("should detect temporal indicators", () => {
      const analysis = analyzeQuery("What happened recently?");

      expect(analysis.temporal).toBeDefined();
      expect(analysis.temporal?.relative).toBe("recently");
    });

    it("should detect reasoning requirements", () => {
      const queries = [
        "Why did this happen?",
        "How does this work?",
        "Explain the difference",
        "Compare Alice and Bob",
      ];

      for (const query of queries) {
        const analysis = analyzeQuery(query);
        expect(analysis.requiresReasoning).toBe(true);
      }
    });

    it("should extract topics from query", () => {
      const analysis = analyzeQuery("Tell me about the API project");

      expect(analysis.topics.length).toBeGreaterThan(0);
    });
  });

  describe("determineRetrievalStrategy", () => {
    it("should create strategy for simple query", () => {
      const analysis = analyzeQuery("Where does Alice work?");
      const strategy = determineRetrievalStrategy(analysis, DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG);

      expect(strategy.complexity).toBe("simple");
      expect(strategy.maxFacts).toBeLessThanOrEqual(5);
      expect(strategy.maxTokens).toBe(DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG.simpleQueryTokens);
    });

    it("should create strategy for moderate query", () => {
      const analysis = analyzeQuery("What did Alice do at Acme Corporation last week?");
      const strategy = determineRetrievalStrategy(analysis, DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG);

      expect(strategy.complexity).toBe("moderate");
      expect(strategy.maxFacts).toBeLessThanOrEqual(10);
      expect(strategy.maxTokens).toBe(DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG.moderateQueryTokens);
    });

    it("should create strategy for complex query", () => {
      const analysis = analyzeQuery(
        "Why did Alice and Bob decide to collaborate on the API project?",
      );
      const strategy = determineRetrievalStrategy(analysis, DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG);

      expect(strategy.complexity).toBe("complex");
      expect(strategy.maxFacts).toBeGreaterThanOrEqual(10);
      expect(strategy.maxTokens).toBe(DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG.complexQueryTokens);
      expect(strategy.preferConsolidated).toBe(false); // Need detail for reasoning
    });

    it("should configure weights based on complexity", () => {
      const simple = analyzeQuery("Alice work");
      const complex = analyzeQuery("Why did Alice decide to work there?");

      const simpleStrategy = determineRetrievalStrategy(simple, DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG);
      const complexStrategy = determineRetrievalStrategy(
        complex,
        DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG,
      );

      // Simple queries prioritize keywords more
      expect(simpleStrategy.weights.keyword).toBeGreaterThan(complexStrategy.weights.keyword);
    });
  });

  describe("calculateRelevance", () => {
    it("should score fact with keyword matches", () => {
      const analysis = analyzeQuery("Alice work Acme");
      const strategy = determineRetrievalStrategy(analysis, DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG);

      const { score, reasons } = calculateRelevance(mockFacts[0], analysis, strategy);

      expect(score).toBeGreaterThan(0);
      expect(reasons.some((r) => r.includes("Keyword"))).toBe(true);
    });

    it("should score fact with entity matches", () => {
      const analysis = analyzeQuery("What did Alice do?");
      const strategy = determineRetrievalStrategy(analysis, DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG);

      const { score, reasons } = calculateRelevance(mockFacts[0], analysis, strategy);

      expect(score).toBeGreaterThan(0);
      expect(reasons.some((r) => r.includes("Entity"))).toBe(true);
    });

    it("should score fact with topic matches", () => {
      const analysis = analyzeQuery("Tell me about employment");
      analysis.topics = ["employment"];
      const strategy = determineRetrievalStrategy(analysis, DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG);

      const { score, reasons } = calculateRelevance(mockFacts[0], analysis, strategy);

      expect(reasons.some((r) => r.includes("Topic"))).toBe(true);
    });

    it("should give higher scores to recent facts when temporal query", () => {
      const analysis = analyzeQuery("What happened recently?");
      const strategy = determineRetrievalStrategy(analysis, DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG);

      const recentScore = calculateRelevance(mockFacts[2], analysis, strategy).score; // 3 days ago
      const oldScore = calculateRelevance(mockFacts[1], analysis, strategy).score; // 30 days ago

      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it("should apply recency bonus", () => {
      const analysis = analyzeQuery("Alice");
      const strategy = determineRetrievalStrategy(analysis, DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG);

      // More recently extracted facts should score higher
      const { score } = calculateRelevance(mockFacts[3], analysis, strategy); // 1 day ago
      expect(score).toBeGreaterThan(0);
    });
  });

  describe("adaptiveRetrieve", () => {
    it("should retrieve relevant facts for simple query", () => {
      const result = adaptiveRetrieve(
        "Where does Alice work?",
        mockFacts,
        DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG,
      );

      expect(result.facts.length).toBeGreaterThan(0);
      expect(result.facts.length).toBeLessThanOrEqual(result.strategy.maxFacts);
      expect(result.totalTokens).toBeLessThanOrEqual(result.strategy.maxTokens);
    });

    it("should prioritize relevant facts", () => {
      const result = adaptiveRetrieve(
        "What did Alice do at Acme?",
        mockFacts,
        DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG,
      );

      // Top fact should mention both Alice and Acme
      const topFact = result.facts[0].fact;
      expect(
        topFact.statement.toLowerCase().includes("alice") &&
          topFact.statement.toLowerCase().includes("acme"),
      ).toBe(true);
    });

    it("should respect token budget", () => {
      const result = adaptiveRetrieve("Tell me everything", mockFacts, {
        ...DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG,
        complexQueryTokens: 100, // Very tight budget
      });

      expect(result.totalTokens).toBeLessThanOrEqual(100);
    });

    it("should prefer consolidated facts when configured", () => {
      const result = adaptiveRetrieve("Alice work", mockFacts, {
        ...DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG,
        preferConsolidated: true,
      });

      // Should include or prefer level 1 facts
      const hasConsolidated = result.facts.some((f) => f.fact.level > 0);
      expect(hasConsolidated).toBe(true);
    });

    it("should include match reasons", () => {
      const result = adaptiveRetrieve(
        "Alice Acme",
        mockFacts,
        DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG,
      );

      expect(result.facts[0].matchReasons.length).toBeGreaterThan(0);
    });

    it("should provide retrieval metadata", () => {
      const result = adaptiveRetrieve(
        "Alice work",
        mockFacts,
        DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG,
      );

      expect(result.metadata.factsRetrieved).toBe(result.facts.length);
      expect(result.metadata.factsAvailable).toBe(mockFacts.length);
      expect(result.metadata.tokenBudgetUsed).toBeGreaterThan(0);
      expect(result.metadata.tokenBudgetUsed).toBeLessThanOrEqual(100);
      expect(result.metadata.compressionAchieved).toBeGreaterThan(0);
    });

    it("should adapt to query complexity", () => {
      const simpleResult = adaptiveRetrieve(
        "Alice work",
        mockFacts,
        DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG,
      );
      const complexResult = adaptiveRetrieve(
        "Why did Alice decide to work at Acme Corporation and how does this relate to her collaboration with Bob?",
        mockFacts,
        DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG,
      );

      // Complex query should retrieve more facts
      expect(complexResult.facts.length).toBeGreaterThanOrEqual(simpleResult.facts.length);
      expect(complexResult.totalTokens).toBeGreaterThanOrEqual(simpleResult.totalTokens);
    });
  });

  describe("calculateTokenSavings", () => {
    it("should calculate token savings correctly", () => {
      const result = adaptiveRetrieve(
        "Alice work",
        mockFacts,
        DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG,
      );

      const savings = calculateTokenSavings(
        result,
        mockFacts.length,
        DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG,
      );

      expect(savings.tokensUsed).toBe(result.totalTokens);
      expect(savings.tokensIfAll).toBeGreaterThan(savings.tokensUsed);
      expect(savings.tokensSaved).toBeGreaterThan(0);
      expect(savings.percentageSaved).toBeGreaterThan(0);
      expect(savings.compressionRatio).toBeGreaterThan(1);
    });

    it("should show high compression for selective retrieval", () => {
      const config = {
        ...DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG,
        simpleQueryTokens: 200, // Very selective
      };

      const result = adaptiveRetrieve("Alice", mockFacts, config);
      const savings = calculateTokenSavings(result, mockFacts.length, config);

      expect(savings.compressionRatio).toBeGreaterThan(2); // At least 2x compression
    });
  });
});
