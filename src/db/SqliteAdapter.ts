import initSqlJs, { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { IAdapter } from './IAdapter';
import { ConnectionConfig, QueryResult, TableInfo, DatabaseInfo, ColumnInfo } from '../types';

export class SqliteAdapter implements IAdapter {
  private db: Database | null = null;
  private connected = false;

  constructor(private readonly config: ConnectionConfig) {}

  async connect(): Promise<void> {
    if (!this.config.filename) throw new Error('SQLite filename is required');
    const wasmPath = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    const data = fs.readFileSync(this.config.filename);
    this.db = new SQL.Database(data);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    const ext = path.extname(this.config.filename || '');
    const name = path.basename(this.config.filename || 'database', ext);
    return [{ name }];
  }

  async getTables(_database: string): Promise<TableInfo[]> {
    if (!this.db) throw new Error('Not connected');
    const result = this.db.exec(`
      SELECT name, type FROM sqlite_master
      WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `);
    if (!result.length) return [];
    return result[0].values.map(([name, type]) => ({
      name: name as string,
      type: type === 'view' ? 'view' : 'table',
    })) as TableInfo[];
  }

  async getColumns(_database: string, table: string): Promise<ColumnInfo[]> {
    if (!this.db) throw new Error('Not connected');
    const result = this.db.exec(`PRAGMA table_info("${table.replace(/"/g, '""')}")`);
    if (!result.length) return [];
    // PRAGMA table_info columns: cid, name, type, notnull, dflt_value, pk
    return result[0].values.map((row) => ({
      name: row[1] as string,
      type: (row[2] as string) || 'TEXT',
      nullable: (row[3] as number) === 0,
    }));
  }

  async getTableDDL(_database: string, table: string): Promise<string> {
    if (!this.db) throw new Error('Not connected');
    const result = this.db.exec(
      `SELECT sql FROM sqlite_master WHERE name = '${table.replace(/'/g, "''")}' LIMIT 1`,
    );
    return (result[0]?.values[0]?.[0] as string) ?? '';
  }

  async getPrimaryKeys(_database: string, table: string): Promise<string[]> {
    if (!this.db) throw new Error('Not connected');
    const result = this.db.exec(`PRAGMA table_info("${table.replace(/"/g, '""')}")`);
    if (!result.length) return [];
    // columns: cid, name, type, notnull, dflt_value, pk
    return result[0].values
      .filter((row) => (row[5] as number) > 0)
      .sort((a, b) => (a[5] as number) - (b[5] as number))
      .map((row) => row[1] as string);
  }

  async updateCell(_database: string, table: string, column: string, newValue: string | null, pkValues: Record<string, unknown>): Promise<void> {
    const val = newValue === null ? 'NULL' : `'${newValue.replace(/'/g, "''")}'`;
    const where = Object.entries(pkValues)
      .map(([k, v]) => `"${k.replace(/"/g, '""')}" = ${v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`}`)
      .join(' AND ');
    await this.query(`UPDATE "${table.replace(/"/g, '""')}" SET "${column.replace(/"/g, '""')}" = ${val} WHERE ${where}`);
  }

  async query(sql: string, _database?: string): Promise<QueryResult> {
    if (!this.db) throw new Error('Not connected');
    const start = Date.now();
    const results = this.db.exec(sql);
    const duration = Date.now() - start;

    if (!results.length) {
      const affected = this.db.getRowsModified();
      // Persist any structural or data changes back to the file
      if (this.config.filename) {
        const data = this.db.export();
        fs.writeFileSync(this.config.filename, Buffer.from(data));
      }
      return {
        columns: ['affected_rows', 'status'],
        rows: [{ affected_rows: affected, status: 'Query OK' }],
        rowCount: affected,
        duration,
      };
    }

    const { columns, values } = results[0];
    const rows = values.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });

    return { columns, rows, rowCount: rows.length, duration };
  }
}
