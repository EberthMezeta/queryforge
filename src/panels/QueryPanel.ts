import * as vscode from 'vscode';
import { IAdapter } from '../db/IAdapter';
import { ConnectionConfig } from '../types';
import { BookmarkStorage } from '../storage/BookmarkStorage';

interface WebviewMessage {
  type: 'ready' | 'runQuery' | 'saveBookmark' | 'deleteBookmark';
  sql?: string;
  database?: string;
  name?: string;
  id?: string;
}

export class QueryPanel {
  private static readonly panels = new Map<string, QueryPanel>();

  private readonly panel: vscode.WebviewPanel;
  private pendingInit: { connectionName: string; database: string; query: string } | null = null;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly bookmarks: BookmarkStorage,
    private readonly config: ConnectionConfig,
    private readonly database: string,
    initialQuery: string,
    private readonly adapter: IAdapter,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'dbQuery',
      `${database} · ${config.name}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')],
        retainContextWhenHidden: true,
      },
    );

    this.pendingInit = { connectionName: config.name, database, query: initialQuery };
    this.panel.webview.html = this.buildHtml();
    this.panel.webview.onDidReceiveMessage(this.handleMessage.bind(this));
    this.panel.onDidDispose(() => {
      QueryPanel.panels.delete(`${config.id}:${database}`);
    });

    QueryPanel.panels.set(`${config.id}:${database}`, this);
  }

  static createOrShow(
    context: vscode.ExtensionContext,
    bookmarks: BookmarkStorage,
    config: ConnectionConfig,
    database: string,
    initialQuery: string,
    adapter: IAdapter,
    autoRun = false,
  ): void {
    const key = `${config.id}:${database}`;
    const existing = QueryPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal();
      if (initialQuery) existing.send({ type: 'setQuery', query: initialQuery, autoRun });
      return;
    }
    new QueryPanel(context, bookmarks, config, database, initialQuery, adapter);
    void autoRun;
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    if (msg.type === 'ready') {
      if (this.pendingInit) {
        this.send({ type: 'init', ...this.pendingInit, bookmarks: this.bookmarks.getAll() });
        this.pendingInit = null;
        this.loadSchemaAsync(this.database);
      }
      return;
    }

    if (msg.type === 'runQuery' && msg.sql) {
      this.send({ type: 'loading' });
      try {
        const result = await this.adapter.query(msg.sql, msg.database);
        this.send({ type: 'queryResult', ...result });
      } catch (err: unknown) {
        this.send({ type: 'queryError', message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (msg.type === 'saveBookmark' && msg.name && msg.sql) {
      this.send({ type: 'bookmarks', items: this.bookmarks.add(msg.name, msg.sql) });
      return;
    }

    if (msg.type === 'deleteBookmark' && msg.id) {
      this.send({ type: 'bookmarks', items: this.bookmarks.delete(msg.id) });
      return;
    }
  }

  private async loadSchemaAsync(database: string): Promise<void> {
    try {
      const tables = await this.adapter.getTables(database);
      const schema: Record<string, string[]> = {};
      await Promise.allSettled(
        tables.map(async (t) => {
          try {
            const cols = await this.adapter.getColumns(database, t.name);
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

  private buildHtml(): string {
    const nonce = randomNonce();
    const webviewUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.js'),
    );
    const csp = [
      `default-src 'none'`,
      `script-src 'nonce-${nonce}'`,
      `style-src 'unsafe-inline'`,
      `font-src vscode-resource: data:`,
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>DB Query</title>
  <style>${WEBVIEW_CSS}</style>
</head>
<body>
  <div id="toolbar">
    <div class="conn-info">
      <span id="conn-name" class="conn-name"></span>
      <span class="sep">›</span>
      <span id="db-name" class="db-name"></span>
    </div>
    <div class="toolbar-right">
      <button id="btn-save-query" class="btn btn-sm" title="Save current query">⭐ Save</button>
      <button id="btn-bookmarks" class="btn btn-sm" title="Saved queries">☰ <span id="bookmark-count">0</span></button>
      <div class="toolbar-divider"></div>
      <label class="limit-label">LIMIT
        <input type="number" id="limit-input" value="150" min="1" max="100000">
      </label>
      <button id="run-btn" class="btn btn-primary">▶ Run <kbd>Ctrl+Enter</kbd></button>
    </div>
  </div>

  <div id="bookmarks-panel" hidden>
    <div id="save-form" hidden>
      <input type="text" id="bookmark-name-input" placeholder="Query name…" maxlength="80" />
      <button id="bookmark-confirm" class="btn btn-sm btn-accent">Save</button>
      <button id="bookmark-cancel" class="btn btn-sm">Cancel</button>
    </div>
    <div id="bookmark-list"></div>
  </div>

  <div id="editor-wrap">
    <div id="editor-container"></div>
  </div>

  <div id="results-section" hidden>
    <div id="results-bar">
      <div class="results-meta">
        <span id="row-count"></span>
        <span id="query-time"></span>
      </div>
      <input type="text" id="filter-input" placeholder="🔍 Filter rows…" />
      <div id="pagination" hidden>
        <button id="page-prev" class="btn btn-sm page-btn">‹</button>
        <span id="page-info"></span>
        <button id="page-next" class="btn btn-sm page-btn">›</button>
      </div>
      <div class="export-btns">
        <button id="export-csv" class="btn btn-sm">CSV</button>
        <button id="export-json" class="btn btn-sm">JSON</button>
        <button id="export-pdf" class="btn btn-sm">PDF</button>
      </div>
    </div>
    <div id="table-wrapper">
      <table id="results-table">
        <thead><tr id="t-head"></tr></thead>
        <tbody id="t-body"></tbody>
      </table>
    </div>
  </div>

  <div id="error-section" hidden>
    <pre id="error-msg"></pre>
  </div>

  <div id="loading-section" hidden>
    <div class="loading">Executing query…</div>
  </div>

  <script nonce="${nonce}" src="${webviewUri}"></script>
</body>
</html>`;
  }
}

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

