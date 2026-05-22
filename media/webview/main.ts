import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
} from '@codemirror/view';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  duration: number;
}

interface Bookmark { id: string; name: string; sql: string; }
interface HistoryEntry { id: string; sql: string; executedAt: number; }

const PAGE_SIZE = 100;
const vscode = acquireVsCodeApi();
const sqlLang = new Compartment();

let editor: EditorView;
let currentData: QueryResult | null = null;
let currentDatabase = '';
let currentTable = '';
let currentSchema = '';
let primaryKeys: string[] = [];
let bookmarks: Bookmark[] = [];
let historyEntries: HistoryEntry[] = [];
let historyIndex = -1;
let currentPage = 0;
let filterText = '';
let editingCell: { td: HTMLElement; originalContent: string } | null = null;

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  editor = new EditorView({
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
          { key: 'Mod-Enter', run: () => { runQuery(); return true; } },
          { key: 'Alt-ArrowUp', run: () => { navigateHistory(1); return true; } },
          { key: 'Alt-ArrowDown', run: () => { navigateHistory(-1); return true; } },
        ]),
      ],
    }),
    parent: document.getElementById('editor-container')!,
  });

  document.getElementById('run-btn')!.addEventListener('click', runQuery);
  document.getElementById('export-csv')!.addEventListener('click', exportCSV);
  document.getElementById('export-json')!.addEventListener('click', exportJSON);
  document.getElementById('export-pdf')!.addEventListener('click', exportPDF);

  document.getElementById('cancel-btn')!.addEventListener('click', () => {
    vscode.postMessage({ type: 'cancelQuery' });
  });
  document.getElementById('page-prev')!.addEventListener('click', () => goToPage(currentPage - 1));
  document.getElementById('page-next')!.addEventListener('click', () => goToPage(currentPage + 1));

  document.getElementById('filter-input')!.addEventListener('input', (e) => {
    filterText = (e.target as HTMLInputElement).value;
    currentPage = 0;
    renderPage();
  });

  document.getElementById('btn-copy-query')!.addEventListener('click', () => {
    const sqlText = editor.state.doc.toString().trim();
    if (sqlText) copyText(sqlText, document.getElementById('btn-copy-query')!);
  });
  document.getElementById('btn-export-query')!.addEventListener('click', exportQuery);
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

  document.getElementById('t-body')!.addEventListener('click', (e) => {
    if (!currentTable || !primaryKeys.length) return;
    const td = (e.target as HTMLElement).closest('td') as HTMLElement | null;
    if (!td || !td.dataset.col || editingCell) return;
    startCellEdit(td);
  });

  // Event delegation for bookmark list — single listener survives re-renders
  document.getElementById('bookmark-list')!.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.bookmark-item') as HTMLElement | null;
    if (!item) return;
    const id = item.dataset.id!;
    const bm = bookmarks.find((b) => b.id === id);
    if (!bm) return;
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (btn) {
      const action = btn.dataset.action;
      if (action === 'copy') { copyText(bm.sql, btn); return; }
      if (action === 'export') { doExportQuery(bm.sql, bm.name.replace(/[^a-z0-9_-]/gi, '_') || 'query'); return; }
      if (action === 'delete') { vscode.postMessage({ type: 'deleteBookmark', id }); return; }
    }
    setEditorContent(bm.sql);
    hide('bookmarks-panel');
  });

  // Event delegation for history list
  document.getElementById('history-list')!.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.history-item') as HTMLElement | null;
    if (!item) return;
    const entry = historyEntries.find((h) => h.id === item.dataset.id);
    if (entry) { setEditorContent(entry.sql); hide('history-panel'); }
  });

  setExportButtons(false);
  vscode.postMessage({ type: 'ready' });
}

// ── Query execution ───────────────────────────────────────────────────────────

function runQuery() {
  const sqlText = editor.state.doc.toString().trim();
  if (!sqlText) return;
  historyIndex = -1;
  showLoading();
  vscode.postMessage({ type: 'runQuery', sql: sqlText, database: currentDatabase });
}

function showLoading() {
  hide('results-section'); hide('error-section'); hide('cancelled-section'); show('loading-section');
  setExportButtons(false);
}

function showCancelled() {
  hide('loading-section'); hide('results-section'); hide('error-section');
  setExportButtons(false);
  show('cancelled-section');
}

