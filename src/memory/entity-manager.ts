/**
 * Entity graph manager for storing and retrieving entities and relationships
 */

import type { DatabaseSync } from "node:sqlite";
import type { Entity, EntityGraph, Relationship } from "./entity-types.js";

export type EntityQueryOptions = {
  type?: string;
  name?: string;
  limit?: number;
};

export type RelationshipQueryOptions = {
  type?: string;
  sourceEntityId?: string;
  targetEntityId?: string;
  limit?: number;
};

/**
 * Entity graph manager for database operations
 */
export class EntityGraphManager {
  constructor(private db: DatabaseSync) {}

  /**
   * Store an entity in the database
   */
  storeEntity(entity: Entity): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO entities (
        id, type, name, description, properties,
        source_session_file, source_chunk_id, extracted_at, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entity.id,
      entity.type,
      entity.name,
      entity.description ?? null,
      JSON.stringify(entity.properties),
      entity.sourceSessionFile ?? null,
      entity.sourceChunkId ?? null,
      entity.extractedAt,
      entity.confidence ?? null,
    );
  }

  /**
   * Store multiple entities in a transaction
   */
  storeEntities(entities: Entity[]): void {
    this.db.exec("BEGIN TRANSACTION");
    try {
      for (const entity of entities) {
        this.storeEntity(entity);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Store a relationship in the database
   */
  storeRelationship(relationship: Relationship): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO relationships (
        id, type, source_entity_id, target_entity_id, properties,
        source_session_file, source_chunk_id, extracted_at, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      relationship.id,
      relationship.type,
      relationship.sourceEntityId,
      relationship.targetEntityId,
      JSON.stringify(relationship.properties),
      relationship.sourceSessionFile ?? null,
      relationship.sourceChunkId ?? null,
      relationship.extractedAt,
      relationship.confidence ?? null,
    );
  }

  /**
   * Store multiple relationships in a transaction
   */
  storeRelationships(relationships: Relationship[]): void {
    this.db.exec("BEGIN TRANSACTION");
    try {
      for (const rel of relationships) {
        this.storeRelationship(rel);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Store an entire entity graph (entities + relationships)
   */
  storeEntityGraph(graph: EntityGraph): void {
    this.db.exec("BEGIN TRANSACTION");
    try {
      for (const entity of graph.entities) {
        this.storeEntity(entity);
      }
      for (const rel of graph.relationships) {
        this.storeRelationship(rel);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Query entities from the database
   */
  queryEntities(options: EntityQueryOptions = {}): Entity[] {
    let query = "SELECT * FROM entities WHERE 1=1";
    const params: unknown[] = [];

    if (options.type) {
      query += " AND type = ?";
      params.push(options.type);
    }

    if (options.name) {
      query += " AND name LIKE ?";
      params.push(`%${options.name}%`);
    }

    query += " ORDER BY extracted_at DESC";

    if (options.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Array<{
      id: string;
      type: string;
      name: string;
      description: string | null;
      properties: string;
      source_session_file: string | null;
      source_chunk_id: string | null;
      extracted_at: number;
      confidence: number | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      type: row.type as Entity["type"],
      name: row.name,
      description: row.description ?? undefined,
      properties: JSON.parse(row.properties) as Record<string, unknown>,
      sourceSessionFile: row.source_session_file ?? undefined,
      sourceChunkId: row.source_chunk_id ?? undefined,
      extractedAt: row.extracted_at,
      confidence: row.confidence ?? undefined,
    }));
  }

  /**
   * Get entity by ID
   */
  getEntityById(id: string): Entity | null {
    const entities = this.queryEntities({});
    return entities.find((e) => e.id === id) ?? null;
  }

  /**
   * Query relationships from the database
   */
  queryRelationships(options: RelationshipQueryOptions = {}): Relationship[] {
    let query = "SELECT * FROM relationships WHERE 1=1";
    const params: unknown[] = [];

    if (options.type) {
      query += " AND type = ?";
      params.push(options.type);
    }

    if (options.sourceEntityId) {
      query += " AND source_entity_id = ?";
      params.push(options.sourceEntityId);
    }

    if (options.targetEntityId) {
      query += " AND target_entity_id = ?";
      params.push(options.targetEntityId);
    }

    query += " ORDER BY extracted_at DESC";

    if (options.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Array<{
      id: string;
      type: string;
      source_entity_id: string;
      target_entity_id: string;
      properties: string;
      source_session_file: string | null;
      source_chunk_id: string | null;
      extracted_at: number;
      confidence: number | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      type: row.type as Relationship["type"],
      sourceEntityId: row.source_entity_id,
      targetEntityId: row.target_entity_id,
      properties: JSON.parse(row.properties) as Record<string, unknown>,
      sourceSessionFile: row.source_session_file ?? undefined,
      sourceChunkId: row.source_chunk_id ?? undefined,
      extractedAt: row.extracted_at,
      confidence: row.confidence ?? undefined,
    }));
  }

  /**
   * Get all relationships for an entity (both incoming and outgoing)
   */
  getEntityRelationships(entityId: string): {
    outgoing: Relationship[];
    incoming: Relationship[];
  } {
    const outgoing = this.queryRelationships({ sourceEntityId: entityId });
    const incoming = this.queryRelationships({ targetEntityId: entityId });
    return { outgoing, incoming };
  }

  /**
   * Get entity graph (entities and relationships) for a specific entity
   * Includes the entity itself and all directly connected entities
   */
  getEntityGraph(entityId: string): EntityGraph {
    const entity = this.getEntityById(entityId);
    if (!entity) {
      return { entities: [], relationships: [] };
    }

    const { outgoing, incoming } = this.getEntityRelationships(entityId);
    const relatedEntityIds = new Set<string>();

    for (const rel of [...outgoing, ...incoming]) {
      relatedEntityIds.add(rel.sourceEntityId);
      relatedEntityIds.add(rel.targetEntityId);
    }

    const entities: Entity[] = [entity];
    for (const id of relatedEntityIds) {
      if (id !== entityId) {
        const relEntity = this.getEntityById(id);
        if (relEntity) {
          entities.push(relEntity);
        }
      }
    }

    return {
      entities,
      relationships: [...outgoing, ...incoming],
    };
  }

  /**
   * Get statistics about stored entities and relationships
   */
  getStats(): {
    totalEntities: number;
    totalRelationships: number;
    entityTypeBreakdown: Record<string, number>;
    relationshipTypeBreakdown: Record<string, number>;
  } {
    const totalEntities = (
      this.db.prepare("SELECT COUNT(*) as count FROM entities").get() as { count: number }
    ).count;

    const totalRelationships = (
      this.db.prepare("SELECT COUNT(*) as count FROM relationships").get() as { count: number }
    ).count;

    const entityTypeRows = this.db
      .prepare("SELECT type, COUNT(*) as count FROM entities GROUP BY type")
      .all() as Array<{ type: string; count: number }>;

    const entityTypeBreakdown: Record<string, number> = {};
    for (const row of entityTypeRows) {
      entityTypeBreakdown[row.type] = row.count;
    }

    const relTypeRows = this.db
      .prepare("SELECT type, COUNT(*) as count FROM relationships GROUP BY type")
      .all() as Array<{ type: string; count: number }>;

    const relationshipTypeBreakdown: Record<string, number> = {};
    for (const row of relTypeRows) {
      relationshipTypeBreakdown[row.type] = row.count;
    }

    return {
      totalEntities,
      totalRelationships,
      entityTypeBreakdown,
      relationshipTypeBreakdown,
    };
  }

  /**
   * Clear all entities and relationships
   */
  clear(): void {
    this.db.exec("BEGIN TRANSACTION");
    try {
      this.db.exec("DELETE FROM relationships");
      this.db.exec("DELETE FROM entities");
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}
