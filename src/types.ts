export type DbType = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'oracle' | 'mongodb' | 'redis' | 'graphql';

// ── Webview → Extension messages ─────────────────────────────────────────────

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'runQuery';       sql: string; database: string; page?: number }
  | { type: 'saveBookmark';   name: string; sql: string }
  | { type: 'deleteBookmark'; id: string }
  | { type: 'cancelQuery' }
  | { type: 'clearHistory' }
  | { type: 'updateCell';     table: string; database: string; schema: string; column: string; newValue: string | null; pkValues: Record<string, unknown> }
  | { type: 'deleteRow';      sql: string }
  | { type: 'deleteRows';     sqls: string[] }
  | { type: 'insertRow';      sql: string }
  | { type: 'getTableMeta';   table: string; schema?: string };

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
  trustServerCertificate?: boolean;
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
