import mysql from 'mysql2/promise';
import { BaseAdapter } from './BaseAdapter';
import { ISchemaAdapter, IProcedureAdapter } from './IAdapter';
import { ConnectionConfig, QueryResult, TableInfo, DatabaseInfo, ColumnInfo, ProcedureInfo } from '../types';

export class MysqlAdapter extends BaseAdapter implements ISchemaAdapter, IProcedureAdapter {
  private pool: mysql.Pool | null = null;
  private connected = false;
  private activeConn: mysql.PoolConnection | null = null;

  constructor(private readonly config: ConnectionConfig) { super(); }

  async connect(): Promise<void> {
    this.pool = mysql.createPool({
      host: this.config.host || '127.0.0.1',
      port: this.config.port || 3306,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database || undefined,
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 10000,
    });
    const conn = await this.pool.getConnection();
    conn.release();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.connected = false;
    }
  }

  isConnected(): boolean { return this.connected; }

  buildDefaultQuery(table: string, _schema?: string): string {
    return `SELECT * FROM \`${table}\` LIMIT 150`;
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    this.assertConnected();
    const [rows] = await this.pool!.query<mysql.RowDataPacket[]>('SHOW DATABASES');
    return rows.map((r) => ({ name: r.Database as string }));
  }

  async getTables(database: string): Promise<TableInfo[]> {
    this.assertConnected();
    const [rows] = await this.pool!.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_TYPE, TABLE_NAME`,
      [database],
    );
    return rows.map((r) => ({
      name: r.name as string,
      type: (r.type as string) === 'VIEW' ? 'view' : 'table',
    })) as TableInfo[];
  }

  async getColumns(database: string, table: string): Promise<ColumnInfo[]> {
    this.assertConnected();
    const [rows] = await this.pool!.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [database, table],
    );
    return rows.map((r) => ({
      name: r.name as string,
      type: r.type as string,
      nullable: (r.nullable as string) === 'YES',
    }));
  }

  async cancelQuery(): Promise<void> {
    if (this.activeConn) {
      this.activeConn.destroy();
      this.activeConn = null;
    }
  }

  async query(sql: string, database?: string): Promise<QueryResult> {
    this.assertConnected();
    const conn = await this.pool!.getConnection();
    this.activeConn = conn;
    try {
      if (database) await conn.query(`USE \`${database}\``);
      const start = Date.now();
      const [rows, fields] = await conn.query(sql);
      const duration = Date.now() - start;

      if (Array.isArray(rows)) {
        const columns = Array.isArray(fields)
          ? (fields as mysql.FieldPacket[]).map((f) => f.name)
          : rows.length > 0 ? Object.keys(rows[0] as object) : [];
        return { columns, rows: rows as mysql.RowDataPacket[], rowCount: rows.length, duration };
      }

      const ok = rows as mysql.OkPacket;
      return {
        columns: ['affected_rows', 'changed_rows', 'insert_id', 'info'],
        rows: [{
          affected_rows: ok.affectedRows,
          changed_rows: ok.changedRows ?? 0,
          insert_id: ok.insertId ?? 0,
          info: ok.message || 'Query OK',
        }],
        rowCount: ok.affectedRows,
        duration,
      };
    } finally {
      this.activeConn = null;
      conn.release();
    }
  }

  async getTableDDL(database: string, table: string): Promise<string> {
    this.assertConnected();
    const conn = await this.pool!.getConnection();
    try {
      await conn.query(`USE \`${database}\``);
      const [rows] = await conn.query<mysql.RowDataPacket[]>(`SHOW CREATE TABLE \`${table}\``);
      return (rows[0]?.['Create Table'] ?? rows[0]?.['Create View'] ?? '') as string;
    } finally {
      conn.release();
    }
  }

  async getProcedures(database: string): Promise<ProcedureInfo[]> {
    this.assertConnected();
    const [rows] = await this.pool!.query<mysql.RowDataPacket[]>(
      `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type
       FROM information_schema.ROUTINES
       WHERE ROUTINE_SCHEMA = ?
       ORDER BY ROUTINE_TYPE, ROUTINE_NAME`,
      [database],
    );
    return rows.map((r) => ({
      name: r.name as string,
      type: (r.type as string) === 'FUNCTION' ? 'function' : 'procedure',
    })) as ProcedureInfo[];
  }

  async getPrimaryKeys(database: string, table: string): Promise<string[]> {
    this.assertConnected();
    const [rows] = await this.pool!.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
       ORDER BY ORDINAL_POSITION`,
      [database, table],
    );
    return rows.map((r) => r.COLUMN_NAME as string);
  }

  async updateCell(database: string, table: string, column: string, newValue: string | null, pkValues: Record<string, unknown>): Promise<void> {
    this.assertConnected();
    const pkEntries = Object.entries(pkValues);
    if (!pkEntries.length) throw new Error('Cannot update row without primary key values');
    const where = pkEntries.map(([k]) => `\`${k}\` = ?`).join(' AND ');
    const params: unknown[] = [newValue, ...pkEntries.map(([, v]) => v)];
    const conn = await this.pool!.getConnection();
    try {
      await conn.execute(`UPDATE \`${database}\`.\`${table}\` SET \`${column}\` = ? WHERE ${where}`, params as import('mysql2').ExecuteValues);
    } finally {
      conn.release();
    }
  }

  async getProcedureDefinition(database: string, name: string, type: 'procedure' | 'function'): Promise<string> {
    this.assertConnected();
    const keyword = type === 'function' ? 'FUNCTION' : 'PROCEDURE';
    const col = type === 'function' ? 'Create Function' : 'Create Procedure';
    const conn = await this.pool!.getConnection();
    try {
      await conn.query(`USE \`${database}\``);
      const [rows] = await conn.query<mysql.RowDataPacket[]>(`SHOW CREATE ${keyword} \`${name}\``);
      return (rows[0]?.[col] as string) ?? '';
    } finally {
      conn.release();
    }
  }
}
