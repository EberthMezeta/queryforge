import * as vscode from 'vscode';
import { ConnectionStorage } from './storage/ConnectionStorage';
import { BookmarkStorage } from './storage/BookmarkStorage';
import { HistoryStorage } from './storage/HistoryStorage';
import { ConnectionsProvider } from './tree/ConnectionsProvider';
import { QueryPanel } from './panels/QueryPanel';
import { AddConnectionPanel } from './panels/AddConnectionPanel';
import { ConnectionItem, DatabaseItem, TableItem, ProcedureItem } from './tree/TreeItems';
import { DbType } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const storage = new ConnectionStorage(context);
  const bookmarks = new BookmarkStorage(context);
  const historyStorage = new HistoryStorage(context);
  const provider = new ConnectionsProvider(storage);

  vscode.window.registerTreeDataProvider('dbConnection.connections', provider);

  context.subscriptions.push(
    vscode.commands.registerCommand('dbConnection.addConnection', () =>
      AddConnectionPanel.show(storage, provider),
    ),

    vscode.commands.registerCommand('dbConnection.refreshConnections', () => provider.refresh()),

    vscode.commands.registerCommand(
      'dbConnection.deleteConnection',
      async (item: ConnectionItem) => {
        const answer = await vscode.window.showWarningMessage(
          `Delete connection "${item.config.name}"?`,
          { modal: true },
          'Delete',
        );
        if (answer !== 'Delete') return;
        await provider.disconnect(item.config.id);
        await storage.deleteConnection(item.config.id);
        provider.refresh();
      },
    ),

    vscode.commands.registerCommand(
      'dbConnection.disconnectConnection',
      async (item: ConnectionItem) => {
        await provider.disconnect(item.config.id);
        provider.refresh();
      },
    ),

    vscode.commands.registerCommand('dbConnection.testConnection', async (item: ConnectionItem) => {
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Testing "${item.config.name}"…` },
        async () => {
          try {
            await provider.getOrConnect(item.config);
            provider.refresh();
            vscode.window.showInformationMessage(`✓ Connected to "${item.config.name}"`);
          } catch (err: unknown) {
            vscode.window.showErrorMessage(
              `✗ Connection failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        },
      );
    }),

    vscode.commands.registerCommand('dbConnection.openTable', (item: TableItem) => {
      const sql = buildSelectQuery(item.table, item.config.type);
      QueryPanel.createOrShow(context, bookmarks, historyStorage, item.config, item.database, sql, item.adapter, true);
    }),

    vscode.commands.registerCommand('dbConnection.openTableInNewTab', (item: TableItem) => {
      const sql = buildSelectQuery(item.table, item.config.type);
      QueryPanel.createNew(context, bookmarks, historyStorage, item.config, item.database, sql, item.adapter);
    }),

    vscode.commands.registerCommand('dbConnection.openQueryEditor', (item: DatabaseItem) => {
      QueryPanel.createOrShow(context, bookmarks, historyStorage, item.config, item.database, '', item.adapter, false);
    }),

    vscode.commands.registerCommand('dbConnection.viewDDL', async (item: TableItem) => {
      if (!item.adapter.getTableDDL) return;
      try {
        const ddl = await item.adapter.getTableDDL(item.database, item.table);
        if (!ddl.trim()) {
          vscode.window.showWarningMessage(`Could not retrieve DDL for "${item.table}".`);
          return;
        }
        QueryPanel.createOrShow(context, bookmarks, historyStorage, item.config, item.database, ddl, item.adapter, false);
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Error reading DDL: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand('dbConnection.openProcedure', async (item: ProcedureItem) => {
      if (!item.adapter.getProcedureDefinition) return;
      try {
        const ddl = await item.adapter.getProcedureDefinition(item.database, item.proc.name, item.proc.type);
        if (!ddl.trim()) {
          vscode.window.showWarningMessage(`Could not retrieve definition for "${item.proc.name}".`);
          return;
        }
        QueryPanel.createOrShow(context, bookmarks, historyStorage, item.config, item.database, ddl, item.adapter, false);
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Error reading procedure: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );

  // Auto-connect saved connections in the background on startup
  const savedConnections = storage.getConnections();
  if (savedConnections.length > 0) {
    Promise.allSettled(
      savedConnections.map((config) => provider.getOrConnect(config)),
    ).then(() => provider.refresh());
  }
}

export function deactivate(): void {}

function buildSelectQuery(table: string, dbType: DbType): string {
  switch (dbType) {
    case 'mysql':    return `SELECT * FROM \`${table}\` LIMIT 150`;
    case 'mssql':    return `SELECT TOP 150 * FROM [${table}]`;
    case 'oracle':   return `SELECT * FROM "${table}" FETCH FIRST 150 ROWS ONLY`;
    case 'mongodb':  return `db.${table}.find({}).limit(150)`;
    case 'redis':    return `TYPE ${table}\nGET ${table}`;
    case 'graphql':  return `{\n  ${table} {\n    id\n  }\n}`;
    default:         return `SELECT * FROM "${table}" LIMIT 150`;
  }
}
