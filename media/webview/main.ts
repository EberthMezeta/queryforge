import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
} from '@codemirror/view';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';

import { state, Bookmark, HistoryEntry, ColumnDef } from './state';
import { vscode } from './vscode-api';
import { show, hide, closeCtxMenu, esc, quoteIdentifier, copyText, showToast } from './ui-helpers';
import {
  filteredRows, renderHeaders, renderPage, goToPage, updateCheckAll, updateDeleteBtn, setExportButtons,
} from './table-renderer';
import {
  runQuery, showResults, showError, showLoading, showCancelled,
  setEditorContent, deleteSelectedRows, loadNextPage,
} from './query-executor';
import { startCellEdit } from './cell-editor';
import { exportCSV, exportJSON, exportExcel, exportPDF, exportQuery, doExportQuery } from './export';
import {
  toggleBookmarksPanel, openSaveForm, closeSaveForm, confirmSave,
  updateBookmarks, initBookmarkListeners,
} from './bookmarks';
import {
  toggleHistoryPanel, updateHistory, navigateHistory, initHistoryListeners,
} from './history';
import { formatAndApply } from './formatter';
import { showInsertModal, closeInsertModal } from './insert-modal';

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  const sqlLang = new Compartment();
  state.sqlLang = sqlLang;

  state.editor = new EditorView({
    state: EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        closeBrackets(),
        sqlLang.of(sql()),
        autocompletion(),
        oneDark,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          { key: 'Ctrl-Enter', run: () => { runQuery(); return true; } },
          { key: 'Mod-Enter',  run: () => { runQuery(); return true; } },
          { key: 'Alt-ArrowUp',   run: () => { navigateHistory(1);  return true; } },
          { key: 'Alt-ArrowDown', run: () => { navigateHistory(-1); return true; } },
          { key: 'Ctrl-Alt-f', run: () => {
            formatAndApply(state.editor!.state.doc.toString().trim());
            return true;
          }},
        ]),
      ],
    }),
    parent: document.getElementById('editor-container')!,
  });

  // Toolbar buttons
  document.getElementById('run-btn')!.addEventListener('click', () => runQuery());
  document.getElementById('export-csv')!.addEventListener('click', exportCSV);
  document.getElementById('export-json')!.addEventListener('click', exportJSON);
  document.getElementById('export-excel')!.addEventListener('click', exportExcel);
  document.getElementById('export-pdf')!.addEventListener('click', exportPDF);
  document.getElementById('cancel-btn')!.addEventListener('click', () => {
    vscode.postMessage({ type: 'cancelQuery' });
  });
  document.getElementById('page-prev')!.addEventListener('click', () => goToPage(state.currentPage - 1));
  document.getElementById('page-next')!.addEventListener('click', () => goToPage(state.currentPage + 1));
  document.getElementById('btn-load-more')?.addEventListener('click', loadNextPage);
  document.getElementById('btn-format-query')!.addEventListener('click', () => {
    formatAndApply(state.editor!.state.doc.toString().trim());
  });
  document.getElementById('btn-insert-row')!.addEventListener('click', showInsertModal);
  document.getElementById('btn-delete-rows')!.addEventListener('click', deleteSelectedRows);
  document.getElementById('btn-copy-query')!.addEventListener('click', () => {
    const sqlText = state.editor!.state.doc.toString().trim();
    if (sqlText) copyText(sqlText, document.getElementById('btn-copy-query')!);
  });
  document.getElementById('btn-export-query')!.addEventListener('click', () => {
    exportQuery(state.editor!.state.doc.toString().trim());
  });
  document.getElementById('btn-save-query')!.addEventListener('click', openSaveForm);
  document.getElementById('btn-bookmarks')!.addEventListener('click', toggleBookmarksPanel);
  document.getElementById('btn-history')!.addEventListener('click', toggleHistoryPanel);
  document.getElementById('btn-clear-history')!.addEventListener('click', () => {
    vscode.postMessage({ type: 'clearHistory' });
  });
  document.getElementById('bookmark-confirm')!.addEventListener('click', confirmSave);
  document.getElementById('bookmark-cancel')!.addEventListener('click', closeSaveForm);
  document.getElementById('bookmark-name-input')!.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmSave();
    if (e.key === 'Escape') closeSaveForm();
  });

  // Filter
  document.getElementById('filter-input')!.addEventListener('input', (e) => {
    state.filterText = (e.target as HTMLInputElement).value;
    state.currentPage = 0;
    renderPage();
  });

  // Column header sorting
  document.getElementById('t-head')!.addEventListener('click', (e) => {
    const th = (e.target as HTMLElement).closest('th[data-col]') as HTMLElement | null;
    if (!th) return;
    const col = th.dataset.col!;
    if (state.sortCol === col) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortCol = col;
      state.sortDir = 'asc';
    }
    state.currentPage = 0;
    renderHeaders();
    renderPage();
    if (state.baseQuery) {
      setEditorContent(`${state.baseQuery}\nORDER BY "${col}" ${state.sortDir.toUpperCase()}`);
    }
  });

  // Select-all checkbox
  document.getElementById('t-head')!.addEventListener('change', (e) => {
    const cb = e.target as HTMLInputElement;
    if (cb.id !== 'check-all') return;
    const pageRows = filteredRows().slice(state.currentPage * 100, (state.currentPage + 1) * 100);
    pageRows.forEach((row) => {
      const rawPk = JSON.stringify(Object.fromEntries(state.primaryKeys.map((k) => [k, row[k]])));
      cb.checked ? state.selectedPks.add(rawPk) : state.selectedPks.delete(rawPk);
    });
    renderPage();
    updateDeleteBtn();
  });

  // Row checkbox
  document.getElementById('t-body')!.addEventListener('change', (e) => {
    const cb = e.target as HTMLInputElement;
    if (!cb.classList.contains('row-check')) return;
    cb.checked ? state.selectedPks.add(cb.dataset.pk!) : state.selectedPks.delete(cb.dataset.pk!);
    updateCheckAll();
    updateDeleteBtn();
  });

  // Row context menu
  document.getElementById('t-body')!.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    closeCtxMenu();
    const tr = (e.target as HTMLElement).closest('tr') as HTMLElement | null;
    if (!tr || !state.currentData) return;
    const rowIndex = Array.from(tr.parentElement!.children).indexOf(tr);
    const row = filteredRows()[state.currentPage * 100 + rowIndex];
    if (!row) return;

    const menu = document.createElement('div');
    menu.id = 'ctx-menu';

    const q = (name: string) => quoteIdentifier(name, state.dbType);
    const tableRef = state.currentSchema
      ? `${q(state.currentSchema)}.${q(state.currentTable || 'table_name')}`
      : q(state.currentTable || 'table_name');

    const copyItem = document.createElement('div');
    copyItem.className = 'ctx-item';
    copyItem.textContent = '📋 Copy as INSERT';
    copyItem.addEventListener('click', () => {
      closeCtxMenu();
      const cols = state.currentData!.columns.map((c) => q(c)).join(', ');
      const vals = state.currentData!.columns.map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number') return String(v);
        return `'${String(v).replace(/'/g, "''")}'`;
      }).join(', ');
      navigator.clipboard.writeText(`INSERT INTO ${tableRef} (${cols}) VALUES (${vals});`)
        .then(() => showToast('INSERT copied')).catch(() => {});
    });
    menu.appendChild(copyItem);

    if (state.currentTable && state.primaryKeys.length > 0) {
      const delItem = document.createElement('div');
      delItem.className = 'ctx-item ctx-danger';
      delItem.textContent = '🗑 Delete row';
      delItem.addEventListener('click', () => {
        closeCtxMenu();
        const where = state.primaryKeys.map((k) => {
          const v = row[k];
          if (v === null || v === undefined) return `${q(k)} IS NULL`;
          const n = Number(v);
          return `${q(k)} = ${!isNaN(n) && String(v).trim() !== '' ? v : `'${String(v).replace(/'/g, "''")}'`}`;
        }).join(' AND ');
        vscode.postMessage({ type: 'deleteRow', sql: `DELETE FROM ${tableRef} WHERE ${where}` });
      });
      menu.appendChild(delItem);
    }

    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
    menu.style.top  = `${Math.min(e.clientY, window.innerHeight - 80)}px`;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', closeCtxMenu, { once: true }), 0);
  });

  // Cell click → inline edit
  document.getElementById('t-body')!.addEventListener('click', (e) => {
    if (!state.currentTable || !state.primaryKeys.length) return;
    const td = (e.target as HTMLElement).closest('td') as HTMLElement | null;
    if (!td || !td.dataset.col || state.editingCell) return;
    startCellEdit(td);
  });

  // Bookmark & history delegated listeners
  initBookmarkListeners();
  initHistoryListeners();

  setExportButtons(false);
  vscode.postMessage({ type: 'ready' });
}

