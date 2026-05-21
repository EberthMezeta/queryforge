/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const oracledb = require('oracledb');
import { BaseAdapter } from './BaseAdapter';
import { ISchemaAdapter, IProcedureAdapter } from './IAdapter';
import { ConnectionConfig, QueryResult, TableInfo, DatabaseInfo, ColumnInfo, ProcedureInfo } from '../types';

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

export class OracleAdapter extends BaseAdapter implements ISchemaAdapter, IProcedureAdapter {
  private conn: any = null;
  private connected = false;

  constructor(private readonly config: ConnectionConfig) { super(); }

  async connect(): Promise<void> {
    const connectString = `${this.config.host || '127.0.0.1'}:${this.config.port || 1521}/${this.config.serviceName || this.config.database || 'XEPDB1'}`;
    this.conn = await oracledb.getConnection({ user: this.config.user, password: this.config.password, connectString });
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.conn) { await this.conn.close(); this.conn = null; this.connected = false; }
  }

  isConnected(): boolean { return this.connected; }

  buildDefaultQuery(table: string, _schema?: string): string {
    return `SELECT * FROM "${table}" FETCH FIRST 150 ROWS ONLY`;
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    this.assertConnected();
    const result = await this.conn.execute(`SELECT SYS_CONTEXT('USERENV','CURRENT_USER') AS NAME FROM DUAL`);
    const name = result.rows?.[0]?.NAME ?? this.config.user ?? 'schema';
    return [{ name }];
  }

  async getTables(_database: string): Promise<TableInfo[]> {
    this.assertConnected();
    const result = await this.conn.execute(
      `SELECT table_name AS NAME, 'TABLE' AS TYPE FROM user_tables
       UNION ALL SELECT view_name, 'VIEW' FROM user_views ORDER BY 2, 1`,
    );
    return ((result.rows ?? []) as any[]).map((r) => ({
      name: r.NAME as string,
      type: (r.TYPE as string) === 'VIEW' ? 'view' : 'table',
    }));
  }

  async getColumns(_database: string, table: string): Promise<ColumnInfo[]> {
    this.assertConnected();
    const result = await this.conn.execute(
      `SELECT column_name AS NAME, data_type AS TYPE, nullable AS NULLABLE
       FROM user_tab_columns WHERE table_name = :1 ORDER BY column_id`,
      [table.toUpperCase()],
    );
    return ((result.rows ?? []) as any[]).map((r) => ({
      name: r.NAME as string, type: r.TYPE as string, nullable: r.NULLABLE === 'Y',
    }));
  }

  async query(sql: string, _database?: string): Promise<QueryResult> {
    this.assertConnected();
    const start = Date.now();
    const result = await this.conn.execute(sql);
    if (!result.rows) {
      return this.dmlResult(result.rowsAffected ?? 0, Date.now() - start);
    }
    const rows = result.rows as Record<string, unknown>[];
    const columns = ((result.metaData ?? []) as any[]).map((m) => m.name as string);
    return {
      columns: columns.length ? columns : Object.keys(rows[0] ?? {}),
      rows,
      rowCount: rows.length,
      duration: Date.now() - start,
    };
  }

  async getTableDDL(_database: string, table: string): Promise<string> {
    this.assertConnected();
    const result = await this.conn.execute(
      `SELECT DBMS_METADATA.GET_DDL('TABLE', :1) AS ddl FROM DUAL`,
      [table.toUpperCase()],
    );
    return String(((result.rows ?? []) as Record<string, unknown>[])[0]?.DDL ?? '');
  }

  async getProcedures(_database: string): Promise<ProcedureInfo[]> {
    this.assertConnected();
    const result = await this.conn.execute(
      `SELECT object_name AS name, object_type AS type
       FROM user_objects WHERE object_type IN ('PROCEDURE', 'FUNCTION')
       ORDER BY object_type, object_name`,
    );
    return ((result.rows ?? []) as Record<string, unknown>[]).map((r) => ({
      name: r.NAME as string,
      type: (r.TYPE as string) === 'FUNCTION' ? 'function' : 'procedure',
    })) as ProcedureInfo[];
  }

  async getProcedureDefinition(_database: string, name: string, type: 'procedure' | 'function'): Promise<string> {
    this.assertConnected();
    const objType = type === 'function' ? 'FUNCTION' : 'PROCEDURE';
    const result = await this.conn.execute(
      `SELECT DBMS_METADATA.GET_DDL(:1, :2) AS def FROM DUAL`,
      [objType, name.toUpperCase()],
    );
    return String(((result.rows ?? []) as Record<string, unknown>[])[0]?.DEF ?? '');
  }

  async getPrimaryKeys(_database: string, table: string): Promise<string[]> {
    this.assertConnected();
    const result = await this.conn.execute(
      `SELECT col.column_name
       FROM user_constraints con
       JOIN user_cons_columns col ON con.constraint_name = col.constraint_name
       WHERE con.table_name = :1 AND con.constraint_type = 'P'
       ORDER BY col.position`,
      [table.toUpperCase()],
    );
    return ((result.rows ?? []) as Record<string, unknown>[]).map((r) => r.COLUMN_NAME as string);
  }

  async updateCell(_database: string, table: string, column: string, newValue: string | null, pkValues: Record<string, unknown>): Promise<void> {
    this.assertConnected();
    const pkEntries = Object.entries(pkValues);
    const binds: Record<string, unknown> = { newVal: newValue };
    pkEntries.forEach(([, v], i) => { binds[`pk${i}`] = v; });
    const where = pkEntries.map(([k], i) => `"${k}" = :pk${i}`).join(' AND ');
    await this.conn.execute(
      `UPDATE "${table}" SET "${column}" = :newVal WHERE ${where}`,
      binds,
      { autoCommit: true },
    );
  }
}
