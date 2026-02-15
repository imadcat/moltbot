import type { DatabaseSync } from "node:sqlite";

export function ensureMemoryIndexSchema(params: {
  db: DatabaseSync;
  embeddingCacheTable: string;
  ftsTable: string;
  ftsEnabled: boolean;
}): { ftsAvailable: boolean; ftsError?: string } {
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'memory',
      hash TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL
    );
  `);
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'memory',
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      model TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS ${params.embeddingCacheTable} (
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      hash TEXT NOT NULL,
      embedding TEXT NOT NULL,
      dims INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (provider, model, provider_key, hash)
    );
  `);
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_embedding_cache_updated_at ON ${params.embeddingCacheTable}(updated_at);`,
  );

  let ftsAvailable = false;
  let ftsError: string | undefined;
  if (params.ftsEnabled) {
    try {
      params.db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${params.ftsTable} USING fts5(\n` +
          `  text,\n` +
          `  id UNINDEXED,\n` +
          `  path UNINDEXED,\n` +
          `  source UNINDEXED,\n` +
          `  model UNINDEXED,\n` +
          `  start_line UNINDEXED,\n` +
          `  end_line UNINDEXED\n` +
          `);`,
      );
      ftsAvailable = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ftsAvailable = false;
      ftsError = message;
    }
  }

  ensureColumn(params.db, "files", "source", "TEXT NOT NULL DEFAULT 'memory'");
  ensureColumn(params.db, "chunks", "source", "TEXT NOT NULL DEFAULT 'memory'");
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);`);
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);`);

  // Entity and relationship tables for Schema.org aligned knowledge graph
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      properties TEXT,
      source_session_file TEXT,
      source_chunk_id TEXT,
      extracted_at INTEGER NOT NULL,
      confidence REAL,
      FOREIGN KEY (source_chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
    );
  `);
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);`);
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);`);
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_entities_source_chunk ON entities(source_chunk_id);`,
  );

  params.db.exec(`
    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      source_entity_id TEXT NOT NULL,
      target_entity_id TEXT NOT NULL,
      properties TEXT,
      source_session_file TEXT,
      source_chunk_id TEXT,
      extracted_at INTEGER NOT NULL,
      confidence REAL,
      FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
      FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
      FOREIGN KEY (source_chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
    );
  `);
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(type);`);
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_entity_id);`,
  );
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_entity_id);`,
  );

  // Atomic facts table for SimpleMem semantic compression
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS atomic_facts (
      id TEXT PRIMARY KEY,
      statement TEXT NOT NULL,
      keywords TEXT NOT NULL,
      persons TEXT NOT NULL,
      entities TEXT NOT NULL,
      topic TEXT,
      timestamp TEXT,
      location TEXT,
      source_window_id TEXT,
      source_chunk_id TEXT,
      source_session_file TEXT,
      confidence REAL NOT NULL,
      entropy REAL,
      extracted_at INTEGER NOT NULL,
      level INTEGER NOT NULL DEFAULT 0,
      parent_id TEXT,
      FOREIGN KEY (source_chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES atomic_facts(id) ON DELETE CASCADE
    );
  `);
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_atomic_facts_level ON atomic_facts(level);`);
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_atomic_facts_source_chunk ON atomic_facts(source_chunk_id);`,
  );
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_atomic_facts_topic ON atomic_facts(topic);`);
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_atomic_facts_timestamp ON atomic_facts(timestamp);`,
  );
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_atomic_facts_parent ON atomic_facts(parent_id);`);

  // Conversation windows for semantic compression
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_windows (
      id TEXT PRIMARY KEY,
      turns TEXT NOT NULL,
      start_index INTEGER NOT NULL,
      end_index INTEGER NOT NULL,
      entropy REAL,
      should_process INTEGER NOT NULL DEFAULT 1,
      processed_at INTEGER,
      source_session_file TEXT
    );
  `);
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_conversation_windows_processed ON conversation_windows(processed_at);`,
  );

  // Compression statistics for performance tracking
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS compression_stats (
      id TEXT PRIMARY KEY,
      input_tokens INTEGER NOT NULL,
      output_facts INTEGER NOT NULL,
      compression_ratio REAL NOT NULL,
      entropy_score REAL NOT NULL,
      processing_time_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      source_session_file TEXT
    );
  `);
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_compression_stats_created_at ON compression_stats(created_at);`,
  );

  return { ftsAvailable, ...(ftsError ? { ftsError } : {}) };
}

function ensureColumn(
  db: DatabaseSync,
  table: "files" | "chunks",
  column: string,
  definition: string,
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
