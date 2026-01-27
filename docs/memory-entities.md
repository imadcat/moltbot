# Entity Extraction and Schema.org Alignment

Moltbot's memory system has been enhanced with entity extraction and relationship mapping capabilities, using Schema.org vocabulary for standardized type alignment.

## Overview

The entity extraction feature automatically identifies and extracts structured information from conversations and memory files:

- **Entities**: People, organizations, places, events, products, and more
- **Relationships**: Connections between entities (knows, worksFor, attendee, etc.)
- **Schema.org Alignment**: All entity and relationship types follow Schema.org vocabulary standards

This enhancement is inspired by [SimpleMem](https://github.com/aiming-lab/SimpleMem), which uses structured knowledge graphs for efficient memory management.

## Schema.org Entity Types

The system recognizes and aligns with the following Schema.org entity types:

- **Person**: Individuals, users, contacts
- **Organization**: Companies, groups, teams
- **Place**: Locations, cities, addresses
- **Event**: Meetings, appointments, activities
- **Product**: Items, tools, software
- **CreativeWork**: Documents, articles, media
- **Action**: Tasks, todos, activities
- **Intangible**: Concepts, ideas, skills
- **Date**: Specific dates
- **Time**: Specific times
- **Thing**: Generic entities (fallback)

## Schema.org Relationship Types

Supported relationship types (based on Schema.org properties):

- **knows**: Person knows another person
- **worksFor**: Person works for organization
- **attendee**: Person attending event
- **location**: Entity is located at place
- **about**: Entity is about another entity
- **mentions**: Entity mentions another entity
- **creator**: Entity was created by person
- **participant**: Entity participates in another
- **associatedWith**: Entities are associated
- **relatedTo**: Entities are related
- **temporal**: Time-based relationship
- **owns**: Person owns entity
- **memberOf**: Person is member of organization

## CLI Commands

### View Entity Statistics

```bash
# View entity graph statistics
moltbot memory entities status

# View for specific agent
moltbot memory entities status --agent my-agent

# JSON output
moltbot memory entities status --json
```

Example output:
```
Entity Graph Statistics

Total Entities: 42
Total Relationships: 18

Entity Types:
  Person: 25
  Organization: 10
  Place: 4
  Event: 3

Relationship Types:
  knows: 8
  worksFor: 7
  attendee: 3
```

## Architecture

### Entity Extraction Pipeline

1. **Text Analysis**: Conversation content is analyzed using an LLM
2. **Entity Recognition**: Entities are identified and typed
3. **Schema Validation**: Types are validated against Schema.org vocabulary
4. **Relationship Mapping**: Connections between entities are identified
5. **Storage**: Entities and relationships are stored in the memory database

### Database Schema

The memory database includes new tables for entity storage:

**entities table**:
- `id`: Unique identifier
- `type`: Schema.org entity type
- `name`: Entity name
- `description`: Optional description
- `properties`: JSON properties
- `source_session_file`: Source conversation file
- `source_chunk_id`: Source memory chunk
- `extracted_at`: Extraction timestamp
- `confidence`: Extraction confidence score

**relationships table**:
- `id`: Unique identifier
- `type`: Schema.org relationship type
- `source_entity_id`: Source entity reference
- `target_entity_id`: Target entity reference
- `properties`: JSON properties
- `source_session_file`: Source conversation file
- `source_chunk_id`: Source memory chunk
- `extracted_at`: Extraction timestamp
- `confidence`: Extraction confidence score

## Integration

The entity extraction system integrates seamlessly with the existing memory infrastructure:

- **Vector Search**: Entities complement semantic search
- **Session Transcripts**: Entities are extracted from conversations
- **Memory Files**: Entities are extracted from MEMORY.md and memory/*.md files
- **Knowledge Graph**: Build a comprehensive understanding of your data

## Configuration

Entity extraction can be configured in your agent settings:

```yaml
memory:
  entities:
    enabled: true
    minConfidence: 0.7
    maxEntitiesPerChunk: 50
    extractFromSessions: true
    extractFromMemoryFiles: true
```

## API Usage

### Extract Entities from Text

```typescript
import { extractEntitiesFromText } from "moltbot/memory";

const result = await extractEntitiesFromText(
  "John works at Acme Corp and knows Alice",
  {
    config: { enabled: true },
    llmExtract: async (prompt) => {
      // Your LLM extraction logic
      return jsonResponse;
    },
  }
);

console.log(result.entities); // [John (Person), Acme Corp (Organization), Alice (Person)]
console.log(result.relationships); // [John worksFor Acme Corp, John knows Alice]
```

### Query Entity Graph

```typescript
import { EntityGraphManager } from "moltbot/memory";

const manager = new EntityGraphManager(db);

// Query entities by type
const people = manager.queryEntities({ type: "Person" });

// Get entity relationships
const graph = manager.getEntityGraph(entityId);

// Get statistics
const stats = manager.getStats();
```

## Benefits

1. **Structured Knowledge**: Convert unstructured conversations into structured data
2. **Relationship Discovery**: Understand connections between entities
3. **Standard Vocabulary**: Use Schema.org for interoperability
4. **Enhanced Search**: Combine entity queries with vector search
5. **Knowledge Graph**: Build a comprehensive understanding over time

## References

- [SimpleMem](https://github.com/aiming-lab/SimpleMem): Memory management for LLM agents
- [Schema.org](https://schema.org/): Structured data vocabulary
- [Schema.org Documentation](https://schemaorg.github.io/docsite/)

## Future Enhancements

Planned improvements:

- Automatic entity extraction during memory indexing
- Entity-aware semantic search
- Visual knowledge graph exploration
- Entity merging and deduplication
- Custom entity type extensions
- Temporal relationship tracking
