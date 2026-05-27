import * as vscode from 'vscode';
import { ConnectionStorage } from './storage/ConnectionStorage';
import { BookmarkStorage } from './storage/BookmarkStorage';
import { HistoryStorage } from './storage/HistoryStorage';
import { ConnectionsProvider } from './tree/ConnectionsProvider';
import { QueryPanel } from './panels/QueryPanel';
import { AddConnectionPanel } from './panels/AddConnectionPanel';
import { ConnectionItem, DatabaseItem, TableItem, ProcedureItem } from './tree/TreeItems';
import { isSchemaAdapter, isProcedureAdapter } from './db/IAdapter';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const storage = new ConnectionStorage(context);
  const bookmarks = new BookmarkStorage(context);
  const historyStorage = new HistoryStorage(context);
  const provider = new ConnectionsProvider(storage);

  vscode.window.registerTreeDataProvider('dbConnection.connections', provider);

  context.subscriptions.push(
    vscode.commands.registerCommand('dbConnection.addConnection', () =>
      AddConnectionPanel.show(context, storage, provider),
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
      const sql = item.adapter.buildDefaultQuery(item.table, item.schema || undefined);
      QueryPanel.createOrShow(context, bookmarks, historyStorage, item.config, item.database, sql, item.adapter, true, item.table, item.schema);
    }),

    vscode.commands.registerCommand('dbConnection.openTableInNewTab', (item: TableItem) => {
      const sql = item.adapter.buildDefaultQuery(item.table, item.schema || undefined);
      QueryPanel.createNew(context, bookmarks, historyStorage, item.config, item.database, sql, item.adapter, item.table, item.schema);
    }),

    vscode.commands.registerCommand('dbConnection.openQueryEditor', (item: DatabaseItem) => {
      QueryPanel.createOrShow(context, bookmarks, historyStorage, item.config, item.database, '', item.adapter);
    }),

    vscode.commands.registerCommand('dbConnection.viewDDL', async (item: TableItem) => {
      if (!isSchemaAdapter(item.adapter)) return;
      try {
        const ddl = await item.adapter.getTableDDL(item.database, item.table, item.schema || undefined);
        if (!ddl.trim()) {
          vscode.window.showWarningMessage(`Could not retrieve DDL for "${item.table}".`);
          return;
        }
        QueryPanel.createOrShow(context, bookmarks, historyStorage, item.config, item.database, ddl, item.adapter);
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Error reading DDL: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand('dbConnection.editConnection', (item: ConnectionItem) => {
      AddConnectionPanel.show(context, storage, provider, item.config);
    }),

    vscode.commands.registerCommand('dbConnection.openProcedure', async (item: ProcedureItem) => {
      if (!isProcedureAdapter(item.adapter)) return;
      try {
        const ddl = await item.adapter.getProcedureDefinition(item.database, item.proc.name, item.proc.type, item.schema || undefined);
        if (!ddl.trim()) {
          vscode.window.showWarningMessage(`Could not retrieve definition for "${item.proc.name}".`);
          return;
        }
        QueryPanel.createOrShow(context, bookmarks, historyStorage, item.config, item.database, ddl, item.adapter);
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Error reading procedure: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );

  context.subscriptions.push({
    dispose: () => {
      storage.getConnections().then((configs) => {
        for (const c of configs) provider.disconnect(c.id).catch(() => {});
      }).catch(() => {});
    },
  });

  const savedConnections = await storage.getConnections();
  if (savedConnections.length > 0) {
    Promise.allSettled(
      savedConnections.map((config) => provider.getOrConnect(config)),
    ).then(() => provider.refresh());
  }
}

export function deactivate(): void {}
