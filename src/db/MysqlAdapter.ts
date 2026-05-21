import mysql from 'mysql2/promise';
import { IAdapter } from './IAdapter';
import { ConnectionConfig, QueryResult, TableInfo, DatabaseInfo, ColumnInfo } from '../types';

export class MysqlAdapter implements IAdapter {
  private pool: mysql.Pool | null = null;
  private connected = false;

  constructor(private readonly config: ConnectionConfig) {}

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

  isConnected(): boolean {
    return this.connected;
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    if (!this.pool) throw new Error('Not connected');
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>('SHOW DATABASES');
    return rows.map((r) => ({ name: r.Database as string }));
  }

  async getTables(database: string): Promise<TableInfo[]> {
    if (!this.pool) throw new Error('Not connected');
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_TYPE, TABLE_NAME`,
      [database]
    );
    return rows.map((r) => ({
      name: r.name as string,
      type: (r.type as string) === 'VIEW' ? 'view' : 'table',
    })) as TableInfo[];
  }

  async getColumns(database: string, table: string): Promise<ColumnInfo[]> {
    if (!this.pool) throw new Error('Not connected');
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [database, table]
    );
    return rows.map((r) => ({
      name: r.name as string,
      type: r.type as string,
      nullable: (r.nullable as string) === 'YES',
    }));
  }

  async query(sql: string, database?: string): Promise<QueryResult> {
    if (!this.pool) throw new Error('Not connected');
    const conn = await this.pool.getConnection();
    try {
      if (database) {
        await conn.query(`USE \`${database}\``);
      }
      const start = Date.now();
      const [rows, fields] = await conn.query(sql);
      const duration = Date.now() - start;

      if (Array.isArray(rows)) {
        const columns = Array.isArray(fields)
          ? (fields as mysql.FieldPacket[]).map((f) => f.name)
          : rows.length > 0 ? Object.keys(rows[0] as object) : [];
        return { columns, rows: rows as mysql.RowDataPacket[], rowCount: rows.length, duration };
      }

      // DML: UPDATE / INSERT / DELETE
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
      conn.release();
    }
  }
}
