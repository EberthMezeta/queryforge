import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ConnectionStorage } from '../storage/ConnectionStorage';
import { ConnectionsProvider } from '../tree/ConnectionsProvider';
import { createAdapter } from '../db/index';
import { ConnectionConfig } from '../types';

export class AddConnectionPanel {
  private static instances = new Map<string, AddConnectionPanel>();
  private pendingConfig: ConnectionConfig | undefined;
  private readonly panel: vscode.WebviewPanel;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly storage: ConnectionStorage,
    private readonly provider: ConnectionsProvider,
    private readonly existingConfig?: ConnectionConfig,
  ) {
    const title = existingConfig ? `Edit: ${existingConfig.name}` : 'Add Connection';
    this.panel = vscode.window.createWebviewPanel(
      'addConnection',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')],
      },
    );

    this.pendingConfig = existingConfig;

    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'out', 'add-connection.js'),
    ).toString();
    this.panel.webview.html = buildHtml(randomNonce(), scriptUri);
    this.panel.webview.onDidReceiveMessage(this.handleMessage.bind(this));
    this.panel.onDidDispose(() => {
      AddConnectionPanel.instances.delete(existingConfig ? existingConfig.id : 'new');
    });
  }

  static show(
    context: vscode.ExtensionContext,
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
    AddConnectionPanel.instances.set(
      key,
      new AddConnectionPanel(context, storage, provider, existingConfig),
    );
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
            const adapter = createAdapter(config);
            await adapter.connect();
            await adapter.disconnect();
          }
          await this.storage.saveConnection(config);
          if (isEdit) {
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

function buildHtml(nonce: string, scriptUri: string): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>Add Connection</title>
  <style>${CSS}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

const CSS = `
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
.db-types{
  display:grid;grid-template-columns:repeat(4,1fr);gap:10px;
  margin-bottom:28px;
}
.db-card{
  display:flex;flex-direction:column;align-items:center;gap:8px;
  padding:12px 6px;cursor:pointer;border-radius:6px;
  border:1px solid var(--vscode-panel-border);
  transition:border-color .15s,background .15s;
  user-select:none;outline:none;
}
.db-card:hover,.db-card:focus{border-color:var(--vscode-focusBorder)}
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
.form-group{margin-bottom:14px}
.form-group>label{
  display:block;font-size:11px;text-transform:uppercase;
  letter-spacing:.06em;color:var(--vscode-descriptionForeground);margin-bottom:4px;
}
.form-group>label span{text-transform:none;opacity:.6}
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
.input-error{border-color:var(--vscode-inputValidation-errorBorder)!important}
.field-error{display:block;font-size:11px;color:var(--vscode-errorForeground);margin-top:3px}
.row{display:grid;grid-template-columns:1fr 110px;gap:12px}
.input-row{display:flex;gap:8px}
.input-row input{flex:1}
.checkbox-row{
  display:flex;align-items:center;gap:8px;
  font-size:13px;margin-bottom:14px;cursor:pointer;
}
.checkbox-row input{width:auto;cursor:pointer}
.btn{
  padding:6px 16px;border:none;border-radius:4px;cursor:pointer;
  font-size:13px;display:inline-flex;align-items:center;gap:6px;
}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.btn-secondary:not(:disabled):hover{background:var(--vscode-button-secondaryHoverBackground)}
.btn-primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.btn-primary:not(:disabled):hover{background:var(--vscode-button-hoverBackground)}
.conn-preview{
  display:flex;align-items:center;gap:10px;margin-bottom:14px;
  padding:7px 10px;
  background:var(--vscode-input-background);
  border:1px solid var(--vscode-panel-border);
  border-radius:4px;font-size:11px;overflow:hidden;
}
.preview-label{
  color:var(--vscode-descriptionForeground);font-size:10px;
  text-transform:uppercase;letter-spacing:.06em;flex-shrink:0;
}
.preview-val{
  font-family:var(--vscode-editor-font-family,monospace);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--vscode-textLink-foreground);
}
.actions{
  display:flex;align-items:center;gap:10px;
  margin-top:22px;padding-top:18px;
  border-top:1px solid var(--vscode-panel-border);
}
.status{
  flex:1;font-size:12px;padding:5px 10px;border-radius:4px;
  background:var(--vscode-editorWidget-background);
}
.status.ok{background:var(--vscode-inputValidation-infoBackground);border:1px solid var(--vscode-inputValidation-infoBorder)}
.status.err{background:var(--vscode-inputValidation-errorBackground);border:1px solid var(--vscode-inputValidation-errorBorder);color:var(--vscode-errorForeground)}
.action-btns{display:flex;gap:10px;flex-shrink:0;margin-left:auto}
`;
