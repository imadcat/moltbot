/**
 * SimpleMem pipeline integration
 * 
 * Integrates semantic compression, consolidation, and adaptive retrieval
 * into the memory management pipeline
 */

import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  AtomicFact,
  ConversationWindow,
  SemanticCompressionConfig,
  CompressionStats,
} from "./atomic-fact-types.js";
import { DEFAULT_COMPRESSION_CONFIG } from "./atomic-fact-types.js";
import {
  createConversationWindows,
  filterWindowsByEntropy,
  calculateFilterStats,
} from "./entropy-filter.js";
import {
  extractAtomicFactsBatch,
  deduplicateAtomicFacts,
  calculateExtractionStats,
  type LLMExtractFunction,
} from "./atomic-fact-extractor.js";
import {
  clusterAtomicFacts,
  consolidateCluster,
  recursiveConsolidation,
  type ConsolidationConfig,
  type LLMConsolidateFunction,
  DEFAULT_CONSOLIDATION_CONFIG,
} from "./consolidation.js";
import {
  adaptiveRetrieve,
  calculateTokenSavings,
  type AdaptiveRetrievalConfig,
  DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG,
} from "./adaptive-retrieval.js";

/**
 * SimpleMem pipeline configuration
 */
export type SimpleMem PipelineConfig = {
  /** Enable the pipeline */
  enabled: boolean;
  /** Compression configuration */
  compression: SemanticCompressionConfig;
  /** Consolidation configuration */
  consolidation: ConsolidationConfig;
  /** Retrieval configuration */
  retrieval: AdaptiveRetrievalConfig;
  /** Enable background consolidation */
  backgroundConsolidation: boolean;
  /** Background consolidation interval (ms) */
  consolidationIntervalMs: number;
  /** Auto-process new chunks */
  autoProcess: boolean;
};

/**
 * Default SimpleMem pipeline configuration
 */
export const DEFAULT_SIMPLEMEM_CONFIG: SimpleMemPipelineConfig = {
  enabled: true,
  compression: DEFAULT_COMPRESSION_CONFIG,
  consolidation: DEFAULT_CONSOLIDATION_CONFIG,
  retrieval: DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG,
  backgroundConsolidation: true,
  consolidationIntervalMs: 60 * 60 * 1000, // 1 hour
  autoProcess: true,
};

/**
 * SimpleMem pipeline manager
 */
export class SimpleMemPipeline {
  private db: DatabaseSync;
  private config: SimpleMemPipelineConfig;
  private llmExtract?: LLMExtractFunction;
  private llmConsolidate?: LLMConsolidateFunction;
  private consolidationTimer?: NodeJS.Timeout;

  constructor(
    db: DatabaseSync,
    config: SimpleMemPipelineConfig,
    llmExtract?: LLMExtractFunction,
    llmConsolidate?: LLMConsolidateFunction,
  ) {
    this.db = db;
    this.config = config;
    this.llmExtract = llmExtract;
    this.llmConsolidate = llmConsolidate;

    if (config.backgroundConsolidation && this.llmConsolidate) {
      this.startBackgroundConsolidation();
    }
  }

  /**
   * Process conversation transcript into atomic facts
   * 
   * @param transcript - Array of conversation turns
   * @param sessionFile - Session file path
   * @returns Processing statistics
   */
  async processTranscript(
    transcript: Array<{ speaker: string; content: string; timestamp?: string }>,
    sessionFile: string,
  ): Promise<{
    windowsCreated: number;
    windowsProcessed: number;
    factsExtracted: number;
    compressionStats: CompressionStats[];
  }> {
    if (!this.config.enabled || !this.llmExtract) {
      return {
        windowsCreated: 0,
        windowsProcessed: 0,
        factsExtracted: 0,
        compressionStats: [],
      };
    }

    const startTime = Date.now();

    // Create conversation windows
    const windows = createConversationWindows(
      transcript,
      this.config.compression.windowSize,
      this.config.compression.stride,
    );

    // Get previous facts for entropy calculation
    const previousFacts = this.getRecentFacts(100);

    // Filter windows by entropy
    const filterResults = filterWindowsByEntropy(
      windows,
      previousFacts,
      this.config.compression,
    );

    const filterStats = calculateFilterStats(filterResults);
    const windowsToProcess = filterResults.filter((r) => r.shouldKeep).map((r) => r.window);

    // Store windows in database
    for (const window of windowsToProcess) {
      this.storeWindow(window, sessionFile);
    }

    // Extract atomic facts
    const facts = await extractAtomicFactsBatch(
      windowsToProcess,
      this.llmExtract,
      this.config.compression,
    );

    // Deduplicate facts
    const uniqueFacts = deduplicateAtomicFacts(facts);

    // Store facts in database
    for (const fact of uniqueFacts) {
      fact.sourceSessionFile = sessionFile;
      this.storeFact(fact);
    }

    // Calculate and store compression stats
    const processingTime = Date.now() - startTime;
    const inputTokens = transcript.reduce((sum, t) => sum + t.content.length / 4, 0);
    const compressionStat: CompressionStats = {
      inputTokens,
      outputFacts: uniqueFacts.length,
      compressionRatio: inputTokens / uniqueFacts.length,
      entropyScore: filterStats.avgEntropy,
      processingTimeMs: processingTime,
    };

    this.storeCompressionStats(compressionStat, sessionFile);

    return {
      windowsCreated: windows.length,
      windowsProcessed: windowsToProcess.length,
      factsExtracted: uniqueFacts.length,
      compressionStats: [compressionStat],
    };
  }

