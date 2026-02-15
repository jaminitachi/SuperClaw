import type Database from 'better-sqlite3';

export interface Entity {
  id: number;
  name: string;
  type: string;
  properties: Record<string, unknown> | null;
}

export interface Relation {
  id: number;
  fromEntity: string;
  toEntity: string;
  relationType: string;
  weight: number;
  properties: Record<string, unknown> | null;
}

export class KnowledgeGraph {
  constructor(private db: Database.Database) {}

  addEntity(name: string, type: string, properties?: Record<string, unknown>): number {
    const result = this.db.prepare(
      'INSERT OR REPLACE INTO entities (name, type, properties, updated_at) VALUES (?, ?, ?, datetime("now"))'
    ).run(name, type, properties ? JSON.stringify(properties) : null);
    return Number(result.lastInsertRowid);
  }

  addRelation(fromName: string, toName: string, relationType: string, weight = 1.0, properties?: Record<string, unknown>): number | null {
    const from = this.db.prepare('SELECT id FROM entities WHERE name = ?').get(fromName) as any;
    const to = this.db.prepare('SELECT id FROM entities WHERE name = ?').get(toName) as any;
    if (!from || !to) return null;

    const result = this.db.prepare(
      'INSERT INTO relations (from_entity, to_entity, relation_type, weight, properties) VALUES (?, ?, ?, ?, ?)'
    ).run(from.id, to.id, relationType, weight, properties ? JSON.stringify(properties) : null);
    return Number(result.lastInsertRowid);
  }

  getEntity(name: string): Entity | null {
    const row = this.db.prepare('SELECT * FROM entities WHERE name = ?').get(name) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      properties: row.properties ? JSON.parse(row.properties) : null,
    };
  }

  getRelationsFor(entityName: string): Relation[] {
    const entity = this.db.prepare('SELECT id FROM entities WHERE name = ?').get(entityName) as any;
    if (!entity) return [];

    const rows = this.db.prepare(`
      SELECT r.id, e1.name as from_name, e2.name as to_name, r.relation_type, r.weight, r.properties
      FROM relations r
      JOIN entities e1 ON e1.id = r.from_entity
      JOIN entities e2 ON e2.id = r.to_entity
      WHERE r.from_entity = ? OR r.to_entity = ?
    `).all(entity.id, entity.id) as any[];

    return rows.map((r) => ({
      id: r.id,
      fromEntity: r.from_name,
      toEntity: r.to_name,
      relationType: r.relation_type,
      weight: r.weight,
      properties: r.properties ? JSON.parse(r.properties) : null,
    }));
  }

  findPath(fromName: string, toName: string, maxDepth = 5): string[][] {
    const from = this.db.prepare('SELECT id FROM entities WHERE name = ?').get(fromName) as any;
    const to = this.db.prepare('SELECT id FROM entities WHERE name = ?').get(toName) as any;
    if (!from || !to) return [];

    // BFS
    const paths: string[][] = [];
    const queue: { entityId: number; path: string[] }[] = [{ entityId: from.id, path: [fromName] }];
    const visited = new Set<number>();

    while (queue.length > 0 && paths.length < 5) {
      const current = queue.shift()!;
      if (current.path.length > maxDepth) continue;
      if (visited.has(current.entityId)) continue;
      visited.add(current.entityId);

      if (current.entityId === to.id) {
        paths.push(current.path);
        continue;
      }

      const neighbors = this.db.prepare(`
        SELECT CASE WHEN r.from_entity = ? THEN r.to_entity ELSE r.from_entity END as neighbor_id,
               CASE WHEN r.from_entity = ? THEN e2.name ELSE e1.name END as neighbor_name,
               r.relation_type
        FROM relations r
        JOIN entities e1 ON e1.id = r.from_entity
        JOIN entities e2 ON e2.id = r.to_entity
        WHERE r.from_entity = ? OR r.to_entity = ?
      `).all(current.entityId, current.entityId, current.entityId, current.entityId) as any[];

      for (const n of neighbors) {
        if (!visited.has(n.neighbor_id)) {
          queue.push({
            entityId: n.neighbor_id,
            path: [...current.path, `--[${n.relation_type}]-->`, n.neighbor_name],
          });
        }
      }
    }

    return paths;
  }

  getEntitiesByType(type: string): Entity[] {
    const rows = this.db.prepare('SELECT * FROM entities WHERE type = ? ORDER BY name').all(type) as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      properties: r.properties ? JSON.parse(r.properties) : null,
    }));
  }

  getStats(): { entities: number; relations: number; types: Record<string, number> } {
    const entities = (this.db.prepare('SELECT COUNT(*) as c FROM entities').get() as any).c;
    const relations = (this.db.prepare('SELECT COUNT(*) as c FROM relations').get() as any).c;
    const typeRows = this.db.prepare('SELECT type, COUNT(*) as c FROM entities GROUP BY type').all() as any[];
    const types: Record<string, number> = {};
    for (const r of typeRows) types[r.type] = r.c;
    return { entities, relations, types };
  }
}
