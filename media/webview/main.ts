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

const PAGE_SIZE = 100;
const vscode = acquireVsCodeApi();
const sqlLang = new Compartment();

let editor: EditorView;
let currentData: QueryResult | null = null;
let currentDatabase = '';
let bookmarks: Bookmark[] = [];
let currentPage = 0;
let filterText = '';

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
        ]),
      ],
    }),
    parent: document.getElementById('editor-container')!,
  });

  document.getElementById('run-btn')!.addEventListener('click', runQuery);
  document.getElementById('export-csv')!.addEventListener('click', exportCSV);
  document.getElementById('export-json')!.addEventListener('click', exportJSON);
  document.getElementById('export-pdf')!.addEventListener('click', exportPDF);

  document.getElementById('page-prev')!.addEventListener('click', () => goToPage(currentPage - 1));
  document.getElementById('page-next')!.addEventListener('click', () => goToPage(currentPage + 1));

  document.getElementById('filter-input')!.addEventListener('input', (e) => {
    filterText = (e.target as HTMLInputElement).value;
    currentPage = 0;
    renderPage();
  });

  document.getElementById('btn-export-query')!.addEventListener('click', exportQuery);
  document.getElementById('btn-save-query')!.addEventListener('click', openSaveForm);
  document.getElementById('btn-bookmarks')!.addEventListener('click', toggleBookmarksPanel);
  document.getElementById('bookmark-confirm')!.addEventListener('click', confirmSave);
  document.getElementById('bookmark-cancel')!.addEventListener('click', closeSaveForm);
  document.getElementById('bookmark-name-input')!.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmSave();
    if (e.key === 'Escape') closeSaveForm();
  });

  setExportButtons(false);
  vscode.postMessage({ type: 'ready' });
}

// ── Query execution ───────────────────────────────────────────────────────────

function runQuery() {
  const sqlText = editor.state.doc.toString().trim();
  if (!sqlText) return;
  showLoading();
  vscode.postMessage({ type: 'runQuery', sql: sqlText, database: currentDatabase });
}

function showLoading() {
  hide('results-section'); hide('error-section'); show('loading-section');
  setExportButtons(false);
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
  hide('loading-section'); hide('results-section');
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

  document.getElementById('t-body')!.innerHTML = pageRows
    .map(
      (row) =>
        `<tr>${currentData!.columns
          .map((col) => {
            const val = row[col];
            return val === null || val === undefined
              ? `<td><span class="null-val">NULL</span></td>`
              : `<td>${esc(String(val))}</td>`;
          })
          .join('')}</tr>`,
    )
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
  if (panel.hidden) { document.getElementById('save-form')!.hidden = true; panel.hidden = false; }
  else { panel.hidden = true; }
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
  const list = document.getElementById('bookmark-list')!;
  if (!items.length) {
    list.innerHTML = `<div class="bookmark-empty">No saved queries</div>`;
    return;
  }
  list.innerHTML = items
    .map((b) =>
      `<div class="bookmark-item" data-id="${esc(b.id)}">
        <span class="bookmark-item-name" title="${esc(b.sql)}">${esc(b.name)}</span>
        <button class="bookmark-exp" data-id="${esc(b.id)}" title="Export">📤</button>
        <button class="bookmark-del" data-id="${esc(b.id)}" title="Delete">✕</button>
      </div>`)
    .join('');

  list.querySelectorAll('.bookmark-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('bookmark-del') || target.classList.contains('bookmark-exp')) return;
      const bm = bookmarks.find((b) => b.id === el.getAttribute('data-id'));
      if (bm) { setEditorContent(bm.sql); hide('bookmarks-panel'); }
    });
  });
  list.querySelectorAll('.bookmark-exp').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).getAttribute('data-id')!;
      const bm = bookmarks.find((b) => b.id === id);
      if (bm) doExportQuery(bm.sql, bm.name.replace(/[^a-z0-9_-]/gi, '_') || 'query');
    });
  });
  list.querySelectorAll('.bookmark-del').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: 'deleteBookmark', id: (btn as HTMLElement).getAttribute('data-id') });
    });
  });
}

// ── Export Query ──────────────────────────────────────────────────────────────

function exportQuery() {
  const sqlText = editor.state.doc.toString().trim();
  if (!sqlText) return;
  doExportQuery(sqlText, 'query');
}

function doExportQuery(sqlText: string, baseName: string) {
  const fmt = (document.getElementById('export-query-fmt') as HTMLSelectElement).value;
  if (fmt === 'sql') {
    download(sqlText, `${baseName}.sql`, 'text/plain');
  } else if (fmt === 'txt') {
    download(sqlText, `${baseName}.txt`, 'text/plain');
  } else if (fmt === 'md') {
    download('```sql\n' + sqlText + '\n```\n', `${baseName}.md`, 'text/markdown');
  } else if (fmt === 'pdf') {
    exportQueryPDF(sqlText, baseName);
  }
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

window.addEventListener('message', (event) => {
  const msg = event.data as Record<string, unknown>;
  switch (msg.type) {
    case 'init':
      currentDatabase = msg.database as string;
      document.getElementById('conn-name')!.textContent = msg.connectionName as string;
      document.getElementById('db-name')!.textContent = msg.database as string;
      updateBookmarks((msg.bookmarks as Bookmark[]) ?? []);
      if (msg.query) { setEditorContent(msg.query as string); runQuery(); }
      break;

    case 'setQuery':
      setEditorContent(msg.query as string);
      if (msg.autoRun) runQuery();
      break;

    case 'queryResult':
      showResults(msg as unknown as QueryResult);
      break;

    case 'queryError':
      showError(msg.message as string);
      break;

    case 'loading':
      showLoading();
      break;

    case 'bookmarks':
      updateBookmarks(msg.items as Bookmark[]);
      break;

    case 'schema':
      applySchema(msg.schema as Record<string, string[]>);
      break;
  }
});

document.addEventListener('DOMContentLoaded', init);
