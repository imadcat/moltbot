/**
 * Recursive memory consolidation for SimpleMem
 * 
 * Asynchronously clusters related atomic facts into higher-level abstractions
 * Based on SimpleMem research: https://arxiv.org/abs/2601.02553
 */

import { randomUUID } from "node:crypto";
import type { AtomicFact } from "./atomic-fact-types.js";

/**
 * Configuration for memory consolidation
 */
export type ConsolidationConfig = {
  /** Enable consolidation */
  enabled: boolean;
  /** Minimum facts to trigger consolidation */
  minFactsForCluster: number;
  /** Maximum facts in a single cluster */
  maxFactsPerCluster: number;
  /** Similarity threshold for clustering (0-1) */
  similarityThreshold: number;
  /** Maximum consolidation depth */
  maxConsolidationLevel: number;
  /** Time window for temporal clustering (ms) */
  temporalWindowMs: number;
  /** Enable topic-based clustering */
  topicClustering: boolean;
  /** Enable entity-based clustering */
  entityClustering: boolean;
  /** Enable temporal clustering */
  temporalClustering: boolean;
};

/**
 * A cluster of related atomic facts
 */
export type FactCluster = {
  id: string;
  facts: AtomicFact[];
  /** Cluster topic/theme */
  topic?: string;
  /** Common entities across facts */
  commonEntities: string[];
  /** Common persons across facts */
  commonPersons: string[];
  /** Temporal range */
  timeRange?: {
    start: string;
    end: string;
  };
  /** Cluster similarity score */
  coherenceScore: number;
  /** Creation timestamp */
  createdAt: number;
};

/**
 * Result of consolidating a cluster into a higher-level fact
 */
export type ConsolidationResult = {
  /** The consolidated fact (level n+1) */
  consolidatedFact: AtomicFact;
  /** Source facts that were consolidated */
  sourceFacts: AtomicFact[];
  /** Consolidation metadata */
  metadata: {
    clusterCoherence: number;
    factsConsolidated: number;
    compressionRatio: number;
  };
};

/**
 * LLM consolidation function type
 * Takes facts and returns a consolidated statement
 */
export type LLMConsolidateFunction = (facts: AtomicFact[]) => Promise<string>;

/**
 * Default consolidation configuration
 */
export const DEFAULT_CONSOLIDATION_CONFIG: ConsolidationConfig = {
  enabled: true,
  minFactsForCluster: 3,
  maxFactsPerCluster: 10,
  similarityThreshold: 0.6,
  maxConsolidationLevel: 3,
  temporalWindowMs: 7 * 24 * 60 * 60 * 1000, // 1 week
  topicClustering: true,
  entityClustering: true,
  temporalClustering: true,
};

/**
 * Calculate similarity score between two atomic facts
 * 
 * Considers:
 * - Shared entities and persons
 * - Topic similarity
 * - Temporal proximity
 * - Keyword overlap
 */
export function calculateFactSimilarity(
  fact1: AtomicFact,
  fact2: AtomicFact,
  config: ConsolidationConfig,
): number {
  let score = 0;
  let weights = 0;

  // Entity overlap
  if (config.entityClustering) {
    const entities1 = new Set(fact1.entities.map((e) => e.toLowerCase()));
    const entities2 = new Set(fact2.entities.map((e) => e.toLowerCase()));
    const allEntities = new Set([...entities1, ...entities2]);
    const commonEntities = new Set([...entities1].filter((e) => entities2.has(e)));

    if (allEntities.size > 0) {
      score += (commonEntities.size / allEntities.size) * 0.3;
    }
    weights += 0.3;
  }

  // Person overlap
  if (config.entityClustering) {
    const persons1 = new Set(fact1.persons.map((p) => p.toLowerCase()));
    const persons2 = new Set(fact2.persons.map((p) => p.toLowerCase()));
    const allPersons = new Set([...persons1, ...persons2]);
    const commonPersons = new Set([...persons1].filter((p) => persons2.has(p)));

    if (allPersons.size > 0) {
      score += (commonPersons.size / allPersons.size) * 0.3;
    }
    weights += 0.3;
  }

  // Topic similarity
  if (config.topicClustering && fact1.topic && fact2.topic) {
    if (fact1.topic.toLowerCase() === fact2.topic.toLowerCase()) {
      score += 0.2;
    }
    weights += 0.2;
  }

  // Temporal proximity
  if (config.temporalClustering && fact1.timestamp && fact2.timestamp) {
    const time1 = new Date(fact1.timestamp).getTime();
    const time2 = new Date(fact2.timestamp).getTime();
    const timeDiff = Math.abs(time1 - time2);

    if (timeDiff <= config.temporalWindowMs) {
      const proximityScore = 1 - timeDiff / config.temporalWindowMs;
      score += proximityScore * 0.2;
    }
    weights += 0.2;
  }

  // Normalize score
  return weights > 0 ? score / weights : 0;
}

