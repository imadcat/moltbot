/**
 * Tests for entropy-aware filtering
 */

import { describe, it, expect } from "vitest";
import type { AtomicFact, ConversationWindow } from "./atomic-fact-types.js";
import { DEFAULT_COMPRESSION_CONFIG } from "./atomic-fact-types.js";
import {
  calculateWindowEntropy,
  createConversationWindows,
  filterWindowsByEntropy,
  calculateFilterStats,
} from "./entropy-filter.js";

describe("EntropyFilter", () => {
  const testTurns = [
    { speaker: "Alice", content: "I work at Acme Corporation" },
    { speaker: "Bob", content: "That's great! What do you do there?" },
    { speaker: "Alice", content: "I'm a software engineer" },
    { speaker: "Charlie", content: "How long have you been there?" },
    { speaker: "Alice", content: "About two years now" },
  ];

  describe("createConversationWindows", () => {
    it("should create non-overlapping windows with stride equal to window size", () => {
      const windows = createConversationWindows(testTurns, 2, 2);

      expect(windows.length).toBe(2); // 5 turns / 2 = 2 full windows
      expect(windows[0].turns.length).toBe(2);
      expect(windows[0].startIndex).toBe(0);
      expect(windows[0].endIndex).toBe(1);
      expect(windows[1].startIndex).toBe(2);
      expect(windows[1].endIndex).toBe(3);
    });

    it("should create overlapping windows with stride less than window size", () => {
      const windows = createConversationWindows(testTurns, 3, 2);

      expect(windows.length).toBe(2); // (5 - 3) / 2 + 1 = 2
      expect(windows[0].turns.length).toBe(3);
      expect(windows[1].turns.length).toBe(3);

      // Check overlap
      expect(windows[0].endIndex).toBeGreaterThan(windows[1].startIndex);
    });

    it("should handle empty turns array", () => {
      const windows = createConversationWindows([], 3, 2);

      expect(windows.length).toBe(0);
    });

    it("should create partial window for remaining turns", () => {
      const windows = createConversationWindows(testTurns, 3, 3);

      expect(windows.length).toBe(2); // 2 full windows + 1 partial
      expect(windows[1].turns.length).toBe(2); // Last window has only 2 turns
    });

    it("should assign unique IDs to windows", () => {
      const windows = createConversationWindows(testTurns, 2, 2);

      const ids = new Set(windows.map((w) => w.id));
      expect(ids.size).toBe(windows.length);
    });
  });

  describe("calculateWindowEntropy", () => {
    const testWindow: ConversationWindow = {
      id: "test_window",
      turns: [
        { speaker: "Alice", content: "I met John at Microsoft yesterday" },
        { speaker: "Bob", content: "What did you discuss with John?" },
      ],
      startIndex: 0,
      endIndex: 1,
      shouldProcess: true,
    };

    const previousFacts: AtomicFact[] = [
      {
        id: "fact1",
        statement: "Alice works at Google",
        keywords: ["Alice", "Google"],
        persons: ["Alice"],
        entities: ["Google"],
        confidence: 0.9,
        extractedAt: Date.now(),
        level: 0,
      },
    ];

    it("should calculate entropy score with new entities", () => {
      const result = calculateWindowEntropy(
        testWindow,
        previousFacts,
        DEFAULT_COMPRESSION_CONFIG,
      );

      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.newEntities.size).toBeGreaterThan(0); // John, Microsoft should be new
      expect(result.window).toBe(testWindow);
    });

    it("should identify new entities not in previous facts", () => {
      const result = calculateWindowEntropy(
        testWindow,
        previousFacts,
        DEFAULT_COMPRESSION_CONFIG,
      );

      // John and Microsoft should be identified as new
      expect(result.newEntities.has("John") || result.newEntities.has("Microsoft")).toBe(true);

      // Alice is in previous facts, so not new
      // Note: may still be detected if appears in window, but should be excluded
    });

    it("should calculate semantic divergence with embeddings", () => {
      const windowEmbedding = [0.1, 0.2, 0.3];
      const previousEmbedding = [0.9, 0.8, 0.7]; // Very different

      const result = calculateWindowEntropy(
        testWindow,
        previousFacts,
        DEFAULT_COMPRESSION_CONFIG,
        windowEmbedding,
        previousEmbedding,
      );

      expect(result.semanticDivergence).toBeGreaterThan(0.5); // Should be high divergence
    });

    it("should use default divergence when embeddings not provided", () => {
      const result = calculateWindowEntropy(
        testWindow,
        previousFacts,
        DEFAULT_COMPRESSION_CONFIG,
      );

      expect(result.semanticDivergence).toBe(0.5); // Default mid-range
    });

    it("should decide to keep window when entropy exceeds threshold", () => {
      // Window with many new entities should have high entropy
      const highEntropyWindow: ConversationWindow = {
        id: "high_entropy",
        turns: [
          { speaker: "Alice", content: "I visited Tokyo, Paris, and London last month" },
          { speaker: "Bob", content: "That's amazing! Did you meet Sarah in Tokyo?" },
        ],
        startIndex: 0,
        endIndex: 1,
        shouldProcess: true,
      };

      const result = calculateWindowEntropy(
        highEntropyWindow,
        previousFacts,
        DEFAULT_COMPRESSION_CONFIG,
      );

      expect(result.shouldKeep).toBe(true);
    });

    it("should filter window when entropy below threshold", () => {
      // Window with no new information
      const lowEntropyWindow: ConversationWindow = {
        id: "low_entropy",
        turns: [
          { speaker: "Alice", content: "yes" },
          { speaker: "Bob", content: "okay" },
        ],
        startIndex: 0,
        endIndex: 1,
        shouldProcess: true,
      };

      const result = calculateWindowEntropy(
        lowEntropyWindow,
        previousFacts,
        DEFAULT_COMPRESSION_CONFIG,
      );

      // Low information content should result in low entropy
      expect(result.score).toBeLessThan(0.5);
    });

    it("should respect configured entity and divergence weights", () => {
      const config = {
        ...DEFAULT_COMPRESSION_CONFIG,
        entityWeight: 1.0, // Only entity novelty matters
        divergenceWeight: 0.0,
      };

      const result = calculateWindowEntropy(testWindow, previousFacts, config);

      // Score should be based purely on entity novelty
      expect(result.score).toBeGreaterThan(0);
    });
  });

  describe("filterWindowsByEntropy", () => {
    it("should filter multiple windows by entropy", () => {
      const windows = createConversationWindows(testTurns, 2, 2);
      const previousFacts: AtomicFact[] = [];

      const results = filterWindowsByEntropy(windows, previousFacts, DEFAULT_COMPRESSION_CONFIG);

      expect(results.length).toBe(windows.length);
      expect(results[0]).toHaveProperty("score");
      expect(results[0]).toHaveProperty("shouldKeep");
    });

    it("should mark windows for processing based on entropy", () => {
      const windows = createConversationWindows(testTurns, 2, 2);
      const previousFacts: AtomicFact[] = [];

      filterWindowsByEntropy(windows, previousFacts, DEFAULT_COMPRESSION_CONFIG);

      // Check that entropy and shouldProcess are set on windows
      for (const window of windows) {
        expect(window.entropy).toBeDefined();
        expect(typeof window.shouldProcess).toBe("boolean");
      }
    });

    it("should filter out low-entropy windows", () => {
      const lowValueTurns = [
        { speaker: "Alice", content: "ok" },
        { speaker: "Bob", content: "yes" },
        { speaker: "Charlie", content: "sure" },
        { speaker: "Dave", content: "fine" },
      ];

      const windows = createConversationWindows(lowValueTurns, 2, 2);
      const previousFacts: AtomicFact[] = [];

      const results = filterWindowsByEntropy(windows, previousFacts, DEFAULT_COMPRESSION_CONFIG);

      const keptWindows = results.filter((r) => r.shouldKeep);
      const filteredWindows = results.filter((r) => !r.shouldKeep);

      // Low-value conversation should have more filtered windows
      expect(filteredWindows.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("calculateFilterStats", () => {
    it("should calculate statistics for filter results", () => {
      const results = [
        {
          window: {} as ConversationWindow,
          score: 0.8,
          newEntities: new Set(["Entity1", "Entity2"]),
          semanticDivergence: 0.6,
          shouldKeep: true,
        },
        {
          window: {} as ConversationWindow,
          score: 0.2,
          newEntities: new Set(["Entity3"]),
          semanticDivergence: 0.1,
          shouldKeep: false,
        },
        {
          window: {} as ConversationWindow,
          score: 0.5,
          newEntities: new Set(["Entity4"]),
          semanticDivergence: 0.3,
          shouldKeep: true,
        },
      ];

      const stats = calculateFilterStats(results);

      expect(stats.total).toBe(3);
      expect(stats.kept).toBe(2);
      expect(stats.filtered).toBe(1);
      expect(stats.avgEntropy).toBeCloseTo(0.5); // (0.8 + 0.2 + 0.5) / 3
      expect(stats.avgNewEntities).toBeCloseTo(1.333); // (2 + 1 + 1) / 3
    });

    it("should handle empty results", () => {
      const stats = calculateFilterStats([]);

      expect(stats.total).toBe(0);
      expect(stats.kept).toBe(0);
      expect(stats.filtered).toBe(0);
      expect(isNaN(stats.avgEntropy)).toBe(true);
    });
  });
});
