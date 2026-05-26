import { state } from './state';
import { vscode } from './vscode-api';
import { esc, quoteIdentifier } from './ui-helpers';

export function showInsertModal(): void {
  if (!state.currentTable || !state.columnDefs.length) return;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const autoDateRe = /^(created_at|updated_at|created_date|updated_date|createdat|updatedat)$/i;

  const fields = state.columnDefs.map((col) => {
    const isPk  = state.primaryKeys.includes(col.name);
    const isDate = autoDateRe.test(col.name);
    const val   = isDate ? now : '';
    const badge = isPk
      ? `<span class="insert-badge insert-pk">PK</span>`
      : (!col.nullable ? `<span class="insert-badge insert-req">*</span>` : '');
    return `<div class="insert-field">
      <label class="insert-label">${esc(col.name)}${badge}<span class="insert-type">${esc(col.type)}</span></label>
      <input class="insert-input" name="${esc(col.name)}" value="${esc(val)}" placeholder="${col.nullable ? 'NULL' : ''}">
    </div>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.id = 'insert-overlay';
  overlay.innerHTML = `
    <div id="insert-modal">
      <div id="insert-modal-header">
        <span>Insert into <strong>${esc(state.currentTable)}</strong></span>
        <button id="insert-close" class="btn-icon">✕</button>
      </div>
      <div id="insert-modal-body">${fields}</div>
      <div id="insert-error" class="insert-error" hidden></div>
      <div id="insert-modal-footer">
        <button id="insert-cancel" class="btn btn-sm">Cancel</button>
        <button id="insert-confirm" class="btn btn-sm btn-primary">Insert</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeInsertModal(); });
  document.getElementById('insert-close')!.addEventListener('click', closeInsertModal);
  document.getElementById('insert-cancel')!.addEventListener('click', closeInsertModal);
  document.getElementById('insert-confirm')!.addEventListener('click', submitInsert);
  document.addEventListener('keydown', onInsertKeydown);

  const first = overlay.querySelector<HTMLInputElement>('.insert-input:not([value])') ??
                overlay.querySelector<HTMLInputElement>('.insert-input');
  first?.focus();
}

function onInsertKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeInsertModal();
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitInsert();
}

export function closeInsertModal(): void {
  document.getElementById('insert-overlay')?.remove();
  document.removeEventListener('keydown', onInsertKeydown);
}

function submitInsert(): void {
  const overlay = document.getElementById('insert-overlay');
  if (!overlay) return;
  const inputs = overlay.querySelectorAll<HTMLInputElement>('.insert-input');
  const q = (name: string) => quoteIdentifier(name, state.dbType);
  const tableRef = state.currentSchema
    ? `${q(state.currentSchema)}.${q(state.currentTable)}`
    : q(state.currentTable);
  const cols: string[] = [];
  const vals: string[] = [];
  inputs.forEach((inp) => {
    cols.push(q(inp.name));
    const v = inp.value;
    if (v === '') { vals.push('NULL'); return; }
    const n = Number(v);
    vals.push(!isNaN(n) && v.trim() !== '' ? v : `'${v.replace(/'/g, "''")}'`);
  });
  const sql = `INSERT INTO ${tableRef} (${cols.join(', ')}) VALUES (${vals.join(', ')})`;
  const errEl = document.getElementById('insert-error');
  if (errEl) errEl.hidden = true;
  vscode.postMessage({ type: 'insertRow', sql });
}
