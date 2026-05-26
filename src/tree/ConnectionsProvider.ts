import * as vscode from 'vscode';
import { ConnectionStorage } from '../storage/ConnectionStorage';
import { IAdapter, isProcedureAdapter } from '../db/index';
import { AdapterCache } from '../db/AdapterCache';
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

  private readonly adapterCache = new AdapterCache();

  // Replaces instanceof chain (CC was 6, now CC=2)
  private readonly childResolvers = new Map<Function, (item: AnyItem) => Promise<AnyItem[]>>([
    [ConnectionItem,      (item) => this.getConnectionChildren(item as ConnectionItem)],
    [DatabaseItem,        (item) => this.getDatabaseChildren(item as DatabaseItem)],
    [SchemaItem,          (item) => this.getSchemaChildren(item as SchemaItem)],
    [FolderItem,          (item) => this.getFolderChildren(item as FolderItem)],
    [ProcedureFolderItem, (item) => this.getProcedureFolderChildren(item as ProcedureFolderItem)],
    [TableItem,           (item) => this.getTableChildren(item as TableItem)],
  ]);

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
      return connections.map((c) => new ConnectionItem(c, this.adapterCache.isConnected(c.id)));
    }
    const resolver = this.childResolvers.get(element.constructor);
    return resolver ? resolver(element) : [];
  }

  // ── Public API (used by extension.ts) ──────────────────────────────────────

  async getOrConnect(config: ConnectionConfig): Promise<IAdapter> {
    const adapter = await this.adapterCache.getOrConnect(config);
    this._onDidChangeTreeData.fire();
    return adapter;
  }

  getAdapter(id: string): IAdapter | undefined {
    return this.adapterCache.get(id);
  }

  async disconnect(id: string): Promise<void> {
    await this.adapterCache.disconnect(id);
  }

  // ── Private child resolvers ───────────────────────────────────────────────

  private async getConnectionChildren(element: ConnectionItem): Promise<AnyItem[]> {
    try {
      const wasConnected = this.adapterCache.isConnected(element.config.id);
      const adapter = await this.adapterCache.getOrConnect(element.config);
      // Defer the icon update (disconnected→connected) until after getChildren returns.
      // Firing synchronously here re-enters getChildren and causes an infinite loading loop.
      if (!wasConnected) {
        setTimeout(() => this._onDidChangeTreeData.fire(), 0);
      }
      const databases = await adapter.getDatabases();
      return databases.map((db) => new DatabaseItem(db.name, element.config, adapter));
    } catch (err: unknown) {
      const msg = errorMessage(err);
      vscode.window.showErrorMessage(`DB Connection — "${element.config.name}": ${msg}`);
      return [new ErrorItem(msg)];
    }
  }

  private async getDatabaseChildren(element: DatabaseItem): Promise<AnyItem[]> {
    try {
      const tables = await element.adapter.getTables(element.database);

      let procs: ProcedureInfo[] = [];
      if (isProcedureAdapter(element.adapter)) {
        try {
          procs = await element.adapter.getProcedures(element.database);
        } catch {
          // procedure list is non-critical; tree still shows tables
        }
      }

      const schemasSet = new Set<string>([
        ...tables.map((t) => t.schema || ''),
        ...procs.map((p) => p.schema || ''),
      ].filter((s) => s !== ''));
      const allSchemas = [...schemasSet].sort();

      if (allSchemas.length > 1) {
        return allSchemas.map((schema) => {
          const schemaTables = tables.filter((t) => t.schema === schema);
          const schemaProcs  = procs.filter((p) => p.schema === schema);
          return new SchemaItem(schema, element.database, element.config, element.adapter, schemaTables, schemaProcs);
        });
      }

      const defaultSchema = tables[0]?.schema || '';
      return buildFolders(tables, procs, element.database, element.config, element.adapter, defaultSchema);
    } catch (err: unknown) {
      return [new ErrorItem(errorMessage(err))];
    }
  }

  private getSchemaChildren(element: SchemaItem): Promise<AnyItem[]> {
    return Promise.resolve(
      buildFolders(element.tables, element.procs, element.database, element.config, element.adapter, element.schema),
    );
  }

  private getFolderChildren(element: FolderItem): Promise<AnyItem[]> {
    return Promise.resolve(
      element.tables.map(
        (t) => new TableItem(t.name, t.type, element.database, element.config, element.adapter, t.schema || element.schema),
      ),
    );
  }

  private getProcedureFolderChildren(element: ProcedureFolderItem): Promise<AnyItem[]> {
    return Promise.resolve(
      element.procs.map(
        (p) => new ProcedureItem(p, element.database, element.config, element.adapter, p.schema || element.schema),
      ),
    );
  }

  private async getTableChildren(element: TableItem): Promise<AnyItem[]> {
    try {
      const columns = await element.adapter.getColumns(element.database, element.table, element.schema || undefined);
      return columns.map((c) => new ColumnItem(c));
    } catch {
      return [];
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
  const viewsList  = tables.filter((t) => t.type === 'view');
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