function showResults(data: QueryResult) {
  currentData = data;
  currentPage = 0;
  filterText = '';
  (document.getElementById('filter-input') as HTMLInputElement).value = '';

  hide('loading-section'); hide('error-section');

  document.getElementById('query-time')!.textContent = `${data.duration} ms`;

  document.getElementById('t-head')!.innerHTML =
    data.columns.map((c) => `<th>${esc(c)}</th>`).join('');

  renderPage();
  setExportButtons(data.rows.length > 0);
  show('results-section');
}

function showError(message: string) {
  hide('loading-section'); hide('results-section'); hide('cancelled-section');
  setExportButtons(false);
  document.getElementById('error-msg')!.textContent = message;
  show('error-section');
}

function setEditorContent(content: string) {
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } });
}

// ── Pagination + Filter ───────────────────────────────────────────────────────

function filteredRows(): Record<string, unknown>[] {
  if (!currentData) return [];
  if (!filterText) return currentData.rows;
  const lower = filterText.toLowerCase();
  return currentData.rows.filter((row) =>
    currentData!.columns.some((col) => {
      const v = row[col];
      return v !== null && v !== undefined && String(v).toLowerCase().includes(lower);
    }),
  );
}

function renderPage() {
  if (!currentData) return;
  const rows = filteredRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages - 1);

  const pageRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const editable = currentTable && primaryKeys.length > 0;
  document.getElementById('t-body')!.innerHTML = pageRows
    .map((row) => {
      const pkJson = editable ? esc(JSON.stringify(Object.fromEntries(primaryKeys.map((k) => [k, row[k]])))) : '';
      const rowAttr = editable ? ` data-pk="${pkJson}"` : '';
      return `<tr${rowAttr}>${currentData!.columns.map((col) => {
        const val = row[col];
        const isPk = primaryKeys.includes(col);
        const colAttr = editable && !isPk ? ` class="cell-editable" data-col="${esc(col)}"` : '';
        return val === null || val === undefined
          ? `<td${colAttr}><span class="null-val">NULL</span></td>`
          : `<td${colAttr}>${esc(String(val))}</td>`;
      }).join('')}</tr>`;
    })
    .join('');

  document.getElementById('table-wrapper')!.scrollTop = 0;

  // Row count: show filtered/total when filtering
  const countEl = document.getElementById('row-count')!;
  if (filterText && rows.length !== currentData.rowCount) {
    countEl.textContent = `${rows.length.toLocaleString()} / ${currentData.rowCount.toLocaleString()} rows`;
  } else {
    countEl.textContent = `${currentData.rowCount.toLocaleString()} rows`;
  }

  // Pagination controls
  if (totalPages > 1) {
    document.getElementById('page-info')!.textContent = `Page ${currentPage + 1} of ${totalPages}`;
    (document.getElementById('page-prev') as HTMLButtonElement).disabled = currentPage === 0;
    (document.getElementById('page-next') as HTMLButtonElement).disabled = currentPage >= totalPages - 1;
    show('pagination');
  } else {
    hide('pagination');
  }

  setExportButtons(rows.length > 0);
}

function goToPage(page: number) {
  if (!currentData) return;
  const total = Math.ceil(filteredRows().length / PAGE_SIZE);
  currentPage = Math.max(0, Math.min(page, total - 1));
  renderPage();
}

// ── Schema autocomplete ───────────────────────────────────────────────────────

function applySchema(schema: Record<string, string[]>) {
  editor.dispatch({ effects: sqlLang.reconfigure(sql({ schema, upperCaseKeywords: true })) });
}

// ── Bookmarks ─────────────────────────────────────────────────────────────────

function toggleBookmarksPanel() {
  const panel = document.getElementById('bookmarks-panel')!;
  if (panel.hidden) {
    document.getElementById('history-panel')!.hidden = true;
    document.getElementById('save-form')!.hidden = true;
    panel.hidden = false;
  } else {
    panel.hidden = true;
  }
}

function openSaveForm() {
  document.getElementById('bookmarks-panel')!.hidden = false;
  document.getElementById('save-form')!.hidden = false;
  const input = document.getElementById('bookmark-name-input') as HTMLInputElement;
  input.value = ''; input.focus();
}

function closeSaveForm() { document.getElementById('save-form')!.hidden = true; }

