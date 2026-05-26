import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { IAdapter, isSchemaAdapter } from '../db/IAdapter';
import { ConnectionConfig, ColumnInfo, WebviewMessage } from '../types';
import { BookmarkStorage } from '../storage/BookmarkStorage';
import { HistoryStorage } from '../storage/HistoryStorage';
import { buildWebviewHtml } from './QueryPanelHtml';
import { SCHEMA_CONCURRENCY, SERVER_PAGE_SIZE } from '../constants';

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
    this.panel.webview.onDidReceiveMessage((msg: WebviewMessage) => this.handleMessage(msg));
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

  // ── Message dispatch ──────────────────────────────────────────────────────

  private readonly messageHandlers: { [K in WebviewMessage['type']]?: (msg: Extract<WebviewMessage, { type: K }>) => Promise<void> } = {
    ready:          (msg) => this.onReady(msg),
    cancelQuery:    (msg) => this.onCancelQuery(msg),
    runQuery:       (msg) => this.onRunQuery(msg),
    updateCell:     (msg) => this.onUpdateCell(msg),
    clearHistory:   (msg) => this.onClearHistory(msg),
    getTableMeta:   (msg) => this.onGetTableMeta(msg),
    deleteRows:     (msg) => this.onDeleteRows(msg),
    deleteRow:      (msg) => this.onDeleteRow(msg),
    insertRow:      (msg) => this.onInsertRow(msg),
    saveBookmark:   (msg) => this.onSaveBookmark(msg),
    deleteBookmark: (msg) => this.onDeleteBookmark(msg),
  };

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    const handler = this.messageHandlers[msg.type] as ((m: WebviewMessage) => Promise<void>) | undefined;
    if (handler) await handler(msg);
  }

  // ── Individual handlers ───────────────────────────────────────────────────

  private async onReady(_msg: Extract<WebviewMessage, { type: 'ready' }>): Promise<void> {
    if (!this.pendingInit) return;

    let primaryKeys: string[] = [];
    let columnDefs: ColumnInfo[] = [];

    if (this.tableName) {
      try {
        columnDefs = await this.adapter.getColumns(this.database, this.tableName, this.schema || undefined);
      } catch {
        // column metadata is non-critical; panel still opens without it
      }
      if (isSchemaAdapter(this.adapter)) {
        try {
          primaryKeys = await this.adapter.getPrimaryKeys(this.database, this.tableName, this.schema || undefined);
        } catch {
          // primary key metadata is non-critical
        }
      }
    }

    this.send({
      type: 'init',
      ...this.pendingInit,
      bookmarks: this.bookmarks.getAll(this.config.id, this.database),
      history: this.historyStorage.getAll(this.config.id, this.database),
      tableName: this.tableName,
      schema: this.schema,
      primaryKeys,
      columnDefs,
      dbType: this.config.type,
    });
    this.pendingInit = null;
    this.loadSchemaAsync(this.database);
  }

  private async onCancelQuery(_msg: Extract<WebviewMessage, { type: 'cancelQuery' }>): Promise<void> {
    this.cancelFn?.();
    this.adapter.cancelQuery(this.runningDatabase).catch(() => {});
  }

  private async onRunQuery(msg: Extract<WebviewMessage, { type: 'runQuery' }>): Promise<void> {
    const historyItems = this.historyStorage.push(this.config.id, this.database, msg.sql);
    this.broadcastHistory(historyItems);
    this.send({ type: 'loading' });
    this.runningDatabase = msg.database;
    let cancelled = false;

    const page   = msg.page ?? 0;
    const paginatedSql = injectPagination(msg.sql, page, SERVER_PAGE_SIZE);

    const cancelPromise = new Promise<never>((_, reject) => {
      this.cancelFn = () => { cancelled = true; reject(new Error('Query cancelled')); };
    });

    try {
      const result = await Promise.race([
        this.adapter.query(paginatedSql, msg.database),
        cancelPromise,
      ]);
      const hasMore = result.rowCount === SERVER_PAGE_SIZE;
      this.send({ type: 'queryResult', ...result, page, hasMore });
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
  }

  private async onUpdateCell(msg: Extract<WebviewMessage, { type: 'updateCell' }>): Promise<void> {
    if (!isSchemaAdapter(this.adapter)) {
      this.send({ type: 'updateCellError', message: 'Cell editing not supported for this database type' });
      return;
    }
    try {
      const cellSchema = msg.schema ?? this.schema;
      await this.adapter.updateCell(this.database, msg.table, msg.column, msg.newValue, msg.pkValues, cellSchema || undefined);
      this.broadcastReload(msg.table, cellSchema);
    } catch (err: unknown) {
      this.send({ type: 'updateCellError', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async onClearHistory(_msg: Extract<WebviewMessage, { type: 'clearHistory' }>): Promise<void> {
    this.historyStorage.clear(this.config.id, this.database);
    this.broadcastHistory([]);
  }

  private async onGetTableMeta(msg: Extract<WebviewMessage, { type: 'getTableMeta' }>): Promise<void> {
    const schema = msg.schema || this.schema || undefined;
    try {
      const pks = isSchemaAdapter(this.adapter)
        ? await this.adapter.getPrimaryKeys(this.database, msg.table, schema)
        : [];
      const cols = await this.adapter.getColumns(this.database, msg.table, schema);
      this.send({ type: 'tableMeta', table: msg.table, schema: schema ?? '', primaryKeys: pks, columnDefs: cols });
    } catch {
      // non-critical — webview stays functional without column metadata
    }
  }

  private async onDeleteRows(msg: Extract<WebviewMessage, { type: 'deleteRows' }>): Promise<void> {
    try {
      for (const sql of msg.sqls) {
        await this.adapter.query(sql, this.database);
      }
      this.broadcastReload(this.tableName, this.schema);
      this.send({ type: 'deleteRowsSuccess', count: msg.sqls.length });
    } catch (err: unknown) {
      this.send({ type: 'deleteRowError', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async onDeleteRow(msg: Extract<WebviewMessage, { type: 'deleteRow' }>): Promise<void> {
    try {
      await this.adapter.query(msg.sql, this.database);
      this.broadcastReload(this.tableName, this.schema);
    } catch (err: unknown) {
      this.send({ type: 'deleteRowError', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async onInsertRow(msg: Extract<WebviewMessage, { type: 'insertRow' }>): Promise<void> {
    try {
      await this.adapter.query(msg.sql, this.database);
      this.broadcastReload(this.tableName, this.schema);
      this.send({ type: 'insertRowSuccess' });
    } catch (err: unknown) {
      this.send({ type: 'insertRowError', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async onSaveBookmark(msg: Extract<WebviewMessage, { type: 'saveBookmark' }>): Promise<void> {
    const items = this.bookmarks.add(this.config.id, this.database, msg.name, msg.sql);
    this.broadcastBookmarks(items);
  }

  private async onDeleteBookmark(msg: Extract<WebviewMessage, { type: 'deleteBookmark' }>): Promise<void> {
    const items = this.bookmarks.delete(this.config.id, this.database, msg.id);
    this.broadcastBookmarks(items);
  }

  // ── Schema loading ────────────────────────────────────────────────────────

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
    } catch {
      // schema autocomplete is non-critical
    }
  }

  // ── Broadcast helpers ─────────────────────────────────────────────────────

  private send(data: Record<string, unknown>): void {
    this.panel.webview.postMessage(data);
  }

  private broadcastBookmarks(items: unknown[]): void {
    for (const p of QueryPanel.panels.values()) {
      if (p.config.id === this.config.id && p.database === this.database) {
        p.send({ type: 'bookmarks', items });
      }
    }
  }

  private broadcastHistory(items: unknown[]): void {
    for (const p of QueryPanel.panels.values()) {
      if (p.config.id === this.config.id && p.database === this.database) {
        p.send({ type: 'history', items });
      }
    }
  }

  private broadcastReload(table: string, schema: string): void {
    for (const p of QueryPanel.panels.values()) {
      if (
        p.config.id === this.config.id &&
        p.database === this.database &&
        p.tableName === table &&
        p.schema === schema
      ) {
        p.send({ type: 'reloadData' });
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

function injectPagination(sql: string, page: number, pageSize: number): string {
  const stripped = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // Only paginate plain SELECT queries without an existing LIMIT/FETCH clause
  if (!/^\s*SELECT\b/i.test(stripped)) return sql;
  if (/\b(LIMIT|FETCH\s+(?:FIRST|NEXT)|ROWNUM\b|TOP\s+\d+)\b/i.test(stripped)) return sql;
  const offset = page * pageSize;
  return `${sql.trimEnd()}\nLIMIT ${pageSize} OFFSET ${offset}`;
}

async function withConcurrency(tasks: (() => Promise<void>)[]): Promise<void> {
  const pool = new Set<Promise<void>>();
  for (const task of tasks) {
    const p = task().finally(() => pool.delete(p));
    pool.add(p);
    if (pool.size >= SCHEMA_CONCURRENCY) await Promise.race(pool);
  }
  await Promise.allSettled(pool);
}
