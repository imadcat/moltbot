/**
 * Atomic fact types for SimpleMem semantic compression
 * 
 * Based on SimpleMem research: https://arxiv.org/abs/2601.02553
 * Atomic facts are self-contained, context-independent memory units
 * that enable efficient lifelong memory storage and retrieval.
 */

/**
 * A single atomic fact extracted from conversation
 * 
 * Atomic facts are:
 * - Self-contained (no external context needed)
 * - Temporally normalized (absolute timestamps)
 * - Entity-resolved (no pronouns/coreferences)
 * - Factual (single verifiable statement)
 */
export type AtomicFact = {
  id: string;
  /** Lossless restatement of the fact with all context resolved */
  statement: string;
  /** Keywords for efficient retrieval */
  keywords: string[];
  /** Persons mentioned in this fact */
  persons: string[];
  /** Entities mentioned in this fact */
  entities: string[];
  /** Topic/category of this fact */
  topic?: string;
  /** Absolute timestamp (ISO 8601) */
  timestamp?: string;
  /** Location mentioned in this fact */
  location?: string;
  /** Source conversation window */
  sourceWindowId?: string;
  /** Source chunk from which this was extracted */
  sourceChunkId?: string;
  /** Session file path */
  sourceSessionFile?: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Information entropy score */
  entropy?: number;
  /** Extraction timestamp */
  extractedAt: number;
  /** Consolidation level (0 = atomic, 1+ = consolidated) */
  level: number;
  /** Parent fact ID if this is a consolidation */
  parentId?: string;
};

/**
 * A window of conversation for processing
 * Windows overlap to preserve context across boundaries
 */
export type ConversationWindow = {
  id: string;
  turns: ConversationTurn[];
  startIndex: number;
  endIndex: number;
  entropy?: number;
  shouldProcess: boolean;
};

/**
 * A single turn in a conversation
 */
export type ConversationTurn = {
  speaker: string;
  content: string;
  timestamp?: string;
};

/**
 * Result of entropy-aware filtering
 */
export type EntropyFilterResult = {
  window: ConversationWindow;
  score: number;
  newEntities: Set<string>;
  semanticDivergence: number;
  shouldKeep: boolean;
};

/**
 * Configuration for semantic compression
 */
export type SemanticCompressionConfig = {
  /** Enable semantic compression */
  enabled: boolean;
  /** Window size in number of turns */
  windowSize: number;
  /** Stride for overlapping windows */
  stride: number;
  /** Entropy threshold for filtering (0-1) */
  entropyThreshold: number;
  /** Weight for new entities in entropy calculation */
  entityWeight: number;
  /** Weight for semantic divergence in entropy calculation */
  divergenceWeight: number;
  /** Maximum parallel workers */
  maxParallelWorkers: number;
  /** Maximum facts to extract per window */
  maxFactsPerWindow: number;
  /** Minimum confidence to store facts */
  minConfidence: number;
};

/**
 * Atomic fact extraction request for LLM
 */
export type AtomicFactExtractionRequest = {
  window: ConversationWindow;
  previousMemorySummary?: string;
};

/**
 * Atomic fact extraction result from LLM
 */
export type AtomicFactExtractionResult = {
  facts: Array<{
    statement: string;
    keywords: string[];
    persons: string[];
    entities: string[];
    topic?: string;
    timestamp?: string;
    location?: string;
    confidence: number;
  }>;
};

/**
 * Statistics for compression performance
 */
export type CompressionStats = {
  inputTokens: number;
  outputFacts: number;
  compressionRatio: number;
  entropyScore: number;
  processingTimeMs: number;
};

/**
 * Default configuration for semantic compression
 */
export const DEFAULT_COMPRESSION_CONFIG: SemanticCompressionConfig = {
  enabled: true,
  windowSize: 10,
  stride: 5,
  entropyThreshold: 0.3,
  entityWeight: 0.5,
  divergenceWeight: 0.5,
  maxParallelWorkers: 4,
  maxFactsPerWindow: 20,
  minConfidence: 0.7,
};