const WEBVIEW_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
[hidden]{display:none!important}
body{
  background:var(--vscode-editor-background);
  color:var(--vscode-editor-foreground);
  font-family:var(--vscode-font-family);
  font-size:var(--vscode-font-size,13px);
  display:flex;flex-direction:column;height:100vh;overflow:hidden;
}
#toolbar{
  display:flex;align-items:center;justify-content:space-between;
  padding:6px 12px;flex-shrink:0;
  background:var(--vscode-editorWidget-background);
  border-bottom:1px solid var(--vscode-panel-border);
}
.conn-info{display:flex;align-items:center;gap:6px;font-size:12px}
.conn-name{font-weight:600}
.db-name{color:var(--vscode-textLink-foreground)}
.sep{color:var(--vscode-descriptionForeground)}
.toolbar-right{display:flex;align-items:center;gap:8px}
.toolbar-divider{width:1px;height:16px;background:var(--vscode-panel-border);margin:0 2px}
.limit-label{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--vscode-descriptionForeground)}
#limit-input{
  width:72px;background:var(--vscode-input-background);
  color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border,transparent);
  padding:2px 6px;font-size:12px;border-radius:3px;
}
#bookmarks-panel{
  flex-shrink:0;background:var(--vscode-editorWidget-background);
  border-bottom:1px solid var(--vscode-panel-border);
  max-height:200px;overflow-y:auto;
}
#save-form{
  display:flex;align-items:center;gap:8px;padding:8px 12px;
  border-bottom:1px solid var(--vscode-panel-border);
  background:var(--vscode-editor-background);
}
#bookmark-name-input{
  flex:1;background:var(--vscode-input-background);
  color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border,transparent);
  padding:3px 8px;font-size:12px;border-radius:3px;
}
#bookmark-name-input:focus{outline:1px solid var(--vscode-focusBorder)}
.bookmark-item{
  display:flex;align-items:center;gap:8px;padding:7px 12px;
  cursor:pointer;font-size:12px;border-bottom:1px solid var(--vscode-panel-border);
}
.bookmark-item:hover{background:var(--vscode-list-hoverBackground)}
.bookmark-item-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bookmark-del{background:none;border:none;cursor:pointer;color:var(--vscode-descriptionForeground);font-size:14px;line-height:1;padding:0 2px;opacity:0.6}
.bookmark-del:hover{opacity:1;color:var(--vscode-errorForeground)}
.bookmark-empty{padding:14px 12px;color:var(--vscode-descriptionForeground);font-size:12px;text-align:center}
#editor-wrap{flex-shrink:0;border-bottom:1px solid var(--vscode-panel-border)}
#editor-container{min-height:120px;max-height:280px;overflow:auto}
.cm-editor{min-height:120px;max-height:280px;font-size:13px}
.cm-scroller{overflow:auto}
.btn{
  padding:4px 12px;border:none;border-radius:3px;cursor:pointer;
  font-size:12px;display:inline-flex;align-items:center;gap:6px;
}
.btn-primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.btn-primary:hover{background:var(--vscode-button-hoverBackground)}
.btn-sm{
  background:var(--vscode-button-secondaryBackground);
  color:var(--vscode-button-secondaryForeground);
  padding:3px 10px;font-size:11px;
}
.btn-sm:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground)}
.btn-accent{background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:3px 10px;font-size:11px}
.btn-accent:hover{background:var(--vscode-button-hoverBackground)}
.btn:disabled{opacity:0.4;cursor:not-allowed}
kbd{
  background:var(--vscode-keybindingLabel-background);
  border:1px solid var(--vscode-keybindingLabel-border);
  color:var(--vscode-keybindingLabel-foreground);
  border-radius:3px;padding:1px 5px;font-size:10px;
}
#results-section{flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0}
#results-bar{
  display:flex;align-items:center;gap:8px;
  padding:4px 12px;flex-shrink:0;
  background:var(--vscode-editorWidget-background);
  border-bottom:1px solid var(--vscode-panel-border);
}
.results-meta{display:flex;gap:10px;font-size:11px;color:var(--vscode-descriptionForeground);flex-shrink:0}
#filter-input{
  flex:1;max-width:200px;
  background:var(--vscode-input-background);
  color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border,transparent);
  padding:2px 8px;font-size:11px;border-radius:3px;
}
#filter-input:focus{outline:1px solid var(--vscode-focusBorder)}
#filter-input::placeholder{color:var(--vscode-input-placeholderForeground)}
#pagination{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--vscode-descriptionForeground);flex-shrink:0}
.page-btn{padding:1px 7px;font-size:13px;line-height:1}
#page-info{white-space:nowrap}
.export-btns{display:flex;gap:6px;flex-shrink:0;margin-left:auto}
#table-wrapper{flex:1;overflow:auto}
#results-table{width:100%;border-collapse:collapse;font-size:12px}
#results-table th{
  background:var(--vscode-editorWidget-background);color:var(--vscode-editor-foreground);
  padding:5px 10px;text-align:left;
  border-bottom:2px solid var(--vscode-panel-border);
  border-right:1px solid var(--vscode-panel-border);
  position:sticky;top:0;font-weight:600;white-space:nowrap;z-index:1;
}
#results-table td{
  padding:4px 10px;
  border-bottom:1px solid var(--vscode-panel-border);
  border-right:1px solid var(--vscode-panel-border);
  white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis;
}
#results-table tr:hover td{background:var(--vscode-list-hoverBackground)}
.null-val{color:var(--vscode-descriptionForeground);font-style:italic}
#error-section{flex:1;padding:14px;overflow:auto}
#error-msg{
  background:var(--vscode-inputValidation-errorBackground);
  border:1px solid var(--vscode-inputValidation-errorBorder);
  color:var(--vscode-errorForeground);
  padding:12px;border-radius:4px;font-size:12px;white-space:pre-wrap;
}
#loading-section{flex:1;display:flex;align-items:center;justify-content:center}
.loading{color:var(--vscode-descriptionForeground);font-size:13px}
`;
