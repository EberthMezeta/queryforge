import { BaseAdapter } from './BaseAdapter';
import { ISchemaAdapter, IProcedureAdapter } from './IAdapter';
import { ConnectionConfig, QueryResult, TableInfo, DatabaseInfo, ColumnInfo, ProcedureInfo } from '../types';
import { DEFAULT_PREVIEW_LIMIT } from '../constants';

// Internal Oracle type definitions — mirrors the oracledb API for lazy-loading safety.
// Avoids requiring oracledb to be installed at compile time (it is optional at runtime).
interface OracleBinds {
  [key: string]: unknown;
}

interface OracleResult {
  rows?: Record<string, unknown>[];
  rowsAffected?: number;
  metaData?: Array<{ name: string }>;
}

interface OracleConnection {
  execute(
    sql: string,
    binds?: unknown[] | OracleBinds,
    options?: { autoCommit?: boolean },
  ): Promise<OracleResult>;
  close(): Promise<void>;
}

interface OracleModule {
  OUT_FORMAT_OBJECT: number;
  outFormat: number;
  getConnection(params: { user?: string; password?: string; connectString: string }): Promise<OracleConnection>;
}

let _oracledb: OracleModule | null = null;

function getOracleDb(): OracleModule {
  if (!_oracledb) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _oracledb = require('oracledb') as OracleModule;
      _oracledb.outFormat = _oracledb.OUT_FORMAT_OBJECT;
    } catch {
      throw new Error('Oracle Database support requires oracledb installed separately. Run: npm install oracledb');
    }
  }
  return _oracledb;
}

export class OracleAdapter extends BaseAdapter implements ISchemaAdapter, IProcedureAdapter {
  private conn: OracleConnection | null = null;
  private connected = false;

  constructor(private readonly config: ConnectionConfig) { super(); }

  async connect(): Promise<void> {
    const oracledb = getOracleDb();
    const connectString = `${this.config.host || '127.0.0.1'}:${this.config.port || 1521}/${this.config.serviceName || this.config.database || 'XEPDB1'}`;
    this.conn = await oracledb.getConnection({ user: this.config.user, password: this.config.password, connectString });
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.conn) { await this.conn.close(); this.conn = null; this.connected = false; }
  }

  isConnected(): boolean { return this.connected; }

  async cancelQuery(_database?: string): Promise<void> { /* Oracle cancellation not supported via this adapter */ }

  buildDefaultQuery(table: string, _schema?: string): string {
    return `SELECT * FROM "${table}" FETCH FIRST ${DEFAULT_PREVIEW_LIMIT} ROWS ONLY`;
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    this.assertConnected();
    const result = await this.conn!.execute(`SELECT SYS_CONTEXT('USERENV','CURRENT_USER') AS NAME FROM DUAL`);
    const name = (result.rows?.[0] as Record<string, unknown>)?.['NAME'] ?? this.config.user ?? 'schema';
    return [{ name: String(name) }];
  }

  async getTables(_database: string): Promise<TableInfo[]> {
    this.assertConnected();
    const result = await this.conn!.execute(
      `SELECT table_name AS NAME, 'TABLE' AS TYPE FROM user_tables
       UNION ALL SELECT view_name, 'VIEW' FROM user_views ORDER BY 2, 1`,
    );
    return (result.rows ?? []).map((r) => ({
      name: String(r['NAME']),
      type: r['TYPE'] === 'VIEW' ? 'view' : 'table',
    })) as TableInfo[];
  }

  async getColumns(_database: string, table: string): Promise<ColumnInfo[]> {
    this.assertConnected();
    const result = await this.conn!.execute(
      `SELECT column_name AS NAME, data_type AS TYPE, nullable AS NULLABLE
       FROM user_tab_columns WHERE table_name = :1 ORDER BY column_id`,
      [table.toUpperCase()],
    );
    return (result.rows ?? []).map((r) => ({
      name: String(r['NAME']),
      type: String(r['TYPE']),
      nullable: r['NULLABLE'] === 'Y',
    }));
  }

  async query(sql: string, _database?: string): Promise<QueryResult> {
    this.assertConnected();
    const start = Date.now();
    const result = await this.conn!.execute(sql);
    if (!result.rows) {
      return this.dmlResult(result.rowsAffected ?? 0, Date.now() - start);
    }
    const columns = (result.metaData ?? []).map((m) => m.name);
    const rows = result.rows;
    return {
      columns: columns.length ? columns : Object.keys(rows[0] ?? {}),
      rows,
      rowCount: rows.length,
      duration: Date.now() - start,
    };
  }

  async getTableDDL(_database: string, table: string): Promise<string> {
    this.assertConnected();
    const result = await this.conn!.execute(
      `SELECT DBMS_METADATA.GET_DDL('TABLE', :1) AS DDL FROM DUAL`,
      [table.toUpperCase()],
    );
    return String((result.rows?.[0] as Record<string, unknown>)?.['DDL'] ?? '');
  }

  async getProcedures(_database: string): Promise<ProcedureInfo[]> {
    this.assertConnected();
    const result = await this.conn!.execute(
      `SELECT object_name AS NAME, object_type AS TYPE
       FROM user_objects WHERE object_type IN ('PROCEDURE', 'FUNCTION')
       ORDER BY object_type, object_name`,
    );
    return (result.rows ?? []).map((r) => ({
      name: String(r['NAME']),
      type: r['TYPE'] === 'FUNCTION' ? 'function' : 'procedure',
    })) as ProcedureInfo[];
  }

  async getProcedureDefinition(_database: string, name: string, type: 'procedure' | 'function'): Promise<string> {
    this.assertConnected();
    const objType = type === 'function' ? 'FUNCTION' : 'PROCEDURE';
    const result = await this.conn!.execute(
      `SELECT DBMS_METADATA.GET_DDL(:1, :2) AS DEF FROM DUAL`,
      [objType, name.toUpperCase()],
    );
    return String((result.rows?.[0] as Record<string, unknown>)?.['DEF'] ?? '');
  }

  async getPrimaryKeys(_database: string, table: string): Promise<string[]> {
    this.assertConnected();
    const result = await this.conn!.execute(
      `SELECT col.column_name AS COLUMN_NAME
       FROM user_constraints con
       JOIN user_cons_columns col ON con.constraint_name = col.constraint_name
       WHERE con.table_name = :1 AND con.constraint_type = 'P'
       ORDER BY col.position`,
      [table.toUpperCase()],
    );
    return (result.rows ?? []).map((r) => String((r as Record<string, unknown>)['COLUMN_NAME']));
  }

  async updateCell(_database: string, table: string, column: string, newValue: string | null, pkValues: Record<string, unknown>): Promise<void> {
    this.assertConnected();
    const pkEntries = Object.entries(pkValues);
    const binds: OracleBinds = { newVal: newValue };
    pkEntries.forEach(([, v], i) => { binds[`pk${i}`] = v; });
    const where = pkEntries.map(([k], i) => `"${k}" = :pk${i}`).join(' AND ');
    await this.conn!.execute(
      `UPDATE "${table}" SET "${column}" = :newVal WHERE ${where}`,
      binds,
      { autoCommit: true },
    );
  }
}