/**
 * Cluster atomic facts using similarity-based grouping
 * 
 * @param facts - Array of atomic facts to cluster
 * @param config - Consolidation configuration
 * @returns Array of fact clusters
 */
export function clusterAtomicFacts(
  facts: AtomicFact[],
  config: ConsolidationConfig,
): FactCluster[] {
  if (facts.length < config.minFactsForCluster) {
    return [];
  }

  const clusters: FactCluster[] = [];
  const assigned = new Set<string>();

  // Sort facts by timestamp if available
  const sortedFacts = [...facts].sort((a, b) => {
    if (a.timestamp && b.timestamp) {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    }
    return 0;
  });

  for (const seed of sortedFacts) {
    if (assigned.has(seed.id)) continue;

    const cluster: AtomicFact[] = [seed];
    assigned.add(seed.id);

    // Find similar facts
    for (const candidate of sortedFacts) {
      if (assigned.has(candidate.id)) continue;
      if (cluster.length >= config.maxFactsPerCluster) break;

      // Calculate average similarity to cluster
      let avgSimilarity = 0;
      for (const clusterFact of cluster) {
        avgSimilarity += calculateFactSimilarity(clusterFact, candidate, config);
      }
      avgSimilarity /= cluster.length;

      if (avgSimilarity >= config.similarityThreshold) {
        cluster.push(candidate);
        assigned.add(candidate.id);
      }
    }

    // Only create cluster if it has enough facts
    if (cluster.length >= config.minFactsForCluster) {
      clusters.push(createCluster(cluster));
    }
  }

  return clusters;
}

/**
 * Create a cluster object from a group of facts
 */
function createCluster(facts: AtomicFact[]): FactCluster {
  // Find common entities
  const entitySets = facts.map((f) => new Set(f.entities.map((e) => e.toLowerCase())));
  const commonEntities = Array.from(
    entitySets.reduce((acc, set) => {
      const common = new Set([...acc].filter((e) => set.has(e)));
      return common;
    }, entitySets[0] || new Set()),
  );

  // Find common persons
  const personSets = facts.map((f) => new Set(f.persons.map((p) => p.toLowerCase())));
  const commonPersons = Array.from(
    personSets.reduce((acc, set) => {
      const common = new Set([...acc].filter((p) => set.has(p)));
      return common;
    }, personSets[0] || new Set()),
  );

  // Determine topic (most common)
  const topicCounts: Record<string, number> = {};
  for (const fact of facts) {
    if (fact.topic) {
      topicCounts[fact.topic] = (topicCounts[fact.topic] || 0) + 1;
    }
  }
  const topic = Object.keys(topicCounts).sort((a, b) => topicCounts[b] - topicCounts[a])[0];

  // Calculate temporal range
  let timeRange: { start: string; end: string } | undefined;
  const timestamps = facts.map((f) => f.timestamp).filter((t): t is string => !!t);
  if (timestamps.length > 0) {
    const times = timestamps.map((t) => new Date(t).getTime());
    timeRange = {
      start: new Date(Math.min(...times)).toISOString(),
      end: new Date(Math.max(...times)).toISOString(),
    };
  }

  // Calculate coherence score (average pairwise similarity)
  let totalSimilarity = 0;
  let pairs = 0;
  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      totalSimilarity += calculateFactSimilarity(
        facts[i],
        facts[j],
        DEFAULT_CONSOLIDATION_CONFIG,
      );
      pairs++;
    }
  }
  const coherenceScore = pairs > 0 ? totalSimilarity / pairs : 0;

  return {
    id: randomUUID(),
    facts,
    topic,
    commonEntities,
    commonPersons,
    timeRange,
    coherenceScore,
    createdAt: Date.now(),
  };
}

/**
 * Build consolidation prompt for LLM
 */
function buildConsolidationPrompt(cluster: FactCluster): string {
  const factsText = cluster.facts
    .map((f, i) => `${i + 1}. ${f.statement} (confidence: ${f.confidence})`)
    .join("\n");

  const entities =
    cluster.commonEntities.length > 0 ? cluster.commonEntities.join(", ") : "various entities";
  const persons =
    cluster.commonPersons.length > 0 ? cluster.commonPersons.join(", ") : "various persons";
  const topic = cluster.topic || "general";

  return `Consolidate the following related facts into a single, higher-level statement.

Topic: ${topic}
Common entities: ${entities}
Common persons: ${persons}
${cluster.timeRange ? `Time range: ${cluster.timeRange.start} to ${cluster.timeRange.end}` : ""}

Facts to consolidate:
${factsText}

Create a single statement that:
1. Captures the essence of all facts
2. Is more abstract and general than individual facts
3. Preserves key information (entities, relationships, outcomes)
4. Is self-contained and context-independent
5. Represents a higher-level understanding

Return only the consolidated statement, no additional text.`;
}

