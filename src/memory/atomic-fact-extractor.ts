/**
 * Atomic fact extractor for SimpleMem semantic compression
 * 
 * Extracts self-contained, context-independent facts from conversation windows
 * Based on SimpleMem research: https://arxiv.org/abs/2601.02553
 */

import { randomUUID } from "node:crypto";
import type {
  AtomicFact,
  AtomicFactExtractionRequest,
  AtomicFactExtractionResult,
  ConversationWindow,
  SemanticCompressionConfig,
} from "./atomic-fact-types.js";

/**
 * LLM extraction function type
 * Takes a prompt and returns LLM response
 */
export type LLMExtractFunction = (prompt: string) => Promise<string>;

/**
 * Build extraction prompt for LLM
 * 
 * Prompt instructs LLM to:
 * - Extract atomic, self-contained facts
 * - Resolve coreferences (pronouns → entities)
 * - Normalize temporal expressions (relative → absolute)
 * - Return structured JSON
 */
function buildExtractionPrompt(request: AtomicFactExtractionRequest): string {
  const { window, previousMemorySummary } = request;

  // Format conversation turns
  const conversationText = window.turns
    .map((turn) => {
      const timestamp = turn.timestamp ? `[${turn.timestamp}] ` : "";
      return `${timestamp}${turn.speaker}: ${turn.content}`;
    })
    .join("\n");

  const previousContext = previousMemorySummary
    ? `\n\nPrevious memory context:\n${previousMemorySummary}\n`
    : "";

  return `Extract atomic facts from the following conversation. Each fact should be:
- Self-contained (no pronouns or unclear references)
- Context-independent (can be understood without reading the conversation)
- Temporally normalized (use absolute timestamps if mentioned)
- Factual (a single verifiable statement)

${previousContext}
Conversation:
${conversationText}

Return a JSON object with this structure:
{
  "facts": [
    {
      "statement": "Complete, self-contained statement with all entities and context resolved",
      "keywords": ["key", "terms", "for", "retrieval"],
      "persons": ["PersonName1", "PersonName2"],
      "entities": ["EntityName1", "EntityName2"],
      "topic": "general topic category",
      "timestamp": "ISO 8601 timestamp if mentioned",
      "location": "location if mentioned",
      "confidence": 0.9
    }
  ]
}

Important rules:
1. Replace ALL pronouns (he, she, it, they, etc.) with actual entity names
2. Convert relative time (yesterday, next week) to absolute timestamps if possible
3. Include all necessary context in the statement itself
4. Each fact should be independently meaningful
5. Split multi-part statements into separate facts
6. Assign confidence based on clarity and verifiability (0-1)

Extract all important facts. Return only valid JSON.`;
}

/**
 * Parse LLM response to extract atomic facts
 */
