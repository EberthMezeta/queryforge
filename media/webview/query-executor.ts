import { state, QueryResult } from './state';
import { vscode } from './vscode-api';
import { show, hide, quoteIdentifier } from './ui-helpers';
import { renderHeaders, renderPage, setExportButtons } from './table-renderer';

export function isDestructiveDML(sqlText: string): boolean {
  const clean = sqlText.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  return /^\s*(DELETE|TRUNCATE|DROP|UPDATE)\b/i.test(clean);
}

export function confirmDML(sqlText: string): Promise<boolean> {
  return new Promise((resolve) => {
    const clean = sqlText.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const kw = (clean.match(/^\s*(\w+)/)?.[1] ?? '').toUpperCase();
    const TITLES: Record<string, string> = {
      DELETE:   'This will permanently delete rows',
      TRUNCATE: 'This will erase ALL rows from the table',
      DROP:     'This will permanently destroy a database object',
      UPDATE:   'This will modify rows in the table',
    };
    document.getElementById('dml-confirm-title')!.textContent = TITLES[kw] ?? 'Destructive operation';
    document.getElementById('dml-confirm-sql')!.textContent =
      sqlText.length > 300 ? sqlText.slice(0, 300) + '…' : sqlText;

    const overlay   = document.getElementById('dml-confirm-overlay')!;
    const execBtn   = document.getElementById('dml-btn-execute') as HTMLButtonElement;
    const cancelBtn = document.getElementById('dml-btn-cancel') as HTMLButtonElement;
    overlay.hidden = false;

    function done(result: boolean) {
      overlay.hidden = true;
      execBtn.removeEventListener('click', onExec);
      cancelBtn.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onExec()   { done(true);  }
    function onCancel() { done(false); }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); }
    }
    execBtn.addEventListener('click', onExec);
    cancelBtn.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
    cancelBtn.focus();
  });
}

export function setEditorContent(content: string): void {
  state.editor!.dispatch({ changes: { from: 0, to: state.editor!.state.doc.length, insert: content } });
}

export async function runQuery(): Promise<void> {
  const sqlText = state.editor!.state.doc.toString().trim();
  if (!sqlText) return;
  if (isDestructiveDML(sqlText)) {
    const ok = await confirmDML(sqlText);
    if (!ok) return;
  }
  state.runningSQL = sqlText;
  state.baseQuery = sqlText.replace(/\s+ORDER\s+BY\s+[\s\S]*$/i, '').trim() || sqlText;
  state.historyIndex = -1;
  showLoading();
  vscode.postMessage({ type: 'runQuery', sql: sqlText, database: state.currentDatabase });
}

export function showLoading(): void {
  hide('results-section'); hide('error-section'); hide('cancelled-section'); show('loading-section');
  setExportButtons(false);
}

export function showCancelled(): void {
  hide('loading-section'); hide('results-section'); hide('error-section');
  setExportButtons(false);
  show('cancelled-section');
}

export function showResults(data: QueryResult & { page?: number; hasMore?: boolean }): void {
  const isNextPage = (data.page ?? 0) > 0;

  if (isNextPage && state.currentData) {
    // Append rows from the next server page
    state.currentData = {
      ...state.currentData,
      rows: [...state.currentData.rows, ...data.rows],
      rowCount: state.currentData.rowCount + data.rowCount,
    };
  } else {
    state.currentData = data;
    state.currentPage = 0;
    state.filterText = '';
    state.sortCol = null;
    state.sortDir = 'asc';
    state.selectedPks.clear();
    (document.getElementById('filter-input') as HTMLInputElement).value = '';
  }

  state.serverPage   = data.page ?? 0;
  state.hasMorePages = data.hasMore ?? false;

  hide('loading-section'); hide('error-section');
  document.getElementById('query-time')!.textContent = `${data.duration} ms`;

  if (!isNextPage) {
    const detected = detectTableFromSQL(state.runningSQL);
    const detectedName = detected?.name ?? '';
    if (detectedName !== state.currentTable) {
      state.currentTable = '';
      state.primaryKeys  = [];
      state.columnDefs   = [];
      (document.getElementById('btn-insert-row')  as HTMLButtonElement).hidden = true;
      (document.getElementById('btn-delete-rows') as HTMLButtonElement).hidden = true;
      if (detected) {
        vscode.postMessage({ type: 'getTableMeta', table: detected.name, schema: detected.schema });
      }
    }
  }

  renderHeaders();
  renderPage();
  updateLoadMoreButton();
  setExportButtons((state.currentData?.rows.length ?? 0) > 0);
  show('results-section');
}

export function loadNextPage(): void {
  if (!state.hasMorePages) return;
  vscode.postMessage({
    type: 'runQuery',
    sql: state.runningSQL,
    database: state.currentDatabase,
    page: state.serverPage + 1,
  });
}

function updateLoadMoreButton(): void {
  const btn = document.getElementById('btn-load-more') as HTMLButtonElement | null;
  if (btn) {
    btn.hidden   = !state.hasMorePages;
    btn.disabled = !state.hasMorePages;
  }
}

export function showError(message: string): void {
  hide('loading-section'); hide('results-section'); hide('cancelled-section');
  setExportButtons(false);
  document.getElementById('error-msg')!.textContent = message;
  show('error-section');
}

export function detectTableFromSQL(sql: string): { name: string; schema: string } | null {
  const clean = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!/^\s*SELECT\b/i.test(clean)) return null;
  if (/\bJOIN\b/i.test(clean)) return null;
  const m = clean.match(
    /\bFROM\s+[`"[]?(\w+)[`"\]]?\s*\.\s*[`"[]?(\w+)[`"\]]?\s*(?:$|\s|;)/i,
  );
  if (m) return { schema: m[1], name: m[2] };
  const m2 = clean.match(/\bFROM\s+[`"[]?(\w+)[`"\]]?\s*(?:$|\s|;)/i);
  if (m2) return { schema: '', name: m2[1] };
  return null;
}

export async function deleteSelectedRows(): Promise<void> {
  if (!state.selectedPks.size || !state.currentTable || !state.primaryKeys.length) return;
  const count = state.selectedPks.size;
  const summary = `DELETE ${count} row${count === 1 ? '' : 's'} FROM "${state.currentTable}"`;
  const ok = await confirmDML(summary);
  if (!ok) return;

  const q = (name: string) => quoteIdentifier(name, state.dbType);
  const tableRef = state.currentSchema
    ? `${q(state.currentSchema)}.${q(state.currentTable)}`
    : q(state.currentTable);
  const sqls = Array.from(state.selectedPks).map((rawPk) => {
    const pkValues = JSON.parse(rawPk) as Record<string, unknown>;
    const where = state.primaryKeys.map((k) => {
      const v = pkValues[k];
      if (v === null || v === undefined) return `${q(k)} IS NULL`;
      const n = Number(v);
      return `${q(k)} = ${!isNaN(n) && String(v).trim() !== '' ? v : `'${String(v).replace(/'/g, "''")}'`}`;
    }).join(' AND ');
    return `DELETE FROM ${tableRef} WHERE ${where}`;
  });
  vscode.postMessage({ type: 'deleteRows', sqls });
}
