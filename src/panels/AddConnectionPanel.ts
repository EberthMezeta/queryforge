import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ConnectionStorage } from '../storage/ConnectionStorage';
import { ConnectionsProvider } from '../tree/ConnectionsProvider';
import { createAdapter } from '../db/index';
import { ConnectionConfig } from '../types';

export class AddConnectionPanel {
  private static instances = new Map<string, AddConnectionPanel>();
  private readonly panel: vscode.WebviewPanel;
  private pendingConfig: ConnectionConfig | undefined;

  private constructor(
    private readonly storage: ConnectionStorage,
    private readonly provider: ConnectionsProvider,
    private readonly existingConfig?: ConnectionConfig,
  ) {
    const title = existingConfig ? `Edit: ${existingConfig.name}` : 'Add Connection';
    this.panel = vscode.window.createWebviewPanel(
      'addConnection',
      title,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.pendingConfig = existingConfig;
    this.panel.webview.html = buildHtml(randomNonce());
    this.panel.webview.onDidReceiveMessage(this.handleMessage.bind(this));
    this.panel.onDidDispose(() => {
      const key = existingConfig ? existingConfig.id : 'new';
      AddConnectionPanel.instances.delete(key);
    });
  }

  static show(
    storage: ConnectionStorage,
    provider: ConnectionsProvider,
    existingConfig?: ConnectionConfig,
  ): void {
    const key = existingConfig ? existingConfig.id : 'new';
    const existing = AddConnectionPanel.instances.get(key);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const panel = new AddConnectionPanel(storage, provider, existingConfig);
    AddConnectionPanel.instances.set(key, panel);
  }

  private send(data: Record<string, unknown>): void {
    this.panel.webview.postMessage(data);
  }

  private async handleMessage(msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case 'ready': {
        if (this.pendingConfig) {
          this.send({ type: 'loadConfig', config: this.pendingConfig });
          this.pendingConfig = undefined;
        }
        break;
      }

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
        const raw = msg.config as ConnectionConfig;
        const isEdit = Boolean(raw.id);
        const config: ConnectionConfig = { ...raw, id: raw.id || Date.now().toString() };
        try {
          if (!isEdit) {
            // New connection: verify it connects before saving
            const adapter = createAdapter(config);
            await adapter.connect();
            await adapter.disconnect();
          }
          await this.storage.saveConnection(config);
          if (isEdit) {
            // Disconnect old adapter so the tree reconnects with updated config
            await this.provider.disconnect(config.id);
          }
          this.provider.refresh();
          this.panel.dispose();
          vscode.window.showInformationMessage(
            `✓ Connection "${config.name}" ${isEdit ? 'updated' : 'saved'}.`,
          );
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
  return crypto.randomBytes(24).toString('base64url');
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
  <h2 id="panel-title">Add Connection</h2>

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
      <!-- MSSQL: trust server certificate -->
      <div class="checkbox-row" id="trust-cert-group" hidden>
        <input type="checkbox" id="f-trust-cert">
        <label for="f-trust-cert" style="text-transform:none;font-size:13px;color:inherit">Trust server certificate <span style="opacity:.6">(self-signed / dev only)</span></label>
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
        <button type="submit" class="btn btn-primary" id="save-btn">Save Connection</button>
      </div>
    </div>
  </form>
</div>

<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  var dbType = 'mysql';
  var editId = null;
  var PORTS = {mysql:3306,postgres:5432,mssql:1433,oracle:1521,mongodb:27017,redis:6379};

  document.querySelectorAll('.db-card').forEach(function(card) {
    card.addEventListener('click', function() {
      dbType = card.dataset.type;
      document.querySelectorAll('.db-card').forEach(function(c){c.classList.remove('selected');});
      card.classList.add('selected');
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
    if (!isServer) return;
    document.getElementById('f-port').value = PORTS[dbType] || 3306;
    var isOracle = dbType === 'oracle';
    var isMssql  = dbType === 'mssql';
    var isRedis  = dbType === 'redis';
    document.getElementById('user-group').hidden = false;
    document.getElementById('f-user').placeholder = isRedis ? 'ACL username (optional)' : (isMssql ? 'sa' : 'root');
    document.getElementById('db-group').hidden    = isOracle || isRedis;
    document.getElementById('f-db').placeholder   = isMssql ? 'master' : '';
    document.getElementById('db-label').innerHTML = 'Database <span>(optional)</span>';
    document.getElementById('service-group').hidden    = !isOracle;
    document.getElementById('encrypt-group').hidden    = !isMssql;
    document.getElementById('trust-cert-group').hidden = !isMssql;
  }

  function loadConfig(cfg) {
    editId = cfg.id || null;
    document.getElementById('panel-title').textContent = editId ? 'Edit Connection' : 'Add Connection';
    document.getElementById('save-btn').textContent    = editId ? 'Save Changes'    : 'Save Connection';

    // Select the correct DB type card
    var card = document.querySelector('.db-card[data-type="' + cfg.type + '"]');
    if (card) {
      document.querySelectorAll('.db-card').forEach(function(c){c.classList.remove('selected');});
      card.classList.add('selected');
      dbType = cfg.type;
      switchForm();
    }

    // Populate fields
    if (cfg.name)     document.getElementById('f-name').value    = cfg.name;
    if (cfg.host)     document.getElementById('f-host').value    = cfg.host;
    if (cfg.port)     document.getElementById('f-port').value    = cfg.port;
    if (cfg.user)     document.getElementById('f-user').value    = cfg.user;
    if (cfg.password) document.getElementById('f-pass').value    = cfg.password;
    if (cfg.database) document.getElementById('f-db').value      = cfg.database;
    if (cfg.serviceName) document.getElementById('f-service').value = cfg.serviceName;
    if (cfg.filename) document.getElementById('f-file').value    = cfg.filename;
    if (cfg.url)      document.getElementById('f-url').value     = cfg.url;
    if (cfg.headers)  document.getElementById('f-headers').value = JSON.stringify(cfg.headers, null, 2);
    if (cfg.encrypt)           document.getElementById('f-encrypt').checked   = true;
    if (cfg.trustServerCertificate) document.getElementById('f-trust-cert').checked = true;
  }

  document.getElementById('browse-btn').addEventListener('click', function() {
    vscode.postMessage({type:'browse'});
  });

  function getConfig() {
    var name = (document.getElementById('f-name').value||'').trim();
    if (!name) { showStatus('Connection name is required', false); return null; }
    var cfg;
    if (dbType==='sqlite') {
      var fname = (document.getElementById('f-file').value||'').trim();
      if (!fname) { showStatus('File path is required', false); return null; }
      cfg = {name:name, type:'sqlite', filename:fname};
    } else if (dbType==='graphql') {
      var gurl = (document.getElementById('f-url').value||'').trim();
      if (!gurl) { showStatus('Endpoint URL is required', false); return null; }
      var hstr = (document.getElementById('f-headers').value||'').trim();
      var hdrs = {};
      if (hstr) { try { hdrs=JSON.parse(hstr); } catch(e) { showStatus('Headers must be valid JSON', false); return null; } }
      cfg = {name:name, type:'graphql', url:gurl, headers:hdrs};
    } else {
      var host = (document.getElementById('f-host').value||'').trim()||'127.0.0.1';
      var port = parseInt(document.getElementById('f-port').value,10)||PORTS[dbType]||3306;
      var user = document.getElementById('f-user').value||'';
      var pass = document.getElementById('f-pass').value||'';
      if (dbType==='oracle') {
        var svc = (document.getElementById('f-service').value||'').trim()||'XEPDB1';
        cfg = {name:name, type:'oracle', host:host, port:port, user:user, password:pass, serviceName:svc};
      } else if (dbType==='redis') {
        cfg = {name:name, type:'redis', host:host, port:port, password:pass};
      } else if (dbType==='mongodb') {
        cfg = {name:name, type:'mongodb', host:host, port:port, user:user, password:pass};
      } else {
        var db = (document.getElementById('f-db').value||'').trim();
        var encrypt   = document.getElementById('f-encrypt')   ? document.getElementById('f-encrypt').checked   : false;
        var trustCert = document.getElementById('f-trust-cert') ? document.getElementById('f-trust-cert').checked : false;
        cfg = {name:name, type:dbType, host:host, port:port, user:user, password:pass, database:db||undefined};
        if (dbType==='mssql') { cfg.encrypt=encrypt; cfg.trustServerCertificate=trustCert; }
      }
    }
    if (editId) cfg.id = editId;
    return cfg;
  }

  document.getElementById('test-btn').addEventListener('click', function() {
    var cfg = getConfig();
    if (!cfg) return;
    setLoading(true, 'Testing connection…');
    vscode.postMessage({type:'testConnection', config:cfg});
  });

  document.getElementById('frm').addEventListener('submit', function(e) {
    e.preventDefault();
    var cfg = getConfig();
    if (!cfg) return;
    setLoading(true, editId ? 'Saving changes…' : 'Connecting and saving…');
    vscode.postMessage({type:'saveConnection', config:cfg});
  });

  function setLoading(on, msg) {
    document.getElementById('test-btn').disabled = on;
    document.getElementById('save-btn').disabled = on;
    if (msg) showStatus(msg, null);
  }

  function showStatus(msg, ok) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = ok===true ? 'ok' : ok===false ? 'err' : '';
    el.hidden = false;
  }

  window.addEventListener('message', function(e) {
    var msg = e.data;
    setLoading(false, null);
    if (msg.type==='loadConfig')  loadConfig(msg.config);
    if (msg.type==='testResult')  showStatus(msg.message, msg.success);
    if (msg.type==='saveResult')  showStatus(msg.message, false);
    if (msg.type==='filePicked')  document.getElementById('f-file').value = msg.path;
  });

  // Notify host that the webview is ready to receive config
  vscode.postMessage({type:'ready'});
</script>
</body>
</html>`;
}
