export const WEBVIEW_CSS = `
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
.export-query-wrap{display:flex;align-items:center;gap:0}
#export-query-fmt{
  background:var(--vscode-button-secondaryBackground);
  color:var(--vscode-button-secondaryForeground);
  border:none;border-radius:3px 0 0 3px;
  padding:3px 6px;font-size:11px;cursor:pointer;
  border-right:1px solid var(--vscode-panel-border);
}
#export-query-fmt:focus{outline:none}
#btn-export-query{border-radius:0 3px 3px 0}
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
.bookmark-cpy,.bookmark-exp,.bookmark-del{background:none;border:none;cursor:pointer;color:var(--vscode-descriptionForeground);font-size:13px;line-height:1;padding:0 2px;opacity:0.55;flex-shrink:0}
.bookmark-cpy:hover,.bookmark-exp:hover{opacity:1}
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
  cursor:pointer;user-select:none;
}
#results-table th:hover{background:var(--vscode-list-hoverBackground)}
.sort-arrow{color:var(--vscode-textLink-foreground);margin-left:4px;font-size:10px}
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
#loading-section{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
.loading{color:var(--vscode-descriptionForeground);font-size:13px}
.btn-danger{background:var(--vscode-inputValidation-errorBackground);color:var(--vscode-errorForeground);border:1px solid var(--vscode-inputValidation-errorBorder)}
.btn-danger:hover{opacity:0.85}
#cancelled-section{flex:1;display:flex;align-items:center;justify-content:center}
#cancelled-msg{color:var(--vscode-descriptionForeground);font-size:13px}
#history-panel{
  flex-shrink:0;background:var(--vscode-editorWidget-background);
  border-bottom:1px solid var(--vscode-panel-border);
  max-height:220px;overflow-y:auto;
}
#history-header{
  display:flex;align-items:center;justify-content:space-between;
  padding:5px 12px;border-bottom:1px solid var(--vscode-panel-border);
  background:var(--vscode-editor-background);
  position:sticky;top:0;z-index:1;
}
.history-title{font-size:11px;color:var(--vscode-descriptionForeground);font-weight:600}
.history-item{
  display:flex;align-items:center;gap:10px;padding:6px 12px;
  cursor:pointer;border-bottom:1px solid var(--vscode-panel-border);
}
.history-item:hover{background:var(--vscode-list-hoverBackground)}
.history-sql{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;font-size:11px}
.history-time{color:var(--vscode-descriptionForeground);font-size:10px;flex-shrink:0;white-space:nowrap}
.history-empty{padding:14px 12px;color:var(--vscode-descriptionForeground);font-size:12px;text-align:center}
.cell-editable{cursor:text}
.cell-editable:hover{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
.cell-editing{padding:0!important}
.cell-edit-wrap{display:flex;align-items:stretch;height:100%}
.cell-input{
  flex:1;min-width:0;min-height:24px;
  background:var(--vscode-input-background);
  color:var(--vscode-input-foreground);
  border:2px solid var(--vscode-focusBorder);
  border-right:none;
  padding:2px 8px;font-size:12px;font-family:inherit;
  outline:none;box-sizing:border-box;
}
.cell-save-btn{
  flex-shrink:0;
  background:var(--vscode-button-background);
  color:var(--vscode-button-foreground);
  border:none;cursor:pointer;
  padding:0 8px;font-size:13px;font-weight:600;
}
.cell-save-btn:hover{background:var(--vscode-button-hoverBackground)}
#ctx-menu{
  position:fixed;z-index:200;
  background:var(--vscode-menu-background,var(--vscode-editorWidget-background));
  border:1px solid var(--vscode-menu-border,var(--vscode-panel-border));
  border-radius:4px;padding:4px 0;min-width:170px;
  box-shadow:0 4px 12px rgba(0,0,0,.3);
}
.ctx-item{
  padding:6px 14px;cursor:pointer;font-size:12px;
  color:var(--vscode-menu-foreground,var(--vscode-editor-foreground));
  display:flex;align-items:center;gap:8px;
}
.ctx-item:hover{background:var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground))}
.ctx-danger{color:var(--vscode-errorForeground)}
.ctx-danger:hover{background:var(--vscode-inputValidation-errorBackground)}
.col-check{width:32px;padding:0 8px!important;text-align:center;flex-shrink:0}
.col-check input[type=checkbox]{cursor:pointer;accent-color:var(--vscode-focusBorder)}
.btn-insert{background:var(--vscode-button-background);color:var(--vscode-button-foreground);flex-shrink:0}
.btn-insert:hover:not(:disabled){background:var(--vscode-button-hoverBackground)}
.btn-delete{background:var(--vscode-inputValidation-errorBackground);color:var(--vscode-errorForeground);border:1px solid var(--vscode-inputValidation-errorBorder);flex-shrink:0}
.btn-delete:hover:not(:disabled){opacity:.85}
.btn-delete:disabled{opacity:.35;cursor:not-allowed}
.btn-icon{background:none;border:none;cursor:pointer;color:var(--vscode-descriptionForeground);font-size:14px;line-height:1;padding:2px 4px;opacity:.7}
.btn-icon:hover{opacity:1}
#insert-overlay{
  position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100;
  display:flex;align-items:center;justify-content:center;
}
#insert-modal{
  background:var(--vscode-editor-background);
  border:1px solid var(--vscode-panel-border);
  border-radius:6px;width:440px;max-width:95vw;
  display:flex;flex-direction:column;max-height:80vh;
}
#insert-modal-header{
  display:flex;align-items:center;justify-content:space-between;
  padding:12px 16px;border-bottom:1px solid var(--vscode-panel-border);
  font-size:13px;font-weight:600;flex-shrink:0;
}
#insert-modal-body{padding:14px 16px;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
.insert-field{display:flex;flex-direction:column;gap:4px}
.insert-label{display:flex;align-items:center;gap:6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--vscode-descriptionForeground)}
.insert-type{font-size:10px;opacity:.6;text-transform:none;letter-spacing:0}
.insert-badge{font-size:9px;padding:1px 5px;border-radius:3px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.insert-pk{background:var(--vscode-textLink-foreground);color:#fff}
.insert-req{background:var(--vscode-inputValidation-warningBackground);color:var(--vscode-editor-foreground)}
.insert-input{
  background:var(--vscode-input-background);color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border,rgba(255,255,255,.1));
  border-radius:4px;padding:5px 9px;font-size:12px;outline:none;font-family:inherit;
}
.insert-input:focus{border-color:var(--vscode-focusBorder)}
.insert-error{margin:0 16px;padding:8px 10px;border-radius:4px;font-size:11px;color:var(--vscode-errorForeground);background:var(--vscode-inputValidation-errorBackground);border:1px solid var(--vscode-inputValidation-errorBorder)}
#insert-modal-footer{
  display:flex;justify-content:flex-end;gap:8px;
  padding:12px 16px;border-top:1px solid var(--vscode-panel-border);flex-shrink:0;
}
#toast{
  position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(12px);
  background:var(--vscode-editorWidget-background);color:var(--vscode-editor-foreground);
  border:1px solid var(--vscode-panel-border);
  padding:7px 16px;border-radius:6px;font-size:12px;
  opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;z-index:999;
}
#toast.toast-visible{opacity:1;transform:translateX(-50%) translateY(0)}
#dml-confirm-overlay{
  position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:300;
  display:flex;align-items:center;justify-content:center;
}
#dml-confirm-modal{
  background:var(--vscode-editor-background);
  border:1px solid var(--vscode-inputValidation-errorBorder);
  border-radius:6px;width:420px;max-width:92vw;
  padding:22px 24px;display:flex;flex-direction:column;gap:14px;
}
.dml-warning-icon{font-size:26px;text-align:center}
#dml-confirm-title{
  font-size:13px;font-weight:600;text-align:center;
  color:var(--vscode-errorForeground);
}
#dml-confirm-sql{
  background:var(--vscode-input-background);
  border:1px solid var(--vscode-panel-border);
  border-radius:4px;padding:8px 10px;font-size:11px;
  font-family:var(--vscode-editor-font-family,monospace);
  white-space:pre-wrap;word-break:break-all;
  max-height:120px;overflow-y:auto;
  color:var(--vscode-editor-foreground);
}
.dml-confirm-btns{display:flex;justify-content:flex-end;gap:8px}
`;