// ── Message handlers ──────────────────────────────────────────────────────────

type MsgHandler = (msg: Record<string, unknown>) => void;

const MESSAGE_HANDLERS: Record<string, MsgHandler> = {
  init: (msg) => {
    state.currentDatabase = msg.database as string;
    state.currentTable    = (msg.tableName as string) || '';
    state.currentSchema   = (msg.schema as string) || '';
    state.primaryKeys     = (msg.primaryKeys as string[]) || [];
    state.columnDefs      = (msg.columnDefs as ColumnDef[]) || [];
    state.dbType          = (msg.dbType as string) || '';
    document.getElementById('conn-name')!.textContent = msg.connectionName as string;
    document.getElementById('db-name')!.textContent   = msg.database as string;
    (document.getElementById('btn-insert-row')  as HTMLButtonElement).hidden = !state.currentTable;
    (document.getElementById('btn-delete-rows') as HTMLButtonElement).hidden = !(state.currentTable && state.primaryKeys.length > 0);
    updateBookmarks((msg.bookmarks as Bookmark[]) ?? []);
    updateHistory((msg.history as HistoryEntry[]) ?? []);
    if (msg.query) setEditorContent(msg.query as string);
    if (msg.autoRun) runQuery();
  },
  setQuery:         (msg) => { setEditorContent(msg.query as string); if (msg.autoRun) runQuery(); },
  queryResult:      (msg) => showResults(msg as unknown as import('./state').QueryResult),
  queryError:       (msg) => showError(msg.message as string),
  loading:          ()    => showLoading(),
  queryCancelled:   ()    => showCancelled(),
  bookmarks:        (msg) => updateBookmarks(msg.items as Bookmark[]),
  schema:           (msg) => {
    const schema = msg.schema as Record<string, string[]>;
    state.editor!.dispatch({
      effects: state.sqlLang!.reconfigure(sql({ schema, upperCaseKeywords: true })),
    });
  },
  history:          (msg) => updateHistory(msg.items as HistoryEntry[]),
  reloadData:       ()    => { if (!state.editingCell) runQuery(); },
  updateCellError:  (msg) => showError(msg.message as string),
  insertRowSuccess: ()    => { closeInsertModal(); showToast('Row inserted'); },
  insertRowError:   (msg) => {
    const errEl = document.getElementById('insert-error');
    if (errEl) { errEl.textContent = msg.message as string; errEl.hidden = false; }
  },
  tableMeta: (msg) => {
    state.currentTable  = msg.table as string;
    state.currentSchema = (msg.schema as string) || state.currentSchema;
    state.primaryKeys   = (msg.primaryKeys as string[]) || [];
    state.columnDefs    = (msg.columnDefs as ColumnDef[]) || [];
    (document.getElementById('btn-insert-row')  as HTMLButtonElement).hidden = !state.currentTable;
    (document.getElementById('btn-delete-rows') as HTMLButtonElement).hidden = !(state.currentTable && state.primaryKeys.length > 0);
    renderHeaders();
    renderPage();
  },
  deleteRowsSuccess: (msg) => {
    state.selectedPks.clear();
    updateDeleteBtn();
    showToast(`${msg.count as number} row(s) deleted`);
  },
  deleteRowError: (msg) => showToast(`Error: ${msg.message as string}`),
};

window.addEventListener('message', (event) => {
  const msg = event.data as Record<string, unknown>;
  MESSAGE_HANDLERS[msg.type as string]?.(msg);
});

document.addEventListener('DOMContentLoaded', init);
