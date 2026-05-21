import * as vscode from 'vscode';
import { ConnectionStorage } from '../storage/ConnectionStorage';
import { ConnectionsProvider } from '../tree/ConnectionsProvider';
import { createAdapter } from '../db/index';
import { ConnectionConfig } from '../types';

export class AddConnectionPanel {
  private static instance: AddConnectionPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  private constructor(
    private readonly storage: ConnectionStorage,
    private readonly provider: ConnectionsProvider,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'addConnection',
      'Add Connection',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.panel.webview.html = buildHtml(randomNonce());
    this.panel.webview.onDidReceiveMessage(this.handleMessage.bind(this));
    this.panel.onDidDispose(() => { AddConnectionPanel.instance = undefined; });
  }

  static show(storage: ConnectionStorage, provider: ConnectionsProvider): void {
    if (AddConnectionPanel.instance) {
      AddConnectionPanel.instance.panel.reveal();
      return;
    }
    AddConnectionPanel.instance = new AddConnectionPanel(storage, provider);
  }

  private send(data: Record<string, unknown>): void {
    this.panel.webview.postMessage(data);
  }

  private async handleMessage(msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case 'browse': {
        const uris = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          filters: { 'SQLite database': ['db', 'sqlite', 'sqlite3'] },
          title: 'Select SQLite file',
        });
        if (uris?.[0]) {
          this.send({ type: 'filePicked', path: uris[0].fsPath });
        }
        break;
      }

      case 'testConnection': {
        const config = msg.config as ConnectionConfig;
        try {
          const adapter = createAdapter(config);
          await adapter.connect();
          await adapter.disconnect();
          this.send({ type: 'testResult', success: true, message: '✓ Connection successful!' });
        } catch (err: unknown) {
          this.send({
            type: 'testResult',
            success: false,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }

      case 'saveConnection': {
        const raw = msg.config as Omit<ConnectionConfig, 'id'>;
        const config: ConnectionConfig = { id: Date.now().toString(), ...raw };
        try {
          const adapter = createAdapter(config);
          await adapter.connect();
          await this.storage.saveConnection(config);
          this.provider.refresh();
          this.panel.dispose();
          vscode.window.showInformationMessage(`✓ Connection "${config.name}" saved.`);
        } catch (err: unknown) {
          this.send({
            type: 'saveResult',
            success: false,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }
    }
  }
}

function randomNonce(): string {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

function buildHtml(nonce: string): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>Add Connection</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    [hidden]{display:none!important}
    body{
      background:var(--vscode-editor-background);
      color:var(--vscode-editor-foreground);
      font-family:var(--vscode-font-family);
      font-size:var(--vscode-font-size,13px);
      min-height:100vh;
      display:flex;align-items:center;justify-content:center;
      padding:32px 16px;
    }
    .container{width:100%;max-width:540px}
    h2{font-size:17px;font-weight:600;margin-bottom:24px}

    /* ── DB type grid ── */
    .db-types{
      display:grid;grid-template-columns:repeat(4,1fr);gap:10px;
      margin-bottom:28px;
    }
    .db-card{
      display:flex;flex-direction:column;align-items:center;gap:8px;
      padding:12px 6px;cursor:pointer;border-radius:6px;
      border:1px solid var(--vscode-panel-border);
      transition:border-color .15s,background .15s;
      user-select:none;
    }
    .db-card:hover{border-color:var(--vscode-focusBorder)}
    .db-card.selected{
      border-color:var(--vscode-focusBorder);
      background:var(--vscode-list-activeSelectionBackground);
      color:var(--vscode-list-activeSelectionForeground);
    }
    .db-logo{
      width:44px;height:44px;border-radius:9px;
      display:flex;align-items:center;justify-content:center;
      font-size:13px;font-weight:800;color:#fff;letter-spacing:-.5px;
    }
    .db-name{font-size:11px;font-weight:500;text-align:center;line-height:1.3}

    /* ── Form ── */
    .form-group{margin-bottom:14px}
    .form-group label{
      display:block;font-size:11px;text-transform:uppercase;
      letter-spacing:.06em;color:var(--vscode-descriptionForeground);margin-bottom:4px;
    }
    .form-group label span{text-transform:none;opacity:.6}
    input[type=text],input[type=number],input[type=password],textarea{
      width:100%;
      background:var(--vscode-input-background);
      color:var(--vscode-input-foreground);
      border:1px solid var(--vscode-input-border,rgba(255,255,255,.1));
      border-radius:4px;padding:6px 9px;font-size:13px;outline:none;
      font-family:var(--vscode-font-family);
    }
    textarea{resize:vertical;min-height:72px;font-size:12px}
    input:focus,textarea:focus{border-color:var(--vscode-focusBorder)}
    .row{display:grid;grid-template-columns:1fr 110px;gap:12px}
    .input-row{display:flex;gap:8px}
    .input-row input{flex:1}
    .checkbox-row{display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:14px}
    .checkbox-row input{width:auto}

    /* ── Buttons ── */
    .btn{
      padding:6px 16px;border:none;border-radius:4px;cursor:pointer;
      font-size:13px;display:inline-flex;align-items:center;gap:6px;
    }
    .btn:disabled{opacity:.45;cursor:not-allowed}
    .btn-secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
    .btn-secondary:not(:disabled):hover{background:var(--vscode-button-secondaryHoverBackground)}
    .btn-primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
    .btn-primary:not(:disabled):hover{background:var(--vscode-button-hoverBackground)}

    /* ── Actions ── */
    .actions{display:flex;align-items:center;gap:10px;margin-top:22px;padding-top:18px;border-top:1px solid var(--vscode-panel-border)}
    #status{flex:1;font-size:12px;padding:5px 10px;border-radius:4px}
    #status.ok{background:var(--vscode-inputValidation-infoBackground);border:1px solid var(--vscode-inputValidation-infoBorder)}
    #status.err{background:var(--vscode-inputValidation-errorBackground);border:1px solid var(--vscode-inputValidation-errorBorder);color:var(--vscode-errorForeground)}
    .action-btns{display:flex;gap:10px;flex-shrink:0}
    .hint{font-size:11px;color:var(--vscode-descriptionForeground);margin-top:3px}
  </style>
</head>
<body>
<div class="container">
  <h2>Add Connection</h2>

  <div class="db-types">
    <div class="db-card selected" data-type="mysql">
      <div class="db-logo" style="background:linear-gradient(135deg,#c97000,#e8a000)">My</div>
      <span class="db-name">MySQL</span>
    </div>
    <div class="db-card" data-type="postgres">
      <div class="db-logo" style="background:linear-gradient(135deg,#1e5276,#336791)">Pg</div>
      <span class="db-name">PostgreSQL</span>
    </div>
    <div class="db-card" data-type="mssql">
      <div class="db-logo" style="background:linear-gradient(135deg,#8b0000,#c0392b)">SS</div>
      <span class="db-name">SQL Server</span>
    </div>
    <div class="db-card" data-type="oracle">
      <div class="db-logo" style="background:linear-gradient(135deg,#a02010,#c74634)">Or</div>
      <span class="db-name">Oracle</span>
    </div>
    <div class="db-card" data-type="mongodb">
      <div class="db-logo" style="background:linear-gradient(135deg,#1a6b3c,#13aa52)">Mo</div>
      <span class="db-name">MongoDB</span>
    </div>
    <div class="db-card" data-type="redis">
      <div class="db-logo" style="background:linear-gradient(135deg,#8b1a10,#d82c20)">Re</div>
      <span class="db-name">Redis</span>
    </div>
    <div class="db-card" data-type="sqlite">
      <div class="db-logo" style="background:linear-gradient(135deg,#0a5fa0,#1a8fe0)">SL</div>
      <span class="db-name">SQLite</span>
    </div>
    <div class="db-card" data-type="graphql">
      <div class="db-logo" style="background:linear-gradient(135deg,#9b006a,#e10098)">GQL</div>
      <span class="db-name">GraphQL</span>
    </div>
  </div>

  <form id="frm" novalidate>
    <div class="form-group">
      <label>Connection Name</label>
      <input id="f-name" type="text" placeholder="My Database" autocomplete="off">
    </div>

    <!-- Server fields: MySQL, PostgreSQL, MSSQL, Oracle, MongoDB -->
    <div id="server-fields">
      <div class="row">
        <div class="form-group">
          <label>Host</label>
          <input id="f-host" type="text" value="127.0.0.1" autocomplete="off">
        </div>
        <div class="form-group">
          <label>Port</label>
          <input id="f-port" type="number" value="3306" min="1" max="65535">
        </div>
      </div>
      <div class="form-group" id="user-group">
        <label>Username</label>
        <input id="f-user" type="text" placeholder="root" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input id="f-pass" type="password" placeholder="••••••••" autocomplete="new-password">
      </div>
      <div class="form-group" id="db-group">
        <label id="db-label">Database <span>(optional)</span></label>
        <input id="f-db" type="text" autocomplete="off">
      </div>
      <!-- Oracle: service name -->
      <div class="form-group" id="service-group" hidden>
        <label>Service Name</label>
        <input id="f-service" type="text" placeholder="XEPDB1" autocomplete="off">
      </div>
      <!-- MSSQL: encrypt -->
      <div class="checkbox-row" id="encrypt-group" hidden>
        <input type="checkbox" id="f-encrypt">
        <label for="f-encrypt" style="text-transform:none;font-size:13px;color:inherit">Encrypt connection (Azure SQL)</label>
      </div>
    </div>

    <!-- SQLite -->
    <div id="sqlite-fields" hidden>
      <div class="form-group">
        <label>File Path</label>
        <div class="input-row">
          <input id="f-file" type="text" placeholder="/path/to/database.db" autocomplete="off">
          <button type="button" class="btn btn-secondary" id="browse-btn">Browse…</button>
        </div>
      </div>
    </div>

    <!-- GraphQL -->
    <div id="graphql-fields" hidden>
      <div class="form-group">
        <label>Endpoint URL</label>
        <input id="f-url" type="text" placeholder="https://api.example.com/graphql" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Headers <span>(optional JSON)</span></label>
        <textarea id="f-headers" placeholder='{"Authorization": "Bearer token"}'></textarea>
      </div>
    </div>

    <div class="actions">
      <div id="status" hidden></div>
      <div class="action-btns">
        <button type="button" class="btn btn-secondary" id="test-btn">Test Connection</button>
        <button type="submit" class="btn btn-primary">Save Connection</button>
      </div>
    </div>
  </form>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let dbType = 'mysql';

  var PORTS = { mysql:3306, postgres:5432, mssql:1433, oracle:1521, mongodb:27017, redis:6379 };

  document.querySelectorAll('.db-card').forEach(function(card) {
    card.addEventListener('click', function() {
      document.querySelectorAll('.db-card').forEach(function(c){ c.classList.remove('selected'); });
      card.classList.add('selected');
      dbType = card.dataset.type;
      switchForm();
    });
  });

  function switchForm() {
    var isSqlite  = dbType === 'sqlite';
    var isGraphql = dbType === 'graphql';
    var isServer  = !isSqlite && !isGraphql;

    document.getElementById('server-fields').hidden  = !isServer;
    document.getElementById('sqlite-fields').hidden  = !isSqlite;
    document.getElementById('graphql-fields').hidden = !isGraphql;

    if (isServer) {
      document.getElementById('f-port').value = PORTS[dbType] || 3306;

      var isOracle  = dbType === 'oracle';
      var isMssql   = dbType === 'mssql';
      var isRedis   = dbType === 'redis';

      // user field: hidden for Redis (optional), visible for rest
      document.getElementById('user-group').hidden   = false;
      document.getElementById('f-user').placeholder  = isRedis ? 'ACL username (optional)' : (isMssql ? 'sa' : 'root');

      // database field
      document.getElementById('db-group').hidden     = isOracle || isRedis;
      document.getElementById('f-db').placeholder    = isMssql ? 'master' : '';
      document.getElementById('db-label').innerHTML  = 'Database <span>(optional)</span>';

      // Oracle service name
      document.getElementById('service-group').hidden = !isOracle;

      // MSSQL encrypt
      document.getElementById('encrypt-group').hidden = !isMssql;
    }
  }

  document.getElementById('browse-btn').addEventListener('click', function() {
    vscode.postMessage({ type: 'browse' });
  });

  function getConfig() {
    var name = document.getElementById('f-name').value.trim();
    if (!name) { showStatus('Connection name is required', false); return null; }

    if (dbType === 'sqlite') {
      var filename = document.getElementById('f-file').value.trim();
      if (!filename) { showStatus('File path is required', false); return null; }
      return { name:name, type:'sqlite', filename:filename };
    }

    if (dbType === 'graphql') {
      var url = document.getElementById('f-url').value.trim();
      if (!url) { showStatus('Endpoint URL is required', false); return null; }
      var headersStr = document.getElementById('f-headers').value.trim();
      var headers = {};
      if (headersStr) {
        try { headers = JSON.parse(headersStr); } catch(e) { showStatus('Headers must be valid JSON', false); return null; }
      }
      return { name:name, type:'graphql', url:url, headers:headers };
    }

    var host    = document.getElementById('f-host').value.trim() || '127.0.0.1';
    var port    = parseInt(document.getElementById('f-port').value) || PORTS[dbType] || 3306;
    var user    = document.getElementById('f-user').value;
    var pass    = document.getElementById('f-pass').value;

    if (dbType === 'oracle') {
      var svc = document.getElementById('f-service').value.trim() || 'XEPDB1';
      return { name:name, type:'oracle', host:host, port:port, user:user, password:pass, serviceName:svc };
    }

    if (dbType === 'redis') {
      return { name:name, type:'redis', host:host, port:port, password:pass };
    }

    var db      = document.getElementById('f-db').value.trim();
    var encrypt = document.getElementById('f-encrypt') && document.getElementById('f-encrypt').checked;
    var cfg = { name:name, type:dbType, host:host, port:port, user:user, password:pass, database:db||undefined };
    if (dbType === 'mssql') cfg.encrypt = encrypt;
    return cfg;
  }

  document.getElementById('test-btn').addEventListener('click', function() {
    var config = getConfig();
    if (!config) return;
    setLoading(true, 'Testing connection…');
    vscode.postMessage({ type:'testConnection', config:config });
  });

  document.getElementById('frm').addEventListener('submit', function(e) {
    e.preventDefault();
    var config = getConfig();
    if (!config) return;
    setLoading(true, 'Connecting and saving…');
    vscode.postMessage({ type:'saveConnection', config:config });
  });

  function setLoading(on, msg) {
    document.getElementById('test-btn').disabled = on;
    document.querySelector('[type=submit]').disabled = on;
    if (msg) showStatus(msg, null);
  }

  function showStatus(msg, ok) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = ok === true ? 'ok' : ok === false ? 'err' : '';
    el.hidden = false;
  }

  window.addEventListener('message', function(event) {
    var msg = event.data;
    setLoading(false, null);
    if (msg.type === 'testResult') showStatus(msg.message, msg.success);
    if (msg.type === 'saveResult')  showStatus(msg.message, false);
    if (msg.type === 'filePicked')  document.getElementById('f-file').value = msg.path;
  });
</script>
</body>
</html>`;
}
