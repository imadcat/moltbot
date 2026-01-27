/**
 * Tests for atomic fact extraction
 */

import { describe, it, expect } from "vitest";
import type { ConversationWindow } from "./atomic-fact-types.js";
import { DEFAULT_COMPRESSION_CONFIG } from "./atomic-fact-types.js";
import {
  extractAtomicFacts,
  deduplicateAtomicFacts,
  calculateExtractionStats,
  extractAtomicFactsBatch,
  type LLMExtractFunction,
} from "./atomic-fact-extractor.js";

describe("AtomicFactExtractor", () => {
  const mockLLM: LLMExtractFunction = async (prompt: string) => {
    // Mock LLM that returns structured facts
    return JSON.stringify({
      facts: [
        {
          statement: "Alice joined Acme Corporation as a software engineer on January 15, 2024.",
          keywords: ["Alice", "Acme Corporation", "software engineer", "hire"],
          persons: ["Alice"],
          entities: ["Acme Corporation"],
          topic: "employment",
          timestamp: "2024-01-15T00:00:00Z",
          confidence: 0.95,
        },
        {
          statement: "Bob reported that the Q1 revenue target was $500,000.",
          keywords: ["Bob", "Q1", "revenue", "target"],
          persons: ["Bob"],
          entities: [],
          topic: "business metrics",
          confidence: 0.9,
        },
      ],
    });
  };

  const testWindow: ConversationWindow = {
    id: "test_window_1",
    turns: [
      { speaker: "Alice", content: "I just started at Acme!" },
      { speaker: "Bob", content: "Congrats! When did you join?" },
      { speaker: "Alice", content: "Last Monday, Jan 15th." },
      { speaker: "Bob", content: "Our Q1 target is $500k in revenue." },
    ],
    startIndex: 0,
    endIndex: 3,
    shouldProcess: true,
  };

  describe("extractAtomicFacts", () => {
    it("should extract atomic facts from conversation window", async () => {
      const facts = await extractAtomicFacts(testWindow, mockLLM, DEFAULT_COMPRESSION_CONFIG);

      expect(facts).toBeDefined();
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0]).toHaveProperty("id");
      expect(facts[0]).toHaveProperty("statement");
      expect(facts[0]).toHaveProperty("keywords");
      expect(facts[0]).toHaveProperty("confidence");
    });

    it("should filter facts below minimum confidence", async () => {
      const lowConfidenceLLM: LLMExtractFunction = async () => {
        return JSON.stringify({
          facts: [
            {
              statement: "Some uncertain fact",
              keywords: ["test"],
              persons: [],
              entities: [],
              confidence: 0.3, // Below default threshold of 0.7
            },
          ],
        });
      };

      const facts = await extractAtomicFacts(testWindow, lowConfidenceLLM, DEFAULT_COMPRESSION_CONFIG);

      expect(facts.length).toBe(0);
    });

    it("should limit facts per window based on config", async () => {
      const manyFactsLLM: LLMExtractFunction = async () => {
        const facts = Array.from({ length: 30 }, (_, i) => ({
          statement: `Fact ${i}`,
          keywords: [`fact${i}`],
          persons: [],
          entities: [],
          confidence: 0.9,
        }));
        return JSON.stringify({ facts });
      };

      const config = { ...DEFAULT_COMPRESSION_CONFIG, maxFactsPerWindow: 10 };
      const facts = await extractAtomicFacts(testWindow, manyFactsLLM, config);

      expect(facts.length).toBeLessThanOrEqual(10);
    });

    it("should handle markdown-wrapped JSON responses", async () => {
      const markdownLLM: LLMExtractFunction = async () => {
        return `\`\`\`json
{
  "facts": [{
    "statement": "Test fact",
    "keywords": ["test"],
    "persons": [],
    "entities": [],
    "confidence": 0.8
  }]
}
\`\`\``;
      };

      const facts = await extractAtomicFacts(testWindow, markdownLLM, DEFAULT_COMPRESSION_CONFIG);

      expect(facts.length).toBe(1);
      expect(facts[0].statement).toBe("Test fact");
    });

    it("should throw error for invalid JSON response", async () => {
      const invalidLLM: LLMExtractFunction = async () => {
        return "This is not JSON";
      };

      await expect(
        extractAtomicFacts(testWindow, invalidLLM, DEFAULT_COMPRESSION_CONFIG),
      ).rejects.toThrow();
    });

    it("should set correct metadata on extracted facts", async () => {
      const facts = await extractAtomicFacts(testWindow, mockLLM, DEFAULT_COMPRESSION_CONFIG);

      expect(facts[0].sourceWindowId).toBe(testWindow.id);
      expect(facts[0].level).toBe(0); // Atomic level
      expect(facts[0].extractedAt).toBeGreaterThan(0);
      expect(facts[0].id).toBeDefined();
    });
  });

  describe("extractAtomicFactsBatch", () => {
    it("should process multiple windows in parallel", async () => {
      const windows: ConversationWindow[] = [
        { ...testWindow, id: "window_1" },
        { ...testWindow, id: "window_2" },
        { ...testWindow, id: "window_3" },
      ];

      const facts = await extractAtomicFactsBatch(windows, mockLLM, DEFAULT_COMPRESSION_CONFIG);

      // Should get facts from all windows (2 facts per window)
      expect(facts.length).toBe(6);
    });

    it("should respect parallel worker limit", async () => {
      let concurrentCalls = 0;
      let maxConcurrent = 0;

      const trackingLLM: LLMExtractFunction = async () => {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);

        await new Promise((resolve) => setTimeout(resolve, 10));

        concurrentCalls--;
        return JSON.stringify({ facts: [] });
      };

      const windows: ConversationWindow[] = Array.from({ length: 10 }, (_, i) => ({
        ...testWindow,
        id: `window_${i}`,
      }));

      const config = { ...DEFAULT_COMPRESSION_CONFIG, maxParallelWorkers: 2 };
      await extractAtomicFactsBatch(windows, trackingLLM, config);

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe("deduplicateAtomicFacts", () => {
    it("should remove duplicate facts", () => {
      const facts = [
        {
          id: "1",
          statement: "Alice works at Acme Corp",
          keywords: ["Alice", "Acme"],
          persons: ["Alice"],
          entities: ["Acme Corp"],
          confidence: 0.9,
          extractedAt: Date.now(),
          level: 0,
        },
        {
          id: "2",
          statement: "Alice works at Acme Corp", // Exact duplicate
          keywords: ["Alice", "Acme"],
          persons: ["Alice"],
          entities: ["Acme Corp"],
          confidence: 0.9,
          extractedAt: Date.now(),
          level: 0,
        },
        {
          id: "3",
          statement: "Bob works at Tech Inc",
          keywords: ["Bob", "Tech"],
          persons: ["Bob"],
          entities: ["Tech Inc"],
          confidence: 0.9,
          extractedAt: Date.now(),
          level: 0,
        },
      ];

      const unique = deduplicateAtomicFacts(facts);

      expect(unique.length).toBe(2);
      expect(unique[0].statement).toBe("Alice works at Acme Corp");
      expect(unique[1].statement).toBe("Bob works at Tech Inc");
    });

    it("should handle case-insensitive duplicates", () => {
      const facts = [
        {
          id: "1",
          statement: "Alice works at Acme Corp",
          keywords: [],
          persons: ["Alice"],
          entities: ["Acme Corp"],
          confidence: 0.9,
          extractedAt: Date.now(),
          level: 0,
        },
        {
          id: "2",
          statement: "ALICE WORKS AT ACME CORP", // Different case
          keywords: [],
          persons: ["Alice"],
          entities: ["Acme Corp"],
          confidence: 0.9,
          extractedAt: Date.now(),
          level: 0,
        },
      ];

      const unique = deduplicateAtomicFacts(facts);

      expect(unique.length).toBe(1);
    });
  });

  describe("calculateExtractionStats", () => {
    it("should calculate statistics for extracted facts", () => {
      const facts = [
        {
          id: "1",
          statement: "Fact 1",
          keywords: [],
          persons: ["Alice", "Bob"],
          entities: ["Acme Corp"],
          topic: "employment",
          timestamp: "2024-01-15T00:00:00Z",
          location: "New York",
          confidence: 0.9,
          extractedAt: Date.now(),
          level: 0,
        },
        {
          id: "2",
          statement: "Fact 2",
          keywords: [],
          persons: ["Charlie"],
          entities: ["Tech Inc", "Data Corp"],
          topic: "employment",
          confidence: 0.8,
          extractedAt: Date.now(),
          level: 0,
        },
      ];

      const stats = calculateExtractionStats(facts);

      expect(stats.totalFacts).toBe(2);
      expect(stats.avgConfidence).toBe(0.85);
      expect(stats.totalPersons).toBe(3); // Alice, Bob, Charlie
      expect(stats.totalEntities).toBe(3); // Acme Corp, Tech Inc, Data Corp
      expect(stats.factsWithTimestamp).toBe(1);
      expect(stats.factsWithLocation).toBe(1);
      expect(stats.topicDistribution).toEqual({ employment: 2 });
    });

    it("should handle empty facts array", () => {
      const stats = calculateExtractionStats([]);

      expect(stats.totalFacts).toBe(0);
      expect(stats.avgConfidence).toBe(0);
      expect(stats.totalPersons).toBe(0);
      expect(stats.totalEntities).toBe(0);
    });
  });
});
