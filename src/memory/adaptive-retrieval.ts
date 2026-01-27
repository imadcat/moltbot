/**
 * Adaptive query-aware retrieval for SimpleMem
 * 
 * Optimizes memory retrieval based on query complexity
 * Based on SimpleMem research: https://arxiv.org/abs/2601.02553
 */

import type { AtomicFact } from "./atomic-fact-types.js";

/**
 * Query complexity categories
 */
export type QueryComplexity = "simple" | "moderate" | "complex";

/**
 * Query analysis result
 */
export type QueryAnalysis = {
  /** Original query text */
  query: string;
  /** Complexity level */
  complexity: QueryComplexity;
  /** Estimated tokens needed */
  estimatedTokens: number;
  /** Extracted keywords */
  keywords: string[];
  /** Detected entities */
  entities: string[];
  /** Temporal indicators */
  temporal?: {
    relative?: string; // "recent", "last week", etc.
    absolute?: string; // ISO timestamp
  };
  /** Topic indicators */
  topics: string[];
  /** Requires multi-step reasoning */
  requiresReasoning: boolean;
};

/**
 * Retrieval strategy based on complexity
 */
export type RetrievalStrategy = {
  /** Complexity level */
  complexity: QueryComplexity;
  /** Maximum facts to retrieve */
  maxFacts: number;
  /** Prefer higher levels (consolidated facts) */
  preferConsolidated: boolean;
  /** Include hierarchical context */
  includeHierarchy: boolean;
  /** Maximum total tokens */
  maxTokens: number;
  /** Retrieval method weights */
  weights: {
    /** Keyword match weight */
    keyword: number;
    /** Entity match weight */
    entity: number;
    /** Topic match weight */
    topic: number;
    /** Temporal relevance weight */
    temporal: number;
    /** Recency weight */
    recency: number;
  };
};

/**
 * Retrieved fact with relevance score
 */
export type RetrievedFact = {
  fact: AtomicFact;
  relevanceScore: number;
  matchReasons: string[];
  estimatedTokens: number;
};

/**
 * Retrieval result with metadata
 */
export type RetrievalResult = {
  facts: RetrievedFact[];
  totalTokens: number;
  strategy: RetrievalStrategy;
  analysis: QueryAnalysis;
  metadata: {
    factsRetrieved: number;
    factsAvailable: number;
    tokenBudgetUsed: number;
    compressionAchieved: number; // vs retrieving all
  };
};

/**
 * Configuration for adaptive retrieval
 */
export type AdaptiveRetrievalConfig = {
  /** Enable adaptive retrieval */
  enabled: boolean;
  /** Simple query token budget */
  simpleQueryTokens: number;
  /** Moderate query token budget */
  moderateQueryTokens: number;
  /** Complex query token budget */
  complexQueryTokens: number;
  /** Prefer consolidated facts over atomic */
  preferConsolidated: boolean;
  /** Include parent facts for context */
  includeParents: boolean;
  /** Approximate chars per token */
  charsPerToken: number;
};

/**
 * Default adaptive retrieval configuration
 */
export const DEFAULT_ADAPTIVE_RETRIEVAL_CONFIG: AdaptiveRetrievalConfig = {
  enabled: true,
  simpleQueryTokens: 500,
  moderateQueryTokens: 1500,
  complexQueryTokens: 3000,
  preferConsolidated: true,
  includeParents: false,
  charsPerToken: 4,
};

/**
 * Analyze query to determine complexity and requirements
 * 
 * @param query - User query text
 * @returns Query analysis with complexity and metadata
 */