  /**
   * Run consolidation on atomic facts
   * 
   * @returns Consolidation statistics
   */
  async runConsolidation(): Promise<{
    factsConsolidated: number;
    newFactsCreated: number;
    compressionAchieved: number;
  }> {
    if (!this.config.enabled || !this.llmConsolidate) {
      return {
        factsConsolidated: 0,
        newFactsCreated: 0,
        compressionAchieved: 1,
      };
    }

    // Get all atomic facts (level 0)
    const atomicFacts = this.getFactsByLevel(0);

    if (atomicFacts.length < this.config.consolidation.minFactsForCluster) {
      return {
        factsConsolidated: 0,
        newFactsCreated: 0,
        compressionAchieved: 1,
      };
    }

    // Run recursive consolidation
    const allFacts = await recursiveConsolidation(
      atomicFacts,
      this.llmConsolidate,
      this.config.consolidation,
    );

    // Store new consolidated facts
    const newFacts = allFacts.filter((f) => !atomicFacts.includes(f));
    for (const fact of newFacts) {
      this.storeFact(fact);
    }

    const originalTokens = atomicFacts.reduce((sum, f) => sum + f.statement.length / 4, 0);
    const consolidatedTokens = newFacts.reduce((sum, f) => sum + f.statement.length / 4, 0);
    const compressionAchieved = originalTokens / consolidatedTokens;

    return {
      factsConsolidated: atomicFacts.length,
      newFactsCreated: newFacts.length,
      compressionAchieved,
    };
  }

  /**
   * Search using adaptive retrieval
   * 
   * @param query - User query
   * @returns Retrieval result with facts
   */
  async search(query: string) {
    if (!this.config.enabled) {
      return null;
    }

    // Get all facts
    const allFacts = this.getAllFacts();

    // Use adaptive retrieval
    const result = adaptiveRetrieve(query, allFacts, this.config.retrieval);

    return result;
  }

  /**
   * Get statistics for the SimpleMem pipeline
   */
  getStats(): {
    totalFacts: number;
    factsByLevel: Record<number, number>;
    totalWindows: number;
    avgCompressionRatio: number;
    totalTokensSaved: number;
  } {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM atomic_facts");
    const totalFacts = (stmt.get() as { count: number }).count;

    const levelStmt = this.db.prepare(
      "SELECT level, COUNT(*) as count FROM atomic_facts GROUP BY level",
    );
    const levelRows = levelStmt.all() as Array<{ level: number; count: number }>;
    const factsByLevel: Record<number, number> = {};
    for (const row of levelRows) {
      factsByLevel[row.level] = row.count;
    }

    const windowStmt = this.db.prepare("SELECT COUNT(*) as count FROM conversation_windows");
    const totalWindows = (windowStmt.get() as { count: number }).count;

    const compressionStmt = this.db.prepare(
      "SELECT AVG(compression_ratio) as avg FROM compression_stats",
    );
    const avgCompressionRatio =
      (compressionStmt.get() as { avg: number | null }).avg || 1;

    return {
      totalFacts,
      factsByLevel,
      totalWindows,
      avgCompressionRatio,
      totalTokensSaved: 0, // Calculate if needed
    };
  }

