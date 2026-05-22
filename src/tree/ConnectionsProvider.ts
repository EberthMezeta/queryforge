import * as vscode from 'vscode';
import { ConnectionStorage } from '../storage/ConnectionStorage';
import { createAdapter, IAdapter, isProcedureAdapter } from '../db/index';
import { ConnectionConfig, ProcedureInfo } from '../types';
import {
  ConnectionItem,
  DatabaseItem,
  SchemaItem,
  FolderItem,
  TableItem,
  ColumnItem,
  ProcedureFolderItem,
  ProcedureItem,
  ErrorItem,
} from './TreeItems';

type AnyItem =
  | ConnectionItem
  | DatabaseItem
  | SchemaItem
  | FolderItem
  | TableItem
  | ColumnItem
  | ProcedureFolderItem
  | ProcedureItem
  | ErrorItem;

export class ConnectionsProvider implements vscode.TreeDataProvider<AnyItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AnyItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private adapters = new Map<string, IAdapter>();

  constructor(private readonly storage: ConnectionStorage) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AnyItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AnyItem): Promise<AnyItem[]> {
    if (!element) {
      const connections = await this.storage.getConnections();
      return connections.map((c) => {
        const adapter = this.adapters.get(c.id);
        return new ConnectionItem(c, adapter?.isConnected() ?? false);
      });
    }

    if (element instanceof ConnectionItem) {
      try {
        const adapter = await this.getOrConnect(element.config);
        const databases = await adapter.getDatabases();
        return databases.map(
          (db) => new DatabaseItem(db.name, element.config, adapter),
        );
      } catch (err: unknown) {
        const msg = errorMessage(err);
        vscode.window.showErrorMessage(`DB Connection — "${element.config.name}": ${msg}`);
        return [new ErrorItem(msg)];
      }
    }

    if (element instanceof DatabaseItem) {
      try {
        const tables = await element.adapter.getTables(element.database);

        // Collect procedures upfront (needed to detect multi-schema)
        let procs: ProcedureInfo[] = [];
        if (isProcedureAdapter(element.adapter)) {
          try { procs = await element.adapter.getProcedures(element.database); } catch { /* non-critical */ }
        }

        // Detect unique schemas (only for adapters that return schema info)
        const schemasSet = new Set<string>([
          ...tables.map((t) => t.schema || ''),
          ...procs.map((p) => p.schema || ''),
        ].filter((s) => s !== ''));
        const allSchemas = [...schemasSet].sort();

        if (allSchemas.length > 1) {
          // Group by schema — show SchemaItem for each
          return allSchemas.map((schema) => {
            const schemaTables = tables.filter((t) => t.schema === schema);
            const schemaProcs = procs.filter((p) => p.schema === schema);
            return new SchemaItem(schema, element.database, element.config, element.adapter, schemaTables, schemaProcs);
          });
        }

        // Single schema (or adapter without schema concept) — flat folders
        const defaultSchema = tables[0]?.schema || '';
        return buildFolders(tables, procs, element.database, element.config, element.adapter, defaultSchema);
      } catch (err: unknown) {
        return [new ErrorItem(errorMessage(err))];
      }
    }

    if (element instanceof SchemaItem) {
      return buildFolders(element.tables, element.procs, element.database, element.config, element.adapter, element.schema);
    }

    if (element instanceof FolderItem) {
      return element.tables.map(
        (t) => new TableItem(t.name, t.type, element.database, element.config, element.adapter, t.schema || element.schema),
      );
    }

    if (element instanceof ProcedureFolderItem) {
      return element.procs.map(
        (p) => new ProcedureItem(p, element.database, element.config, element.adapter, p.schema || element.schema),
      );
    }

    if (element instanceof TableItem) {
      try {
        const columns = await element.adapter.getColumns(element.database, element.table, element.schema || undefined);
        return columns.map((c) => new ColumnItem(c));
      } catch {
        return [];
      }
    }

    return [];
  }

  async getOrConnect(config: ConnectionConfig): Promise<IAdapter> {
    const existing = this.adapters.get(config.id);
    if (existing?.isConnected()) return existing;

    const adapter = createAdapter(config);
    await adapter.connect();
    this.adapters.set(config.id, adapter);
    this._onDidChangeTreeData.fire();
    return adapter;
  }

  getAdapter(id: string): IAdapter | undefined {
    return this.adapters.get(id);
  }

  async disconnect(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(id);
    }
  }
}

function buildFolders(
  tables: import('../types').TableInfo[],
  procs: ProcedureInfo[],
  database: string,
  config: ConnectionConfig,
  adapter: IAdapter,
  schema: string,
): AnyItem[] {
  const tablesList = tables.filter((t) => t.type === 'table');
  const viewsList = tables.filter((t) => t.type === 'view');
  const folders: AnyItem[] = [];

  if (tablesList.length > 0) {
    folders.push(new FolderItem('Tables', tablesList, database, config, adapter, 'list-flat', schema));
  }
  if (viewsList.length > 0) {
    folders.push(new FolderItem('Views', viewsList, database, config, adapter, 'eye', schema));
  }
  if (procs.length > 0) {
    folders.push(new ProcedureFolderItem(procs, database, config, adapter, schema));
  }

  if (folders.length === 0) return [new ErrorItem('No tables or views found')];
  return folders;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