/**
 * Consolidate a cluster of facts into a higher-level fact
 * 
 * @param cluster - Cluster of related facts
 * @param llmConsolidate - LLM function for consolidation
 * @returns Consolidation result with new fact
 */
export async function consolidateCluster(
  cluster: FactCluster,
  llmConsolidate: LLMConsolidateFunction,
): Promise<ConsolidationResult> {
  // Use LLM to create consolidated statement
  const consolidatedStatement = await llmConsolidate(cluster.facts);

  // Merge entities, persons, keywords from all facts
  const allEntities = new Set<string>();
  const allPersons = new Set<string>();
  const allKeywords = new Set<string>();

  for (const fact of cluster.facts) {
    for (const entity of fact.entities) allEntities.add(entity);
    for (const person of fact.persons) allPersons.add(person);
    for (const keyword of fact.keywords) allKeywords.add(keyword);
  }

  // Calculate new confidence (average of source facts)
  const avgConfidence =
    cluster.facts.reduce((sum, f) => sum + f.confidence, 0) / cluster.facts.length;

  // Determine consolidation level (max level + 1)
  const maxLevel = Math.max(...cluster.facts.map((f) => f.level));

  // Calculate compression ratio
  const sourceChars = cluster.facts.reduce((sum, f) => sum + f.statement.length, 0);
  const consolidatedChars = consolidatedStatement.length;
  const compressionRatio = sourceChars / consolidatedChars;

  // Create consolidated fact
  const consolidatedFact: AtomicFact = {
    id: randomUUID(),
    statement: consolidatedStatement,
    keywords: Array.from(allKeywords),
    persons: Array.from(allPersons),
    entities: Array.from(allEntities),
    topic: cluster.topic,
    timestamp: cluster.timeRange?.start,
    location: cluster.facts.find((f) => f.location)?.location,
    confidence: avgConfidence,
    extractedAt: Date.now(),
    level: maxLevel + 1,
    parentId: cluster.id, // Link to source cluster
  };

  return {
    consolidatedFact,
    sourceFacts: cluster.facts,
    metadata: {
      clusterCoherence: cluster.coherenceScore,
      factsConsolidated: cluster.facts.length,
      compressionRatio,
    },
  };
}

/**
 * Recursively consolidate facts up to max level
 * 
 * @param facts - Array of atomic facts
 * @param llmConsolidate - LLM consolidation function
 * @param config - Consolidation configuration
 * @returns Array of all facts (original + consolidated)
 */
export async function recursiveConsolidation(
  facts: AtomicFact[],
  llmConsolidate: LLMConsolidateFunction,
  config: ConsolidationConfig,
): Promise<AtomicFact[]> {
  const allFacts = [...facts];
  let currentLevel = 0;

  while (currentLevel < config.maxConsolidationLevel) {
    // Get facts at current level
    const levelFacts = allFacts.filter((f) => f.level === currentLevel);

    if (levelFacts.length < config.minFactsForCluster) {
      break; // Not enough facts to consolidate further
    }

    // Cluster facts
    const clusters = clusterAtomicFacts(levelFacts, config);

    if (clusters.length === 0) {
      break; // No more clusters found
    }

    // Consolidate each cluster
    for (const cluster of clusters) {
      const result = await consolidateCluster(cluster, llmConsolidate);
      allFacts.push(result.consolidatedFact);
    }

    currentLevel++;
  }

  return allFacts;
}

/**
 * Calculate statistics for consolidation results
 */
export function calculateConsolidationStats(
  originalFacts: AtomicFact[],
  consolidatedFacts: AtomicFact[],
): {
  originalCount: number;
  consolidatedCount: number;
  totalCount: number;
  levelsCreated: number;
  avgCompressionRatio: number;
  maxLevel: number;
} {
  const newFacts = consolidatedFacts.filter((f) => !originalFacts.includes(f));
  const maxLevel = Math.max(...consolidatedFacts.map((f) => f.level));
  const levels = new Set(consolidatedFacts.map((f) => f.level)).size;

  // Calculate average compression ratio
  let totalCompressionRatio = 0;
  let consolidatedFactsCount = 0;

  for (const fact of newFacts) {
    if (fact.level > 0) {
      consolidatedFactsCount++;
    }
  }

  return {
    originalCount: originalFacts.length,
    consolidatedCount: newFacts.length,
    totalCount: consolidatedFacts.length,
    levelsCreated: levels,
    avgCompressionRatio: consolidatedFactsCount > 0 ? totalCompressionRatio / consolidatedFactsCount : 0,
    maxLevel,
  };
}
