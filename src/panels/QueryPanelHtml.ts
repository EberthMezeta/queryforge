import { WEBVIEW_CSS } from './QueryPanelCss';

export function buildWebviewHtml(nonce: string, webviewUri: string): string {
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
      <button id="btn-copy-query" class="btn btn-sm" title="Copy current query">📋 Copy</button>
      <button id="btn-save-query" class="btn btn-sm" title="Save current query">⭐ Save</button>
      <button id="btn-bookmarks" class="btn btn-sm" title="Saved queries">☰ <span id="bookmark-count">0</span></button>
      <button id="btn-history" class="btn btn-sm" title="Query history (Alt+↑/↓)">⏱ <span id="history-count">0</span></button>
      <div class="export-query-wrap">
        <select id="export-query-fmt" title="Export format">
          <option value="sql">.sql</option>
          <option value="txt">.txt</option>
          <option value="md">.md</option>
          <option value="pdf">PDF</option>
        </select>
        <button id="btn-export-query" class="btn btn-sm" title="Export current query">📤 Export Query</button>
      </div>
      <div class="toolbar-divider"></div>
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

  <div id="history-panel" hidden>
    <div id="history-header">
      <span class="history-title">Recent queries</span>
      <button id="btn-clear-history" class="btn btn-sm" title="Clear history">Clear</button>
    </div>
    <div id="history-list"></div>
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
        <button id="export-excel" class="btn btn-sm">Excel</button>
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

  <div id="cancelled-section" hidden>
    <span id="cancelled-msg">Query cancelled</span>
  </div>

  <div id="error-section" hidden>
    <pre id="error-msg"></pre>
  </div>

  <div id="loading-section" hidden>
    <div class="loading">Executing query…</div>
    <button id="cancel-btn" class="btn btn-danger">✕ Cancel</button>
  </div>

  <script nonce="${nonce}" src="${webviewUri}"></script>
</body>
</html>`;
}