export function analyzeQuery(query: string): QueryAnalysis {
  const words = query.toLowerCase().split(/\s+/);
  const wordCount = words.length;

  // Extract keywords (ignore common words)
  const stopWords = new Set([
    "what",
    "when",
    "where",
    "who",
    "why",
    "how",
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "did",
    "do",
    "does",
    "have",
    "has",
    "had",
    "about",
    "tell",
    "me",
  ]);
  const keywords = words.filter((w) => w.length > 2 && !stopWords.has(w));

  // Extract capitalized words as potential entities
  const entityMatches = query.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  const entities = [...new Set(entityMatches)];

  // Detect temporal indicators
  const temporalKeywords = [
    "recent",
    "lately",
    "yesterday",
    "today",
    "last",
    "this",
    "next",
    "ago",
    "before",
    "after",
    "when",
  ];
  const hasTemporal = words.some((w) => temporalKeywords.includes(w));
  const temporal = hasTemporal
    ? {
        relative: words.find((w) => temporalKeywords.includes(w)),
      }
    : undefined;

  // Detect topics (simple heuristic)
  const topicIndicators = ["about", "regarding", "concerning", "related to"];
  const topics: string[] = [];
  for (const indicator of topicIndicators) {
    if (query.toLowerCase().includes(indicator)) {
      const afterIndicator = query
        .toLowerCase()
        .split(indicator)[1]
        ?.trim()
        .split(/\s+/)
        .slice(0, 3)
        .join(" ");
      if (afterIndicator) {
        topics.push(afterIndicator);
      }
    }
  }

  // Detect if query requires reasoning
  const reasoningIndicators = [
    "why",
    "how",
    "explain",
    "compare",
    "difference",
    "relationship",
    "cause",
    "effect",
    "reason",
    "analysis",
  ];
  const requiresReasoning = words.some((w) => reasoningIndicators.includes(w));

  // Determine complexity based on multiple factors
  let complexity: QueryComplexity = "simple";
  let estimatedTokens = 500;

  if (requiresReasoning || wordCount > 15 || topics.length > 0) {
    complexity = "complex";
    estimatedTokens = 3000;
  } else if (wordCount > 8 || entities.length > 2 || hasTemporal) {
    complexity = "moderate";
    estimatedTokens = 1500;
  }

  return {
    query,
    complexity,
    estimatedTokens,
    keywords,
    entities,
    temporal,
    topics,
    requiresReasoning,
  };
}

/**
 * Determine retrieval strategy based on query analysis
 * 
 * @param analysis - Query analysis result
 * @param config - Adaptive retrieval configuration
 * @returns Retrieval strategy optimized for the query
 */
export function determineRetrievalStrategy(
  analysis: QueryAnalysis,
  config: AdaptiveRetrievalConfig,
): RetrievalStrategy {
  const strategies: Record<QueryComplexity, RetrievalStrategy> = {
    simple: {
      complexity: "simple",
      maxFacts: 5,
      preferConsolidated: config.preferConsolidated,
      includeHierarchy: false,
      maxTokens: config.simpleQueryTokens,
      weights: {
        keyword: 0.4,
        entity: 0.3,
        topic: 0.1,
        temporal: 0.1,
        recency: 0.1,
      },
    },
    moderate: {
      complexity: "moderate",
      maxFacts: 10,
      preferConsolidated: config.preferConsolidated,
      includeHierarchy: config.includeParents,
      maxTokens: config.moderateQueryTokens,
      weights: {
        keyword: 0.3,
        entity: 0.3,
        topic: 0.2,
        temporal: 0.1,
        recency: 0.1,
      },
    },
    complex: {
      complexity: "complex",
      maxFacts: 20,
      preferConsolidated: false, // Need detail for reasoning
      includeHierarchy: config.includeParents,
      maxTokens: config.complexQueryTokens,
      weights: {
        keyword: 0.25,
        entity: 0.25,
        topic: 0.25,
        temporal: 0.15,
        recency: 0.1,
      },
    },
  };

  return strategies[analysis.complexity];
}

/**
 * Calculate relevance score for a fact given the query
 * 
 * @param fact - Atomic fact to score
 * @param analysis - Query analysis
 * @param strategy - Retrieval strategy
 * @returns Relevance score (0-1) and match reasons
 */
export function calculateRelevance(
  fact: AtomicFact,
  analysis: QueryAnalysis,
  strategy: RetrievalStrategy,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Keyword matching
  const factText = `${fact.statement} ${fact.keywords.join(" ")}`.toLowerCase();
  const matchingKeywords = analysis.keywords.filter((kw) => factText.includes(kw));
  if (matchingKeywords.length > 0) {
    const keywordScore = (matchingKeywords.length / analysis.keywords.length) * strategy.weights.keyword;
    score += keywordScore;
    reasons.push(`Keyword match: ${matchingKeywords.join(", ")}`);
  }

  // Entity matching
  const factEntities = new Set([...fact.entities, ...fact.persons].map((e) => e.toLowerCase()));
  const matchingEntities = analysis.entities.filter((e) => factEntities.has(e.toLowerCase()));
  if (matchingEntities.length > 0) {
    const entityScore = (matchingEntities.length / Math.max(analysis.entities.length, 1)) * strategy.weights.entity;
    score += entityScore;
    reasons.push(`Entity match: ${matchingEntities.join(", ")}`);
  }

  // Topic matching
  if (fact.topic && analysis.topics.length > 0) {
    const topicMatches = analysis.topics.some((t) =>
      fact.topic!.toLowerCase().includes(t.toLowerCase()),
    );
    if (topicMatches) {
      score += strategy.weights.topic;
      reasons.push(`Topic match: ${fact.topic}`);
    }
  }

  // Temporal relevance
  if (fact.timestamp && analysis.temporal) {
    const factTime = new Date(fact.timestamp).getTime();
    const now = Date.now();
    const daysSince = (now - factTime) / (1000 * 60 * 60 * 24);

    // Recent facts score higher
    if (analysis.temporal.relative) {
      if (daysSince <= 7) {
        score += strategy.weights.temporal;
        reasons.push("Recent fact");
      } else if (daysSince <= 30) {
        score += strategy.weights.temporal * 0.5;
        reasons.push("Recent fact");
      }
    }
  }

  // Recency bonus
  const factAge = Date.now() - fact.extractedAt;
  const maxAge = 90 * 24 * 60 * 60 * 1000; // 90 days
  const recencyScore = Math.max(0, 1 - factAge / maxAge) * strategy.weights.recency;
  score += recencyScore;

  return { score, reasons };
}

