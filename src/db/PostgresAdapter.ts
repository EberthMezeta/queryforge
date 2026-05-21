import { Client } from 'pg';
import { IAdapter } from './IAdapter';
import { ConnectionConfig, QueryResult, TableInfo, DatabaseInfo, ColumnInfo } from '../types';

export class PostgresAdapter implements IAdapter {
  private client: Client | null = null;
  private connected = false;

  constructor(private readonly config: ConnectionConfig) {}

  async connect(): Promise<void> {
    this.client = new Client({
      host: this.config.host || '127.0.0.1',
      port: this.config.port || 5432,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database || 'postgres',
      connectionTimeoutMillis: 10000,
    });
    await this.client.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    if (!this.client) throw new Error('Not connected');
    const result = await this.client.query(
      `SELECT datname AS name FROM pg_database
       WHERE datistemplate = false ORDER BY datname`
    );
    return result.rows;
  }

  async getTables(database: string): Promise<TableInfo[]> {
    return this.withDb(database, async (client) => {
      const result = await client.query(`
        SELECT table_name AS name, table_type
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_type, table_name
      `);
      return result.rows.map((r) => ({
        name: r.name,
        type: r.table_type === 'VIEW' ? 'view' : 'table',
      })) as TableInfo[];
    });
  }

  async getColumns(database: string, table: string): Promise<ColumnInfo[]> {
    return this.withDb(database, async (client) => {
      const result = await client.query(
        `SELECT column_name AS name, data_type AS type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [table]
      );
      return result.rows.map((r) => ({
        name: r.name,
        type: r.type,
        nullable: r.is_nullable === 'YES',
      }));
    });
  }

  async query(sql: string, database?: string): Promise<QueryResult> {
    const db = database || this.config.database || 'postgres';
    return this.withDb(db, async (client) => {
      const start = Date.now();
      const result = await client.query(sql);
      if (!result.fields?.length) {
        const affected = result.rowCount ?? 0;
        return {
          columns: ['affected_rows', 'command'],
          rows: [{ affected_rows: affected, command: result.command ?? 'OK' }],
          rowCount: affected,
          duration: Date.now() - start,
        };
      }
      return {
        columns: result.fields.map((f) => f.name),
        rows: result.rows ?? [],
        rowCount: result.rowCount ?? result.rows?.length ?? 0,
        duration: Date.now() - start,
      };
    });
  }

  private async withDb<T>(database: string, fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({
      host: this.config.host || '127.0.0.1',
      port: this.config.port || 5432,
      user: this.config.user,
      password: this.config.password,
      database,
      connectionTimeoutMillis: 10000,
    });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }
}