  /**
   * Start background consolidation
   */
  private startBackgroundConsolidation(): void {
    this.consolidationTimer = setInterval(() => {
      this.runConsolidation().catch((err) => {
        console.error("Background consolidation failed:", err);
      });
    }, this.config.consolidationIntervalMs);
  }

  /**
   * Stop background consolidation
   */
  stopBackgroundConsolidation(): void {
    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
      this.consolidationTimer = undefined;
    }
  }

  /**
   * Store conversation window in database
   */
  private storeWindow(window: ConversationWindow, sessionFile: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO conversation_windows 
      (id, turns, start_index, end_index, entropy, should_process, processed_at, source_session_file)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      window.id,
      JSON.stringify(window.turns),
      window.startIndex,
      window.endIndex,
      window.entropy,
      window.shouldProcess ? 1 : 0,
      Date.now(),
      sessionFile,
    );
  }

  /**
   * Store atomic fact in database
   */
  private storeFact(fact: AtomicFact): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO atomic_facts
      (id, statement, keywords, persons, entities, topic, timestamp, location,
       source_window_id, source_chunk_id, source_session_file, confidence,
       entropy, extracted_at, level, parent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      fact.id,
      fact.statement,
      JSON.stringify(fact.keywords),
      JSON.stringify(fact.persons),
      JSON.stringify(fact.entities),
      fact.topic,
      fact.timestamp,
      fact.location,
      fact.sourceWindowId,
      fact.sourceChunkId,
      fact.sourceSessionFile,
      fact.confidence,
      fact.entropy,
      fact.extractedAt,
      fact.level,
      fact.parentId,
    );
  }

  /**
   * Store compression statistics
   */
  private storeCompressionStats(stats: CompressionStats, sessionFile: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO compression_stats
      (id, input_tokens, output_facts, compression_ratio, entropy_score,
       processing_time_ms, created_at, source_session_file)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      randomUUID(),
      stats.inputTokens,
      stats.outputFacts,
      stats.compressionRatio,
      stats.entropyScore,
      stats.processingTimeMs,
      Date.now(),
      sessionFile,
    );
  }

  /**
   * Get recent facts from database
   */
  private getRecentFacts(limit: number): AtomicFact[] {
    const stmt = this.db.prepare(`
      SELECT * FROM atomic_facts
      ORDER BY extracted_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as Array<any>;
    return rows.map((row) => this.rowToFact(row));
  }

  /**
   * Get facts by consolidation level
   */
  private getFactsByLevel(level: number): AtomicFact[] {
    const stmt = this.db.prepare("SELECT * FROM atomic_facts WHERE level = ?");
    const rows = stmt.all(level) as Array<any>;
    return rows.map((row) => this.rowToFact(row));
  }

  /**
   * Get all facts from database
   */
  private getAllFacts(): AtomicFact[] {
    const stmt = this.db.prepare("SELECT * FROM atomic_facts");
    const rows = stmt.all() as Array<any>;
    return rows.map((row) => this.rowToFact(row));
  }

  /**
   * Convert database row to AtomicFact
   */
  private rowToFact(row: any): AtomicFact {
    return {
      id: row.id,
      statement: row.statement,
      keywords: JSON.parse(row.keywords),
      persons: JSON.parse(row.persons),
      entities: JSON.parse(row.entities),
      topic: row.topic,
      timestamp: row.timestamp,
      location: row.location,
      sourceWindowId: row.source_window_id,
      sourceChunkId: row.source_chunk_id,
      sourceSessionFile: row.source_session_file,
      confidence: row.confidence,
      entropy: row.entropy,
      extractedAt: row.extracted_at,
      level: row.level,
      parentId: row.parent_id,
    };
  }
}

/**
 * Create SimpleMem pipeline instance
 * 
 * @param db - Database connection
 * @param config - Pipeline configuration
 * @param llmExtract - LLM function for fact extraction
 * @param llmConsolidate - LLM function for consolidation
 * @returns SimpleMem pipeline instance
 */
export function createSimpleMemPipeline(
  db: DatabaseSync,
  config?: Partial<SimpleMemPipelineConfig>,
  llmExtract?: LLMExtractFunction,
  llmConsolidate?: LLMConsolidateFunction,
): SimpleMemPipeline {
  const fullConfig = {
    ...DEFAULT_SIMPLEMEM_CONFIG,
    ...config,
  };

  return new SimpleMemPipeline(db, fullConfig, llmExtract, llmConsolidate);
}