/**
 * Retrieve facts adaptively based on query
 * 
 * @param query - User query
 * @param allFacts - All available facts
 * @param config - Adaptive retrieval configuration
 * @returns Retrieval result with optimized facts
 */
export function adaptiveRetrieve(
  query: string,
  allFacts: AtomicFact[],
  config: AdaptiveRetrievalConfig,
): RetrievalResult {
  // Analyze query
  const analysis = analyzeQuery(query);

  // Determine strategy
  const strategy = determineRetrievalStrategy(analysis, config);

  // Filter facts based on strategy preferences
  let candidateFacts = allFacts;

  // Prefer consolidated facts if configured
  if (strategy.preferConsolidated) {
    const consolidated = allFacts.filter((f) => f.level > 0);
    if (consolidated.length > 0) {
      candidateFacts = consolidated;
    }
  }

  // Score and rank facts
  const scoredFacts = candidateFacts.map((fact) => {
    const { score, reasons } = calculateRelevance(fact, analysis, strategy);
    const estimatedTokens = Math.ceil(fact.statement.length / config.charsPerToken);

    return {
      fact,
      relevanceScore: score,
      matchReasons: reasons,
      estimatedTokens,
    };
  });

  // Sort by relevance
  scoredFacts.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Select facts within token budget
  const selectedFacts: RetrievedFact[] = [];
  let totalTokens = 0;

  for (const scoredFact of scoredFacts) {
    if (selectedFacts.length >= strategy.maxFacts) break;
    if (totalTokens + scoredFact.estimatedTokens > strategy.maxTokens) break;

    selectedFacts.push(scoredFact);
    totalTokens += scoredFact.estimatedTokens;
  }

  // Include parent facts if configured
  if (strategy.includeHierarchy) {
    const parentIds = new Set(selectedFacts.map((f) => f.fact.parentId).filter((id): id is string => !!id));
    const parents = allFacts.filter((f) => parentIds.has(f.id));

    for (const parent of parents) {
      const estimatedTokens = Math.ceil(parent.statement.length / config.charsPerToken);
      if (totalTokens + estimatedTokens <= strategy.maxTokens) {
        selectedFacts.push({
          fact: parent,
          relevanceScore: 0.5, // Lower score for parents
          matchReasons: ["Parent fact for context"],
          estimatedTokens,
        });
        totalTokens += estimatedTokens;
      }
    }
  }

  // Calculate metadata
  const allFactsTokens = allFacts.reduce(
    (sum, f) => sum + Math.ceil(f.statement.length / config.charsPerToken),
    0,
  );
  const compressionAchieved = allFactsTokens > 0 ? allFactsTokens / totalTokens : 1;

  return {
    facts: selectedFacts,
    totalTokens,
    strategy,
    analysis,
    metadata: {
      factsRetrieved: selectedFacts.length,
      factsAvailable: allFacts.length,
      tokenBudgetUsed: (totalTokens / strategy.maxTokens) * 100,
      compressionAchieved,
    },
  };
}

/**
 * Calculate token savings from adaptive retrieval
 * 
 * @param result - Retrieval result
 * @param allFactsCount - Total facts available
 * @param config - Configuration
 * @returns Token savings statistics
 */
export function calculateTokenSavings(
  result: RetrievalResult,
  allFactsCount: number,
  config: AdaptiveRetrievalConfig,
): {
  tokensUsed: number;
  tokensIfAll: number;
  tokensSaved: number;
  percentageSaved: number;
  compressionRatio: number;
} {
  const tokensUsed = result.totalTokens;
  const tokensIfAll = result.metadata.factsAvailable * 100; // Rough estimate
  const tokensSaved = tokensIfAll - tokensUsed;
  const percentageSaved = (tokensSaved / tokensIfAll) * 100;
  const compressionRatio = tokensIfAll / tokensUsed;

  return {
    tokensUsed,
    tokensIfAll,
    tokensSaved,
    percentageSaved,
    compressionRatio,
  };
}
