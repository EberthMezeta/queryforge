import { state } from './state';
import { vscode } from './vscode-api';
import { esc } from './ui-helpers';

export function startCellEdit(td: HTMLElement): void {
  const tr = td.closest('tr') as HTMLElement;
  const pkValues = JSON.parse(tr.dataset.pk || '{}') as Record<string, unknown>;
  const originalContent = td.innerHTML;
  const currentValue = td.querySelector('.null-val') ? '' : (td.textContent || '');
  const col = td.dataset.col!;

  state.editingCell = { td, originalContent };
  td.classList.add('cell-editing');

  const wrap = document.createElement('div');
  wrap.className = 'cell-edit-wrap';

  const input = document.createElement('input');
  input.className = 'cell-input';
  input.value = currentValue;

  const saveBtn = document.createElement('button');
  saveBtn.className = 'cell-save-btn';
  saveBtn.textContent = '✓';
  saveBtn.title = 'Save (Ctrl+S)';

  saveBtn.addEventListener('mousedown', (e) => e.preventDefault());
  saveBtn.addEventListener('click', () => commitCellEdit(col, pkValues, input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { cancelCellEdit(); }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); commitCellEdit(col, pkValues, input.value); }
  });
  input.addEventListener('blur', () => { if (state.editingCell) cancelCellEdit(); });

  wrap.appendChild(input);
  wrap.appendChild(saveBtn);
  td.innerHTML = '';
  td.appendChild(wrap);
  setTimeout(() => { input.focus(); input.select(); }, 0);
}

export function cancelCellEdit(): void {
  if (!state.editingCell) return;
  state.editingCell.td.innerHTML = state.editingCell.originalContent;
  state.editingCell.td.classList.remove('cell-editing');
  state.editingCell = null;
}

export function commitCellEdit(column: string, pkValues: Record<string, unknown>, newValue: string): void {
  if (!state.editingCell) return;
  const td = state.editingCell.td;
  state.editingCell = null; // clear before blur fires cancelCellEdit
  td.classList.remove('cell-editing');
  td.innerHTML = newValue === '' ? '<span class="null-val">NULL</span>' : esc(newValue);
  vscode.postMessage({
    type: 'updateCell',
    table: state.currentTable,
    database: state.currentDatabase,
    schema: state.currentSchema,
    column,
    newValue: newValue === '' ? null : newValue,
    pkValues,
  });
}
