/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const oracledb = require('oracledb');
import { IAdapter } from './IAdapter';
import { ConnectionConfig, QueryResult, TableInfo, DatabaseInfo, ColumnInfo, ProcedureInfo } from '../types';

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

export class OracleAdapter implements IAdapter {
  private conn: any = null;
  private connected = false;

  constructor(private readonly config: ConnectionConfig) {}

  async connect(): Promise<void> {
    const connectString = `${this.config.host || '127.0.0.1'}:${this.config.port || 1521}/${this.config.serviceName || this.config.database || 'XEPDB1'}`;
    this.conn = await oracledb.getConnection({ user: this.config.user, password: this.config.password, connectString });
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.conn) { await this.conn.close(); this.conn = null; this.connected = false; }
  }

  isConnected(): boolean { return this.connected; }

  async getDatabases(): Promise<DatabaseInfo[]> {
    if (!this.conn) throw new Error('Not connected');
    const result = await this.conn.execute(`SELECT SYS_CONTEXT('USERENV','CURRENT_USER') AS NAME FROM DUAL`);
    const name = result.rows?.[0]?.NAME ?? this.config.user ?? 'schema';
    return [{ name }];
  }

  async getTables(_database: string): Promise<TableInfo[]> {
    if (!this.conn) throw new Error('Not connected');
    const result = await this.conn.execute(
      `SELECT table_name AS NAME, 'TABLE' AS TYPE FROM user_tables
       UNION ALL SELECT view_name, 'VIEW' FROM user_views ORDER BY 2, 1`,
    );
    return (result.rows ?? []).map((r: any) => ({
      name: r.NAME as string,
      type: (r.TYPE as string) === 'VIEW' ? 'view' : 'table',
    }));
  }

  async getColumns(_database: string, table: string): Promise<ColumnInfo[]> {
    if (!this.conn) throw new Error('Not connected');
    const result = await this.conn.execute(
      `SELECT column_name AS NAME, data_type AS TYPE, nullable AS NULLABLE
       FROM user_tab_columns WHERE table_name = :1 ORDER BY column_id`,
      [table.toUpperCase()],
    );
    return (result.rows ?? []).map((r: any) => ({
      name: r.NAME as string, type: r.TYPE as string, nullable: r.NULLABLE === 'Y',
    }));
  }

  async query(sql: string, _database?: string): Promise<QueryResult> {
    if (!this.conn) throw new Error('Not connected');
    const start = Date.now();
    const result = await this.conn.execute(sql);
    if (!result.rows) {
      const affected = result.rowsAffected ?? 0;
      return {
        columns: ['affected_rows', 'status'],
        rows: [{ affected_rows: affected, status: 'Query OK' }],
        rowCount: affected,
        duration: Date.now() - start,
      };
    }
    const rows = result.rows as Record<string, unknown>[];
    const columns = (result.metaData ?? []).map((m: any) => m.name as string);
    return { columns: columns.length ? columns : Object.keys(rows[0] ?? {}), rows, rowCount: rows.length, duration: Date.now() - start };
  }

  async getProcedures(_database: string): Promise<ProcedureInfo[]> {
    if (!this.conn) throw new Error('Not connected');
    const result = await this.conn.execute(
      `SELECT object_name AS name, object_type AS type
       FROM user_objects
       WHERE object_type IN ('PROCEDURE', 'FUNCTION')
       ORDER BY object_type, object_name`,
    );
    return ((result.rows ?? []) as Record<string, unknown>[]).map((r) => ({
      name: r.NAME as string,
      type: (r.TYPE as string) === 'FUNCTION' ? 'function' : 'procedure',
    })) as ProcedureInfo[];
  }

  async getProcedureDefinition(_database: string, name: string, type: 'procedure' | 'function'): Promise<string> {
    if (!this.conn) throw new Error('Not connected');
    const objType = type === 'function' ? 'FUNCTION' : 'PROCEDURE';
    const result = await this.conn.execute(
      `SELECT DBMS_METADATA.GET_DDL(:1, :2) AS def FROM DUAL`,
      [objType, name.toUpperCase()],
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return String(rows[0]?.DEF ?? '');
  }
}