function parseExtractionResult(response: string): AtomicFactExtractionResult {
  // Try to find JSON in markdown code blocks first
  let jsonText = response;
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonText) as AtomicFactExtractionResult;

    // Validate structure
    if (!parsed.facts || !Array.isArray(parsed.facts)) {
      throw new Error("Invalid response: missing facts array");
    }

    // Validate each fact
    for (const fact of parsed.facts) {
      if (!fact.statement || typeof fact.statement !== "string") {
        throw new Error("Invalid fact: missing or invalid statement");
      }
      if (!fact.keywords || !Array.isArray(fact.keywords)) {
        fact.keywords = [];
      }
      if (!fact.persons || !Array.isArray(fact.persons)) {
        fact.persons = [];
      }
      if (!fact.entities || !Array.isArray(fact.entities)) {
        fact.entities = [];
      }
      if (typeof fact.confidence !== "number") {
        fact.confidence = 0.8; // Default confidence
      }
    }

    return parsed;
  } catch (err) {
    throw new Error(
      `Failed to parse LLM response as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Extract atomic facts from a conversation window
 * 
 * @param window - Conversation window to process
 * @param llmExtract - LLM extraction function
 * @param config - Compression configuration
 * @param previousMemorySummary - Optional summary of previous memories for context
 * @returns Array of extracted atomic facts
 */
export async function extractAtomicFacts(
  window: ConversationWindow,
  llmExtract: LLMExtractFunction,
  config: SemanticCompressionConfig,
  previousMemorySummary?: string,
): Promise<AtomicFact[]> {
  const request: AtomicFactExtractionRequest = {
    window,
    previousMemorySummary,
  };

  // Build and send extraction prompt
  const prompt = buildExtractionPrompt(request);
  const response = await llmExtract(prompt);

  // Parse LLM response
  const result = parseExtractionResult(response);

  // Convert to AtomicFact objects
  const facts: AtomicFact[] = [];
  const now = Date.now();

  for (const factData of result.facts) {
    // Filter by confidence
    if (factData.confidence < config.minConfidence) {
      continue;
    }

    // Limit facts per window
    if (facts.length >= config.maxFactsPerWindow) {
      break;
    }

    const fact: AtomicFact = {
      id: randomUUID(),
      statement: factData.statement,
      keywords: factData.keywords,
      persons: factData.persons,
      entities: factData.entities,
      topic: factData.topic,
      timestamp: factData.timestamp,
      location: factData.location,
      sourceWindowId: window.id,
      confidence: factData.confidence,
      extractedAt: now,
      level: 0, // Atomic level (not consolidated)
    };

    facts.push(fact);
  }

  return facts;
}

/**
 * Extract atomic facts from multiple windows in parallel
 * 
 * @param windows - Array of conversation windows
 * @param llmExtract - LLM extraction function
 * @param config - Compression configuration
 * @param previousMemorySummary - Optional summary of previous memories
 * @returns Array of all extracted atomic facts
 */
export async function extractAtomicFactsBatch(
  windows: ConversationWindow[],
  llmExtract: LLMExtractFunction,
  config: SemanticCompressionConfig,
  previousMemorySummary?: string,
): Promise<AtomicFact[]> {
  const allFacts: AtomicFact[] = [];

  // Process windows with limited concurrency
  const maxConcurrent = config.maxParallelWorkers;
  const chunks: ConversationWindow[][] = [];

  for (let i = 0; i < windows.length; i += maxConcurrent) {
    chunks.push(windows.slice(i, i + maxConcurrent));
  }

  for (const chunk of chunks) {
    const promises = chunk.map((window) =>
      extractAtomicFacts(window, llmExtract, config, previousMemorySummary),
    );

    const results = await Promise.all(promises);

    for (const facts of results) {
      allFacts.push(...facts);
    }
  }

  return allFacts;
}

/**
 * Deduplicate atomic facts based on semantic similarity
 * 
 * @param facts - Array of atomic facts
 * @returns Deduplicated array of facts
 */
export function deduplicateAtomicFacts(facts: AtomicFact[]): AtomicFact[] {
  const unique: AtomicFact[] = [];
  const seen = new Set<string>();

  for (const fact of facts) {
    // Create a normalized key for deduplication
    const key = normalizeFactKey(fact);

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(fact);
    }
  }

  return unique;
}

/**
 * Create a normalized key for fact deduplication
 */
function normalizeFactKey(fact: AtomicFact): string {
  // Normalize statement to lowercase and remove extra whitespace
  const normalizedStatement = fact.statement.toLowerCase().replace(/\s+/g, " ").trim();

  // Sort entities and persons for consistent comparison
  const sortedEntities = [...fact.entities].sort().join("|");
  const sortedPersons = [...fact.persons].sort().join("|");

  return `${normalizedStatement}::${sortedEntities}::${sortedPersons}`;
}

/**
 * Calculate statistics for extracted facts
 */
export function calculateExtractionStats(facts: AtomicFact[]): {
  totalFacts: number;
  avgConfidence: number;
  totalEntities: number;
  totalPersons: number;
  factsWithTimestamp: number;
  factsWithLocation: number;
  topicDistribution: Record<string, number>;
} {
  const entitySet = new Set<string>();
  const personSet = new Set<string>();
  const topicCounts: Record<string, number> = {};
  let factsWithTimestamp = 0;
  let factsWithLocation = 0;

  for (const fact of facts) {
    for (const entity of fact.entities) {
      entitySet.add(entity);
    }
    for (const person of fact.persons) {
      personSet.add(person);
    }
    if (fact.timestamp) {
      factsWithTimestamp++;
    }
    if (fact.location) {
      factsWithLocation++;
    }
    if (fact.topic) {
      topicCounts[fact.topic] = (topicCounts[fact.topic] || 0) + 1;
    }
  }

  const avgConfidence =
    facts.length > 0 ? facts.reduce((sum, f) => sum + f.confidence, 0) / facts.length : 0;

  return {
    totalFacts: facts.length,
    avgConfidence,
    totalEntities: entitySet.size,
    totalPersons: personSet.size,
    factsWithTimestamp,
    factsWithLocation,
    topicDistribution: topicCounts,
  };
}
