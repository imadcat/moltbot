/**
 * Entropy-aware filtering for SimpleMem semantic compression
 * 
 * Implements information content scoring to filter redundant conversation windows
 * Based on SimpleMem research: https://arxiv.org/abs/2601.02553
 */

import type {
  AtomicFact,
  ConversationWindow,
  EntropyFilterResult,
  SemanticCompressionConfig,
} from "./atomic-fact-types.js";

/**
 * Calculate entropy score for a conversation window
 * 
 * Score formula: H(W_t) = α * |E_new|/|W_t| + (1-α) * [1 - cos(E(W_t), E(H_prev))]
 * 
 * Where:
 * - E_new: new entities not seen in previous memories
 * - |W_t|: window size in tokens/chars
 * - E(W_t): embedding of current window
 * - E(H_prev): embedding of previous memory context
 * - α: weight for entity novelty vs semantic divergence
 * 
 * @param window - Conversation window to score
 * @param previousFacts - Previously stored atomic facts for context
 * @param config - Compression configuration
 * @param windowEmbedding - Optional embedding vector for the window
 * @param previousContextEmbedding - Optional embedding vector for previous context
 * @returns Entropy filter result with score and decision
 */
export function calculateWindowEntropy(
  window: ConversationWindow,
  previousFacts: AtomicFact[],
  config: SemanticCompressionConfig,
  windowEmbedding?: number[],
  previousContextEmbedding?: number[],
): EntropyFilterResult {
  // Extract entities from window
  const windowEntities = extractEntitiesFromWindow(window);

  // Find new entities not in previous facts
  const previousEntities = new Set<string>();
  for (const fact of previousFacts) {
    for (const entity of fact.entities) {
      previousEntities.add(entity.toLowerCase());
    }
    for (const person of fact.persons) {
      previousEntities.add(person.toLowerCase());
    }
  }

  const newEntities = new Set<string>();
  for (const entity of windowEntities) {
    if (!previousEntities.has(entity.toLowerCase())) {
      newEntities.add(entity);
    }
  }

  // Calculate entity novelty score
  const windowSize = window.turns.reduce((sum, turn) => sum + turn.content.length, 0);
  const entityNoveltyScore = windowSize > 0 ? newEntities.size / Math.sqrt(windowSize) : 0;

  // Calculate semantic divergence score
  let semanticDivergence = 0.5; // Default mid-range if no embeddings
  if (windowEmbedding && previousContextEmbedding) {
    const cosineSimilarity = calculateCosineSimilarity(
      windowEmbedding,
      previousContextEmbedding,
    );
    semanticDivergence = 1 - cosineSimilarity;
  }

  // Combined entropy score with configurable weights
  const alpha = config.entityWeight;
  const entropyScore = alpha * entityNoveltyScore + (1 - alpha) * semanticDivergence;

  // Decision: keep if entropy exceeds threshold
  const shouldKeep = entropyScore >= config.entropyThreshold;

  return {
    window,
    score: entropyScore,
    newEntities,
    semanticDivergence,
    shouldKeep,
  };
}

/**
 * Extract entities from a conversation window
 * Simple regex-based extraction for filtering (proper NER happens during fact extraction)
 */
function extractEntitiesFromWindow(window: ConversationWindow): Set<string> {
  const entities = new Set<string>();

  for (const turn of window.turns) {
    // Extract capitalized words as potential entities
    const matches = turn.content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
    if (matches) {
      for (const match of matches) {
        entities.add(match);
      }
    }

    // Extract mentions of the speaker
    if (turn.speaker) {
      entities.add(turn.speaker);
    }
  }

  return entities;
}

/**
 * Calculate cosine similarity between two embedding vectors
 */
function calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length || vec1.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  const magnitude1 = Math.sqrt(norm1);
  const magnitude2 = Math.sqrt(norm2);

  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0;
  }

  return dotProduct / (magnitude1 * magnitude2);
}

/**
 * Create overlapping conversation windows from turns
 * 
 * @param turns - Array of conversation turns
 * @param windowSize - Number of turns per window
 * @param stride - Number of turns to slide forward (for overlap)
 * @returns Array of conversation windows
 */
export function createConversationWindows(
  turns: Array<{ speaker: string; content: string; timestamp?: string }>,
  windowSize: number,
  stride: number,
): ConversationWindow[] {
  const windows: ConversationWindow[] = [];

  for (let i = 0; i < turns.length; i += stride) {
    const windowTurns = turns.slice(i, i + windowSize);

    if (windowTurns.length > 0) {
      windows.push({
        id: `window_${i}_${i + windowTurns.length - 1}`,
        turns: windowTurns,
        startIndex: i,
        endIndex: i + windowTurns.length - 1,
        shouldProcess: true,
      });
    }
  }

  return windows;
}

/**
 * Filter windows based on entropy threshold
 * 
 * @param windows - Array of conversation windows
 * @param previousFacts - Previously stored atomic facts
 * @param config - Compression configuration
 * @returns Filtered windows that should be processed
 */
export function filterWindowsByEntropy(
  windows: ConversationWindow[],
  previousFacts: AtomicFact[],
  config: SemanticCompressionConfig,
): EntropyFilterResult[] {
  const results: EntropyFilterResult[] = [];

  for (const window of windows) {
    const result = calculateWindowEntropy(window, previousFacts, config);
    results.push(result);

    // Mark window for processing based on entropy
    window.entropy = result.score;
    window.shouldProcess = result.shouldKeep;
  }

  return results;
}

/**
 * Calculate statistics for filtered windows
 */
export function calculateFilterStats(results: EntropyFilterResult[]): {
  total: number;
  kept: number;
  filtered: number;
  avgEntropy: number;
  avgNewEntities: number;
} {
  const kept = results.filter((r) => r.shouldKeep).length;
  const avgEntropy = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const avgNewEntities =
    results.reduce((sum, r) => sum + r.newEntities.size, 0) / results.length;

  return {
    total: results.length,
    kept,
    filtered: results.length - kept,
    avgEntropy,
    avgNewEntities,
  };
}
