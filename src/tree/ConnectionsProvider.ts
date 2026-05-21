import * as vscode from 'vscode';
import { ConnectionStorage } from '../storage/ConnectionStorage';
import { createAdapter, IAdapter } from '../db/index';
import { ConnectionConfig } from '../types';
import {
  ConnectionItem,
  DatabaseItem,
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
      return this.storage.getConnections().map((c) => {
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
        const tablesList = tables.filter((t) => t.type === 'table');
        const viewsList = tables.filter((t) => t.type === 'view');
        const folders: AnyItem[] = [];
        if (tablesList.length > 0) {
          folders.push(
            new FolderItem(
              'Tables',
              tablesList,
              element.database,
              element.config,
              element.adapter,
              'list-flat',
            ),
          );
        }
        if (viewsList.length > 0) {
          folders.push(
            new FolderItem(
              'Views',
              viewsList,
              element.database,
              element.config,
              element.adapter,
              'eye',
            ),
          );
        }
        // Procedures (only for adapters that support them)
        if (element.adapter.getProcedures) {
          try {
            const procs = await element.adapter.getProcedures(element.database);
            if (procs.length > 0) {
              folders.push(
                new ProcedureFolderItem(procs, element.database, element.config, element.adapter),
              );
            }
          } catch {
            // silently skip if procedures aren't accessible
          }
        }

        if (folders.length === 0) {
          return [new ErrorItem('No tables or views found')];
        }
        return folders;
      } catch (err: unknown) {
        return [new ErrorItem(errorMessage(err))];
      }
    }

    if (element instanceof FolderItem) {
      return element.tables.map(
        (t) => new TableItem(t.name, t.type, element.database, element.config, element.adapter),
      );
    }

    if (element instanceof ProcedureFolderItem) {
      return element.procs.map((p) => new ProcedureItem(p, element.database, element.config, element.adapter));
    }

    if (element instanceof TableItem) {
      try {
        const columns = await element.adapter.getColumns(element.database, element.table);
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
