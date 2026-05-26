import { QueryResult, TableInfo, DatabaseInfo, ColumnInfo, ProcedureInfo } from '../types';

// Core interface — implemented by every adapter
export interface IAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getDatabases(): Promise<DatabaseInfo[]>;
  getTables(database: string): Promise<TableInfo[]>;
  getColumns(database: string, table: string, schema?: string): Promise<ColumnInfo[]>;
  query(sql: string, database?: string): Promise<QueryResult>;
  buildDefaultQuery(table: string, schema?: string): string;
  cancelQuery(database?: string): Promise<void>;
}

// Schema-aware: DDL, primary keys, cell editing
export interface ISchemaAdapter extends IAdapter {
  getTableDDL(database: string, table: string, schema?: string): Promise<string>;
  getPrimaryKeys(database: string, table: string, schema?: string): Promise<string[]>;
  updateCell(database: string, table: string, column: string, newValue: string | null, pkValues: Record<string, unknown>, schema?: string): Promise<void>;
}

// Procedure/function aware
export interface IProcedureAdapter extends IAdapter {
  getProcedures(database: string): Promise<ProcedureInfo[]>;
  getProcedureDefinition(database: string, name: string, type: 'procedure' | 'function', schema?: string): Promise<string>;
}

export function isSchemaAdapter(adapter: IAdapter): adapter is ISchemaAdapter {
  return typeof (adapter as ISchemaAdapter).getPrimaryKeys === 'function';
}

export function isProcedureAdapter(adapter: IAdapter): adapter is IProcedureAdapter {
  return typeof (adapter as IProcedureAdapter).getProcedures === 'function';
}