function confirmSave() {
  const input = document.getElementById('bookmark-name-input') as HTMLInputElement;
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  const sqlText = editor.state.doc.toString().trim();
  if (!sqlText) { closeSaveForm(); return; }
  vscode.postMessage({ type: 'saveBookmark', name, sql: sqlText });
  closeSaveForm();
}

function updateBookmarks(items: Bookmark[]) {
  bookmarks = items;
  document.getElementById('bookmark-count')!.textContent = String(items.length);
  document.getElementById('bookmark-list')!.innerHTML = items.length
    ? items.map(renderBookmarkItem).join('')
    : `<div class="bookmark-empty">No saved queries</div>`;
}

function renderBookmarkItem(b: Bookmark): string {
  return `<div class="bookmark-item" data-id="${esc(b.id)}">
    <span class="bookmark-item-name" title="${esc(b.sql)}">${esc(b.name)}</span>
    <button class="bookmark-cpy" data-action="copy" title="Copy SQL">📋</button>
    <button class="bookmark-exp" data-action="export" title="Export">📤</button>
    <button class="bookmark-del" data-action="delete" title="Delete">✕</button>
  </div>`;
}

// ── History ───────────────────────────────────────────────────────────────────

function toggleHistoryPanel() {
  const panel = document.getElementById('history-panel')!;
  const bookmarksPanel = document.getElementById('bookmarks-panel')!;
  if (panel.hidden) {
    bookmarksPanel.hidden = true;
    panel.hidden = false;
  } else {
    panel.hidden = true;
  }
}

function updateHistory(items: HistoryEntry[]) {
  if (items.length === 0) historyIndex = -1;
  historyEntries = items;
  document.getElementById('history-count')!.textContent = String(items.length);
  document.getElementById('history-list')!.innerHTML = items.length
    ? items.map(renderHistoryItem).join('')
    : `<div class="history-empty">No history yet</div>`;
}

function renderHistoryItem(h: HistoryEntry): string {
  return `<div class="history-item" data-id="${esc(h.id)}">
    <span class="history-sql" title="${esc(h.sql)}">${esc(h.sql.replace(/\s+/g, ' ').trim())}</span>
    <span class="history-time">${relativeTime(h.executedAt)}</span>
  </div>`;
}

