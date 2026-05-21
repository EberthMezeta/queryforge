export type DbType = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'oracle' | 'mongodb' | 'redis' | 'graphql';

export interface ConnectionConfig {
  id: string;
  name: string;
  type: DbType;
  // Server-based (MySQL, PostgreSQL, MSSQL, Oracle, MongoDB, Redis)
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  // SQLite
  filename?: string;
  // Oracle
  serviceName?: string;
  // SQL Server
  encrypt?: boolean;
  // GraphQL / MongoDB URI
  url?: string;
  // GraphQL custom headers
  headers?: Record<string, string>;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  duration: number;
}

export interface TableInfo {
  name: string;
  type: 'table' | 'view';
  schema?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
}

export interface DatabaseInfo {
  name: string;
}

export interface ProcedureInfo {
  name: string;
  type: 'procedure' | 'function';
  schema?: string;
}
