import * as mssql from 'mssql';
import { IAdapter } from './IAdapter';
import { ConnectionConfig, QueryResult, TableInfo, DatabaseInfo, ColumnInfo, ProcedureInfo } from '../types';

export class SqlServerAdapter implements IAdapter {
  private pool: mssql.ConnectionPool | null = null;
  private connected = false;

  constructor(private readonly config: ConnectionConfig) {}

  async connect(): Promise<void> {
    this.pool = new mssql.ConnectionPool({
      server: this.config.host || '127.0.0.1',
      port: this.config.port || 1433,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database || 'master',
      options: {
        trustServerCertificate: true,
        encrypt: this.config.encrypt ?? false,
        connectTimeout: 10000,
      },
    });
    await this.pool.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    if (!this.pool) throw new Error('Not connected');
    const result = await this.pool.request().query(
      `SELECT name FROM sys.databases WHERE state_desc = 'ONLINE' ORDER BY name`,
    );
    return result.recordset.map((r) => ({ name: r.name as string }));
  }

  async getTables(database: string): Promise<TableInfo[]> {
    if (!this.pool) throw new Error('Not connected');
    const result = await this.pool.request().query(`
      SELECT TABLE_NAME AS name, TABLE_TYPE AS type
      FROM [${database}].INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'dbo'
      ORDER BY TABLE_TYPE, TABLE_NAME
    `);
    return result.recordset.map((r) => ({
      name: r.name as string,
      type: (r.type as string).trim() === 'VIEW' ? 'view' : 'table',
    }));
  }

  async getColumns(database: string, table: string): Promise<ColumnInfo[]> {
    if (!this.pool) throw new Error('Not connected');
    const result = await this.pool.request().query(`
      SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable
      FROM [${database}].INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '${table.replace(/'/g, "''")}'
      ORDER BY ORDINAL_POSITION
    `);
    return result.recordset.map((r) => ({
      name: r.name as string,
      type: r.type as string,
      nullable: (r.nullable as string) === 'YES',
    }));
  }

  async query(sql: string, database?: string): Promise<QueryResult> {
    if (!this.pool) throw new Error('Not connected');
    const req = this.pool.request();
    const start = Date.now();
    const fullSql = database ? `USE [${database}]; ${sql}` : sql;
    const result = await req.query(fullSql);
    const rs = result.recordset ?? [];
    const affected = result.rowsAffected[0] ?? 0;
    if (!rs.length && result.recordset === undefined) {
      return {
        columns: ['affected_rows', 'status'],
        rows: [{ affected_rows: affected, status: 'Query OK' }],
        rowCount: affected,
        duration: Date.now() - start,
      };
    }
    const columns = rs.length > 0 ? Object.keys(rs[0]) : [];
    return {
      columns,
      rows: rs,
      rowCount: affected || rs.length,
      duration: Date.now() - start,
    };
  }

  async getProcedures(database: string): Promise<ProcedureInfo[]> {
    if (!this.pool) throw new Error('Not connected');
    const result = await this.pool.request().query(`
      SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type
      FROM [${database}].INFORMATION_SCHEMA.ROUTINES
      WHERE ROUTINE_SCHEMA = 'dbo'
      ORDER BY ROUTINE_TYPE, ROUTINE_NAME
    `);
    return result.recordset.map((r) => ({
      name: r.name as string,
      type: (r.type as string).trim() === 'FUNCTION' ? 'function' : 'procedure',
    })) as ProcedureInfo[];
  }

  async getProcedureDefinition(database: string, name: string): Promise<string> {
    if (!this.pool) throw new Error('Not connected');
    const result = await this.pool.request().query(
      `SELECT OBJECT_DEFINITION(OBJECT_ID('[${database}].[dbo].[${name.replace(/]/g, ']]')}]')) AS def`,
    );
    return (result.recordset[0]?.def as string) ?? '';
  }
}
