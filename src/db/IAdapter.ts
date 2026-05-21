import { QueryResult, TableInfo, DatabaseInfo, ColumnInfo, ProcedureInfo } from '../types';

export interface IAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getDatabases(): Promise<DatabaseInfo[]>;
  getTables(database: string): Promise<TableInfo[]>;
  getColumns(database: string, table: string): Promise<ColumnInfo[]>;
  query(sql: string, database?: string): Promise<QueryResult>;
  getProcedures?(database: string): Promise<ProcedureInfo[]>;
  getProcedureDefinition?(database: string, name: string, type: 'procedure' | 'function'): Promise<string>;
}
