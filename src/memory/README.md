# Memory Module

This directory contains the memory search and indexing system for Moltbot, including the new entity extraction and knowledge graph features.

## Core Features

### Vector Search
- Semantic search using embeddings (OpenAI, Gemini, or local models)
- Hybrid search combining vector similarity and keyword matching
- Supports MEMORY.md and memory/*.md files
- Optional session transcript indexing

### Entity Extraction (NEW)
- Extract structured entities and relationships from conversations
- Schema.org vocabulary alignment for standardized types
- Knowledge graph storage and querying
- Inspired by [SimpleMem](https://github.com/aiming-lab/SimpleMem)

## Architecture

### Memory Components

```
manager.ts              - Main memory index manager
search-manager.ts       - Memory search API
embeddings.ts          - Embedding provider abstraction
internal.ts            - File scanning and chunking
memory-schema.ts       - SQLite schema definitions
```

### Entity Components (NEW)

```
entity-types.ts        - Schema.org aligned type definitions
entity-extractor.ts    - LLM-based entity extraction
entity-manager.ts      - Entity graph database operations
entity-integration.ts  - Integration examples with memory manager
```

## Entity Types

All entity and relationship types follow [Schema.org](https://schema.org/) vocabulary:

### Entity Types
- **Person**: Individuals, users, contacts
- **Organization**: Companies, groups, teams  
- **Place**: Locations, cities, addresses
- **Event**: Meetings, appointments, activities
- **Product**: Items, tools, software
- **CreativeWork**: Documents, articles, media
- **Action**: Tasks, todos, activities
- **Intangible**: Concepts, ideas, skills
- **Date/Time**: Temporal references
- **Thing**: Generic entities (fallback)

### Relationship Types
- `knows`, `worksFor`, `attendee`, `location`
- `about`, `mentions`, `creator`, `participant`
- `associatedWith`, `relatedTo`, `temporal`
- `owns`, `memberOf`

## Usage Examples

### Memory Search

```typescript
import { getMemorySearchManager } from "./memory";

const { manager } = await getMemorySearchManager({ cfg, agentId });
const results = await manager.search("project deadlines");
```

### Entity Extraction

```typescript
import { extractEntitiesFromText } from "./memory";

const result = await extractEntitiesFromText(
  "John works at Acme Corp",
  {
    config: { enabled: true },
    llmExtract: myLLMFunction,
  }
);
// result.entities: [John (Person), Acme Corp (Organization)]
// result.relationships: [John worksFor Acme Corp]
```

### Entity Queries

```typescript
import { EntityGraphManager } from "./memory";

const entityManager = new EntityGraphManager(db);

// Query by type
const people = entityManager.queryEntities({ type: "Person" });

// Get entity relationships
const graph = entityManager.getEntityGraph(entityId);

// Get statistics
const stats = entityManager.getStats();
```

## CLI Commands

```bash
# Memory search
moltbot memory status
moltbot memory index
moltbot memory search "query text"

# Entity management (NEW)
moltbot memory entities status
moltbot memory entities status --json
```

## Database Schema

### Existing Tables
- `meta` - Index metadata
- `files` - Tracked memory files
- `chunks` - Indexed text chunks
- `chunks_vec` - Vector embeddings
- `chunks_fts` - Full-text search index
- `embedding_cache` - Cached embeddings

### Entity Tables (NEW)
- `entities` - Extracted entities with Schema.org types
- `relationships` - Entity relationships with Schema.org property types

Both entity tables include foreign keys to `chunks` for traceability.

## Testing

```bash
# Run memory tests
npm test src/memory/

# Run entity-specific tests
npm test src/memory/entity-*.test.ts
```

## Configuration

Memory search is configured per agent:

```yaml
agents:
  default:
    memory:
      enabled: true
      provider: auto  # openai, gemini, local, or auto
      sources:
        - memory      # MEMORY.md + memory/*.md
        - sessions    # Session transcripts
```

Entity extraction config (future):

```yaml
agents:
  default:
    memory:
      entities:
        enabled: true
        minConfidence: 0.7
        maxEntitiesPerChunk: 50
```

## Dependencies

- `node:sqlite` - Database storage
- `sqlite-vec` - Vector similarity search
- `chokidar` - File watching
- Schema.org vocabulary (no package, standard types used)

## Future Work

- [ ] Automatic entity extraction during memory indexing
- [ ] Entity-aware semantic search
- [ ] Visual knowledge graph exploration
- [ ] Entity merging and deduplication
- [ ] Temporal relationship tracking
- [ ] Custom entity type extensions

## References

- [SimpleMem Paper](https://arxiv.org/abs/2601.02553)
- [SimpleMem GitHub](https://github.com/aiming-lab/SimpleMem)
- [Schema.org](https://schema.org/)
- [Schema.org Documentation](https://schemaorg.github.io/docsite/)

## Related Documentation

- `/docs/memory-entities.md` - Full entity extraction documentation
- `/docs/cli/memory.md` - CLI command reference (if exists)
