import * as mssql from 'mssql';
import { BaseAdapter } from './BaseAdapter';
import { ISchemaAdapter, IProcedureAdapter } from './IAdapter';
import { ConnectionConfig, QueryResult, TableInfo, DatabaseInfo, ColumnInfo, ProcedureInfo } from '../types';

export class SqlServerAdapter extends BaseAdapter implements ISchemaAdapter, IProcedureAdapter {
  private pool: mssql.ConnectionPool | null = null;
  private connected = false;

  constructor(private readonly config: ConnectionConfig) { super(); }

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

  isConnected(): boolean { return this.connected; }

  buildDefaultQuery(table: string, schema?: string): string {
    return schema
      ? `SELECT TOP 150 * FROM [${schema}].[${table}]`
      : `SELECT TOP 150 * FROM [${table}]`;
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    this.assertConnected();
    const result = await this.pool!.request().query(
      `SELECT name FROM sys.databases WHERE state_desc = 'ONLINE' ORDER BY name`,
    );
    return result.recordset.map((r) => ({ name: r.name as string }));
  }

  async getTables(database: string): Promise<TableInfo[]> {
    this.assertConnected();
    const result = await this.pool!.request().query(`
      SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_SCHEMA AS schema
      FROM [${database}].INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
      ORDER BY TABLE_SCHEMA, TABLE_TYPE, TABLE_NAME
    `);
    return result.recordset.map((r) => ({
      name: r.name as string,
      type: (r.type as string).trim() === 'VIEW' ? 'view' : 'table',
      schema: r.schema as string,
    }));
  }

  async getColumns(database: string, table: string, schema = 'dbo'): Promise<ColumnInfo[]> {
    this.assertConnected();
    const result = await this.pool!.request().query(`
      SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable
      FROM [${database}].INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = '${schema.replace(/'/g, "''")}' AND TABLE_NAME = '${table.replace(/'/g, "''")}'
      ORDER BY ORDINAL_POSITION
    `);
    return result.recordset.map((r) => ({
      name: r.name as string,
      type: r.type as string,
      nullable: (r.nullable as string) === 'YES',
    }));
  }

  async query(sql: string, database?: string): Promise<QueryResult> {
    this.assertConnected();
    const req = this.pool!.request();
    const start = Date.now();
    const fullSql = database ? `USE [${database}]; ${sql}` : sql;
    const result = await req.query(fullSql);
    const rs = result.recordset ?? [];
    const affected = result.rowsAffected[0] ?? 0;
    if (!rs.length && result.recordset === undefined) {
      return this.dmlResult(affected, Date.now() - start);
    }
    const columns = rs.length > 0 ? Object.keys(rs[0]) : [];
    return { columns, rows: rs, rowCount: affected || rs.length, duration: Date.now() - start };
  }

  async getTableDDL(database: string, table: string, schema = 'dbo'): Promise<string> {
    this.assertConnected();
    const result = await this.pool!.request().query(`
      SELECT 'CREATE TABLE [' + TABLE_SCHEMA + '].[' + TABLE_NAME + '] (' + CHAR(10) +
        STRING_AGG(
          '  [' + COLUMN_NAME + '] ' + DATA_TYPE +
          CASE WHEN CHARACTER_MAXIMUM_LENGTH IS NOT NULL
               THEN '(' + CAST(CHARACTER_MAXIMUM_LENGTH AS VARCHAR) + ')' ELSE '' END +
          CASE WHEN IS_NULLABLE = 'NO' THEN ' NOT NULL' ELSE ' NULL' END,
          ',' + CHAR(10)
        ) WITHIN GROUP (ORDER BY ORDINAL_POSITION) + CHAR(10) + ');' AS ddl
      FROM [${database}].INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = '${table.replace(/'/g, "''")}' AND TABLE_SCHEMA = '${schema.replace(/'/g, "''")}'
      GROUP BY TABLE_SCHEMA, TABLE_NAME
    `);
    return (result.recordset[0]?.ddl as string) ?? '';
  }

  async getProcedures(database: string): Promise<ProcedureInfo[]> {
    this.assertConnected();
    const result = await this.pool!.request().query(`
      SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type, ROUTINE_SCHEMA AS schema
      FROM [${database}].INFORMATION_SCHEMA.ROUTINES
      WHERE ROUTINE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
      ORDER BY ROUTINE_SCHEMA, ROUTINE_TYPE, ROUTINE_NAME
    `);
    return result.recordset.map((r) => ({
      name: r.name as string,
      type: (r.type as string).trim() === 'FUNCTION' ? 'function' : 'procedure',
      schema: r.schema as string,
    })) as ProcedureInfo[];
  }

  async getProcedureDefinition(database: string, name: string, _type?: string, schema = 'dbo'): Promise<string> {
    this.assertConnected();
    const result = await this.pool!.request().query(
      `SELECT OBJECT_DEFINITION(OBJECT_ID('[${database}].[${schema.replace(/]/g, ']]')}].[${name.replace(/]/g, ']]')}]')) AS def`,
    );
    return (result.recordset[0]?.def as string) ?? '';
  }

  async getPrimaryKeys(database: string, table: string, schema = 'dbo'): Promise<string[]> {
    this.assertConnected();
    const result = await this.pool!.request().query(`
      SELECT kcu.COLUMN_NAME
      FROM [${database}].INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      JOIN [${database}].INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
      WHERE tc.TABLE_SCHEMA = '${schema.replace(/'/g, "''")}' AND tc.TABLE_NAME = '${table.replace(/'/g, "''")}'
        AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ORDER BY kcu.ORDINAL_POSITION
    `);
    return result.recordset.map((r) => r.COLUMN_NAME as string);
  }

  async updateCell(database: string, table: string, column: string, newValue: string | null, pkValues: Record<string, unknown>, schema = 'dbo'): Promise<void> {
    this.assertConnected();
    const pkEntries = Object.entries(pkValues);
    const req = this.pool!.request();
    req.input('newVal', newValue);
    pkEntries.forEach(([, v], i) => req.input(`pk${i}`, v));
    const where = pkEntries.map(([k], i) => `[${k}] = @pk${i}`).join(' AND ');
    await req.query(`UPDATE [${database}].[${schema}].[${table}] SET [${column}] = @newVal WHERE ${where}`);
  }
}
