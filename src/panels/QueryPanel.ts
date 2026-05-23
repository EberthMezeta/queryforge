import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { IAdapter, isSchemaAdapter } from '../db/IAdapter';
import { ConnectionConfig } from '../types';
import { BookmarkStorage } from '../storage/BookmarkStorage';
import { HistoryStorage } from '../storage/HistoryStorage';
import { buildWebviewHtml } from './QueryPanelHtml';

interface WebviewMessage {
  type: 'ready' | 'runQuery' | 'saveBookmark' | 'deleteBookmark' | 'cancelQuery' | 'clearHistory' | 'updateCell';
  sql?: string;
  database?: string;
  name?: string;
  id?: string;
  table?: string;
  column?: string;
  newValue?: string | null;
  pkValues?: Record<string, unknown>;
  schema?: string;
}

export class QueryPanel {
  private static readonly panels = new Map<string, QueryPanel>();
  private static counter = 0;

  private readonly panel: vscode.WebviewPanel;
  private pendingInit: { connectionName: string; database: string; query: string; autoRun: boolean } | null = null;
  private cancelFn: (() => void) | null = null;
  private runningDatabase: string | undefined;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly bookmarks: BookmarkStorage,
    private readonly historyStorage: HistoryStorage,
    private readonly config: ConnectionConfig,
    private readonly database: string,
    initialQuery: string,
    private readonly adapter: IAdapter,
    private readonly tableName: string,
    private readonly schema: string,
    private readonly panelKey: string,
    viewColumn: vscode.ViewColumn = vscode.ViewColumn.One,
    autoRun = false,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'dbQuery',
      `${database} · ${config.name}`,
      viewColumn,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')],
        retainContextWhenHidden: true,
      },
    );

    this.pendingInit = { connectionName: config.name, database, query: initialQuery, autoRun };
    this.panel.webview.html = this.buildHtml();
    this.panel.webview.onDidReceiveMessage(this.handleMessage.bind(this));
    this.panel.onDidDispose(() => {
      QueryPanel.panels.delete(this.panelKey);
    });

    QueryPanel.panels.set(panelKey, this);
  }

  static createOrShow(
    context: vscode.ExtensionContext,
    bookmarks: BookmarkStorage,
    historyStorage: HistoryStorage,
    config: ConnectionConfig,
    database: string,
    initialQuery: string,
    adapter: IAdapter,
    autoRun = false,
    tableName = '',
    schema = '',
  ): void {
    const key = tableName
      ? `${config.id}:${database}:${schema}:${tableName}`
      : `${config.id}:${database}`;
    const existing = QueryPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal();
      if (initialQuery) existing.send({ type: 'setQuery', query: initialQuery, autoRun });
      return;
    }
    new QueryPanel(context, bookmarks, historyStorage, config, database, initialQuery, adapter, tableName, schema, key, vscode.ViewColumn.One, autoRun);
  }

  static createNew(
    context: vscode.ExtensionContext,
    bookmarks: BookmarkStorage,
    historyStorage: HistoryStorage,
    config: ConnectionConfig,
    database: string,
    initialQuery: string,
    adapter: IAdapter,
    tableName = '',
    schema = '',
  ): void {
    const key = `${config.id}:${database}:${++QueryPanel.counter}`;
    new QueryPanel(context, bookmarks, historyStorage, config, database, initialQuery, adapter, tableName, schema, key, vscode.ViewColumn.Active, true);
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    if (msg.type === 'ready') {
      if (this.pendingInit) {
        let primaryKeys: string[] = [];
        if (this.tableName && isSchemaAdapter(this.adapter)) {
          try { primaryKeys = await this.adapter.getPrimaryKeys(this.database, this.tableName, this.schema || undefined); } catch { /* non-critical */ }
        }
        this.send({
          type: 'init',
          ...this.pendingInit,
          bookmarks: this.bookmarks.getAll(this.config.id, this.database),
          history: this.historyStorage.getAll(this.config.id, this.database),
          tableName: this.tableName,
          schema: this.schema,
          primaryKeys,
        });
        this.pendingInit = null;
        this.loadSchemaAsync(this.database);
      }
      return;
    }

    if (msg.type === 'cancelQuery') {
      this.cancelFn?.();
      if (this.adapter.cancelQuery) {
        this.adapter.cancelQuery(this.runningDatabase).catch(() => {});
      }
      return;
    }

    if (msg.type === 'updateCell' && msg.table && msg.column) {
      if (!isSchemaAdapter(this.adapter)) {
        this.send({ type: 'updateCellError', message: 'Cell editing not supported for this database type' });
        return;
      }
      try {
        const cellSchema = msg.schema ?? this.schema;
        await this.adapter.updateCell(this.database, msg.table, msg.column, msg.newValue ?? null, msg.pkValues ?? {}, cellSchema || undefined);
        this.broadcastReload(msg.table, cellSchema);
      } catch (err: unknown) {
        this.send({ type: 'updateCellError', message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (msg.type === 'clearHistory') {
      this.historyStorage.clear(this.config.id, this.database);
      this.broadcastHistory([]);
      return;
    }

    if (msg.type === 'runQuery' && msg.sql) {
      const historyItems = this.historyStorage.push(this.config.id, this.database, msg.sql);
      this.broadcastHistory(historyItems);
      this.send({ type: 'loading' });
      this.runningDatabase = msg.database;
      let cancelled = false;

      const cancelPromise = new Promise<never>((_, reject) => {
        this.cancelFn = () => { cancelled = true; reject(new Error('Query cancelled')); };
      });

      try {
        const result = await Promise.race([
          this.adapter.query(msg.sql, msg.database),
          cancelPromise,
        ]);
        this.send({ type: 'queryResult', ...result });
      } catch (err: unknown) {
        if (cancelled) {
          this.send({ type: 'queryCancelled' });
        } else {
          this.send({ type: 'queryError', message: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        this.cancelFn = null;
        this.runningDatabase = undefined;
      }
      return;
    }

    if (msg.type === 'saveBookmark' && msg.name && msg.sql) {
      const items = this.bookmarks.add(this.config.id, this.database, msg.name, msg.sql);
      this.broadcastBookmarks(items);
      return;
    }

    if (msg.type === 'deleteBookmark' && msg.id) {
      const items = this.bookmarks.delete(this.config.id, this.database, msg.id);
      this.broadcastBookmarks(items);
      return;
    }
  }

  private async loadSchemaAsync(database: string): Promise<void> {
    try {
      const tables = await this.adapter.getTables(database);
      const schema: Record<string, string[]> = {};
      await withConcurrency(
        tables.map((t) => async () => {
          try {
            const cols = await this.adapter.getColumns(database, t.name, t.schema);
            schema[t.name] = cols.map((c) => c.name);
          } catch {
            schema[t.name] = [];
          }
        }),
      );
      this.send({ type: 'schema', schema });
    } catch { /* non-critical */ }
  }

  private send(data: Record<string, unknown>): void {
    this.panel.webview.postMessage(data);
  }

  private broadcastBookmarks(items: unknown[]): void {
    for (const panel of QueryPanel.panels.values()) {
      if (panel.config.id === this.config.id && panel.database === this.database) {
        panel.send({ type: 'bookmarks', items });
      }
    }
  }

  private broadcastHistory(items: unknown[]): void {
    for (const panel of QueryPanel.panels.values()) {
      if (panel.config.id === this.config.id && panel.database === this.database) {
        panel.send({ type: 'history', items });
      }
    }
  }

  private broadcastReload(table: string, schema: string): void {
    for (const panel of QueryPanel.panels.values()) {
      if (
        panel.config.id === this.config.id &&
        panel.database === this.database &&
        panel.tableName === table &&
        panel.schema === schema
      ) {
        panel.send({ type: 'reloadData' });
      }
    }
  }

  private buildHtml(): string {
    const nonce = randomNonce();
    const webviewUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.js'),
    ).toString();
    return buildWebviewHtml(nonce, webviewUri);
  }
}

function randomNonce(): string {
  return crypto.randomBytes(24).toString('base64url');
}

const SCHEMA_CONCURRENCY = 8;

async function withConcurrency(tasks: (() => Promise<void>)[]): Promise<void> {
  const pool = new Set<Promise<void>>();
  for (const task of tasks) {
    const p = task().finally(() => pool.delete(p));
    pool.add(p);
    if (pool.size >= SCHEMA_CONCURRENCY) await Promise.race(pool);
  }
  await Promise.allSettled(pool);
}