function navigateHistory(dir: number) {
  if (!historyEntries.length) return;
  const next = historyIndex + dir;
  if (next < 0) { historyIndex = -1; return; }
  if (next >= historyEntries.length) return;
  historyIndex = next;
  setEditorContent(historyEntries[historyIndex].sql);
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── Export Query ──────────────────────────────────────────────────────────────

function exportQuery() {
  const sqlText = editor.state.doc.toString().trim();
  if (!sqlText) return;
  doExportQuery(sqlText, 'query');
}

type QueryExporter = (sql: string, base: string) => void;

const QUERY_EXPORTERS: Record<string, QueryExporter> = {
  sql: (s, b) => download(s, `${b}.sql`, 'text/plain'),
  txt: (s, b) => download(s, `${b}.txt`, 'text/plain'),
  md:  (s, b) => download('```sql\n' + s + '\n```\n', `${b}.md`, 'text/markdown'),
  pdf: (s, b) => exportQueryPDF(s, b),
};

function doExportQuery(sqlText: string, baseName: string) {
  const fmt = (document.getElementById('export-query-fmt') as HTMLSelectElement).value;
  QUERY_EXPORTERS[fmt]?.(sqlText, baseName);
}

function exportQueryPDF(sqlText: string, baseName = 'query') {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFont('Courier', 'normal');
  doc.setFontSize(10);
  const lines = doc.splitTextToSize(sqlText, 515);
  doc.text(lines, 40, 40);
  doc.save(`${baseName}.pdf`);
}

// ── Export (uses filtered rows) ───────────────────────────────────────────────

function setExportButtons(enabled: boolean) {
  ['export-csv', 'export-json', 'export-pdf'].forEach((id) => {
    (document.getElementById(id) as HTMLButtonElement).disabled = !enabled;
  });
}

function exportCSV() {
  if (!currentData) return;
  const rows = filteredRows();
  const { columns } = currentData;
  const lines = [
    columns.map(csvCell).join(','),
    ...rows.map((r) => columns.map((c) => csvCell(String(r[c] ?? ''))).join(',')),
  ];
  download(lines.join('\r\n'), 'query_results.csv', 'text/csv');
}

function exportJSON() {
  if (!currentData) return;
  download(JSON.stringify(filteredRows(), null, 2), 'query_results.json', 'application/json');
}

function exportPDF() {
  if (!currentData) return;
  const rows = filteredRows();
  const { columns } = currentData;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
  doc.setFontSize(10);
  doc.text('Query Results', 40, 30);
  autoTable(doc, {
    startY: 45,
    head: [columns],
    body: rows.map((r) => columns.map((c) => String(r[c] ?? ''))),
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [30, 30, 46] },
  });
  doc.save('query_results.pdf');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Cell editing ──────────────────────────────────────────────────────────────

function startCellEdit(td: HTMLElement) {
  const tr = td.closest('tr') as HTMLElement;
  const pkValues = JSON.parse(tr.dataset.pk || '{}') as Record<string, unknown>;
  const originalContent = td.innerHTML;
  const currentValue = td.querySelector('.null-val') ? '' : (td.textContent || '');
  const col = td.dataset.col!;

  editingCell = { td, originalContent };
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
  input.addEventListener('blur', () => { if (editingCell) cancelCellEdit(); });

  wrap.appendChild(input);
  wrap.appendChild(saveBtn);
  td.innerHTML = '';
  td.appendChild(wrap);
  setTimeout(() => { input.focus(); input.select(); }, 0);
}

function cancelCellEdit() {
  if (!editingCell) return;
  editingCell.td.innerHTML = editingCell.originalContent;
  editingCell.td.classList.remove('cell-editing');
  editingCell = null;
}

function commitCellEdit(column: string, pkValues: Record<string, unknown>, newValue: string) {
  if (!editingCell) return;
  const td = editingCell.td;
  editingCell = null; // primero, para que blur no dispare cancelCellEdit
  td.classList.remove('cell-editing');
  td.innerHTML = newValue === '' ? '<span class="null-val">NULL</span>' : esc(newValue);
  vscode.postMessage({
    type: 'updateCell',
    table: currentTable,
    database: currentDatabase,
    schema: currentSchema,
    column,
    newValue: newValue === '' ? null : newValue,
    pkValues,
  });
}

function copyText(text: string, btn: HTMLElement) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent!;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = original; }, 1200);
  }).catch(() => {});
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

function csvCell(val: string): string {
  return val.includes(',') || val.includes('"') || val.includes('\n')
    ? `"${val.replace(/"/g, '""')}"` : val;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function show(id: string) { const el = document.getElementById(id); if (el) el.hidden = false; }
function hide(id: string) { const el = document.getElementById(id); if (el) el.hidden = true; }

// ── Message handler ───────────────────────────────────────────────────────────

type MsgHandler = (msg: Record<string, unknown>) => void;

const MESSAGE_HANDLERS: Record<string, MsgHandler> = {
  init: (msg) => {
    currentDatabase = msg.database as string;
    currentTable    = (msg.tableName as string) || '';
    currentSchema   = (msg.schema as string) || '';
    primaryKeys     = (msg.primaryKeys as string[]) || [];
    document.getElementById('conn-name')!.textContent = msg.connectionName as string;
    document.getElementById('db-name')!.textContent   = msg.database as string;
    updateBookmarks((msg.bookmarks as Bookmark[]) ?? []);
    updateHistory((msg.history as HistoryEntry[]) ?? []);
    if (msg.query) setEditorContent(msg.query as string);
    if (msg.autoRun) runQuery();
  },
  setQuery:        (msg) => { setEditorContent(msg.query as string); if (msg.autoRun) runQuery(); },
  queryResult:     (msg) => showResults(msg as unknown as QueryResult),
  queryError:      (msg) => showError(msg.message as string),
  loading:         ()    => showLoading(),
  queryCancelled:  ()    => showCancelled(),
  bookmarks:       (msg) => updateBookmarks(msg.items as Bookmark[]),
  schema:          (msg) => applySchema(msg.schema as Record<string, string[]>),
  history:         (msg) => updateHistory(msg.items as HistoryEntry[]),
  reloadData:      ()    => { if (!editingCell) runQuery(); },
  updateCellError: (msg) => showError(msg.message as string),
};

window.addEventListener('message', (event) => {
  const msg = event.data as Record<string, unknown>;
  MESSAGE_HANDLERS[msg.type as string]?.(msg);
});

document.addEventListener('DOMContentLoaded', init);
