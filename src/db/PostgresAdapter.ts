import { Client } from 'pg';
import { IAdapter } from './IAdapter';
import { ConnectionConfig, QueryResult, TableInfo, DatabaseInfo, ColumnInfo, ProcedureInfo } from '../types';

export class PostgresAdapter implements IAdapter {
  private mainClient: Client | null = null;
  private sessionClients = new Map<string, Client>();
  private connected = false;

  constructor(private readonly config: ConnectionConfig) {}

  private clientConfig(database?: string) {
    return {
      host: this.config.host || '127.0.0.1',
      port: this.config.port || 5432,
      user: this.config.user,
      password: this.config.password,
      database: database || this.config.database || 'postgres',
      connectionTimeoutMillis: 10000,
    };
  }

  async connect(): Promise<void> {
    this.mainClient = new Client(this.clientConfig());
    await this.mainClient.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    for (const c of this.sessionClients.values()) {
      await c.end().catch(() => {});
    }
    this.sessionClients.clear();
    if (this.mainClient) {
      await this.mainClient.end();
      this.mainClient = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    if (!this.mainClient) throw new Error('Not connected');
    const result = await this.mainClient.query(
      `SELECT datname AS name FROM pg_database WHERE datistemplate = false ORDER BY datname`,
    );
    return result.rows;
  }

  async getTables(database: string): Promise<TableInfo[]> {
    const client = await this.getSessionClient(database);
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
  }

  async getColumns(database: string, table: string): Promise<ColumnInfo[]> {
    const client = await this.getSessionClient(database);
    const result = await client.query(
      `SELECT column_name AS name, data_type AS type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table],
    );
    return result.rows.map((r) => ({
      name: r.name,
      type: r.type,
      nullable: r.is_nullable === 'YES',
    }));
  }

  async query(sql: string, database?: string): Promise<QueryResult> {
    const db = database || this.config.database || 'postgres';
    const client = await this.getSessionClient(db);
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
  }

  async getTableDDL(database: string, table: string): Promise<string> {
    const client = await this.getSessionClient(database);
    const result = await client.query(
      `SELECT 'CREATE TABLE ' || quote_ident(table_name) || E' (\n' ||
              string_agg(
                '  ' || quote_ident(column_name) || ' ' || data_type ||
                CASE WHEN character_maximum_length IS NOT NULL
                     THEN '(' || character_maximum_length || ')' ELSE '' END ||
                CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END,
                E',\n' ORDER BY ordinal_position
              ) || E'\n);' AS ddl
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       GROUP BY table_name`,
      [table],
    );
    return (result.rows[0]?.ddl as string) ?? '';
  }

  async cancelQuery(database?: string): Promise<void> {
    const db = database || this.config.database || 'postgres';
    const client = this.sessionClients.get(db);
    if (client) {
      await client.end().catch(() => {});
      this.sessionClients.delete(db);
    }
  }

  async getProcedures(database: string): Promise<ProcedureInfo[]> {
    const client = await this.getSessionClient(database);
    const result = await client.query(`
      SELECT routine_name AS name, routine_type AS type
      FROM information_schema.routines
      WHERE routine_schema = 'public'
      ORDER BY routine_type, routine_name
    `);
    return result.rows.map((r) => ({
      name: r.name as string,
      type: (r.type as string) === 'FUNCTION' ? 'function' : 'procedure',
    })) as ProcedureInfo[];
  }

  async getProcedureDefinition(database: string, name: string): Promise<string> {
    const client = await this.getSessionClient(database);
    const result = await client.query(
      `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = $1
       LIMIT 1`,
      [name],
    );
    return (result.rows[0]?.def as string) ?? '';
  }

  async getPrimaryKeys(database: string, table: string): Promise<string[]> {
    const client = await this.getSessionClient(database);
    const result = await client.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'public' AND tc.table_name = $1
         AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position`,
      [table],
    );
    return result.rows.map((r) => r.column_name as string);
  }

  async updateCell(database: string, table: string, column: string, newValue: string | null, pkValues: Record<string, unknown>): Promise<void> {
    const client = await this.getSessionClient(database);
    const pkEntries = Object.entries(pkValues);
    const params: unknown[] = [newValue];
    const where = pkEntries.map(([k, v], i) => { params.push(v); return `"${k}" = $${i + 2}`; }).join(' AND ');
    await client.query(`UPDATE "${table}" SET "${column}" = $1 WHERE ${where}`, params);
  }

  private async getSessionClient(database: string): Promise<Client> {
    let client = this.sessionClients.get(database);
    if (!client) {
      client = new Client(this.clientConfig(database));
      await client.connect();
      this.sessionClients.set(database, client);
    }
    return client;
  }
}
