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
let sortCol: string | null = null;
let sortDir: 'asc' | 'desc' = 'asc';
let baseQuery = '';
let runningSQL = '';
let columnDefs: Array<{ name: string; type: string; nullable: boolean }> = [];
let dbType = '';
const selectedPks = new Set<string>();
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
          { key: 'Ctrl-Alt-f', run: () => { formatQuery(); return true; } },
        ]),
      ],
    }),
    parent: document.getElementById('editor-container')!,
  });

  document.getElementById('run-btn')!.addEventListener('click', runQuery);
  document.getElementById('export-csv')!.addEventListener('click', exportCSV);
  document.getElementById('export-json')!.addEventListener('click', exportJSON);
  document.getElementById('export-excel')!.addEventListener('click', exportExcel);
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

  document.getElementById('btn-format-query')!.addEventListener('click', formatQuery);
  document.getElementById('btn-insert-row')!.addEventListener('click', showInsertModal);
  document.getElementById('btn-delete-rows')!.addEventListener('click', deleteSelectedRows);

  document.getElementById('t-head')!.addEventListener('change', (e) => {
    const cb = e.target as HTMLInputElement;
    if (cb.id !== 'check-all') return;
    const pageRows = filteredRows().slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
    pageRows.forEach((row) => {
      const rawPk = JSON.stringify(Object.fromEntries(primaryKeys.map((k) => [k, row[k]])));
      cb.checked ? selectedPks.add(rawPk) : selectedPks.delete(rawPk);
    });
    renderPage();
    updateDeleteBtn();
  });

  document.getElementById('t-body')!.addEventListener('change', (e) => {
    const cb = e.target as HTMLInputElement;
    if (!cb.classList.contains('row-check')) return;
    cb.checked ? selectedPks.add(cb.dataset.pk!) : selectedPks.delete(cb.dataset.pk!);
    updateCheckAll();
    updateDeleteBtn();
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

  document.getElementById('t-head')!.addEventListener('click', (e) => {
    const th = (e.target as HTMLElement).closest('th[data-col]') as HTMLElement | null;
    if (!th) return;
    const col = th.dataset.col!;
    if (sortCol === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = col;
      sortDir = 'asc';
    }
    currentPage = 0;
    renderHeaders();
    renderPage();
    if (baseQuery) {
      setEditorContent(`${baseQuery}\nORDER BY "${col}" ${sortDir.toUpperCase()}`);
    }
  });

  document.getElementById('t-body')!.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    closeCtxMenu();
    const tr = (e.target as HTMLElement).closest('tr') as HTMLElement | null;
    if (!tr || !currentData) return;
    const rowIndex = Array.from(tr.parentElement!.children).indexOf(tr);
    const row = filteredRows()[currentPage * PAGE_SIZE + rowIndex];
    if (!row) return;

    const menu = document.createElement('div');
    menu.id = 'ctx-menu';

    const copyItem = document.createElement('div');
    copyItem.className = 'ctx-item';
    copyItem.textContent = '📋 Copy as INSERT';
    copyItem.addEventListener('click', () => {
      closeCtxMenu();
      const q = quoteIdentifier;
      const table = currentTable || 'table_name';
      const tableRef = currentSchema ? `${q(currentSchema)}.${q(table)}` : q(table);
      const cols = currentData!.columns.map((c) => q(c)).join(', ');
      const vals = currentData!.columns.map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number') return String(v);
        return `'${String(v).replace(/'/g, "''")}'`;
      }).join(', ');
      navigator.clipboard.writeText(`INSERT INTO ${tableRef} (${cols}) VALUES (${vals});`)
        .then(() => showToast('INSERT copied')).catch(() => {});
    });
    menu.appendChild(copyItem);

    if (currentTable && primaryKeys.length > 0) {
      const delItem = document.createElement('div');
      delItem.className = 'ctx-item ctx-danger';
      delItem.textContent = '🗑 Delete row';
      delItem.addEventListener('click', () => {
        closeCtxMenu();
        const q = quoteIdentifier;
        const tableRef = currentSchema ? `${q(currentSchema)}.${q(currentTable)}` : q(currentTable);
        const where = primaryKeys.map((k) => {
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
  runningSQL = sqlText;
  baseQuery = sqlText.replace(/\s+ORDER\s+BY\s+[\s\S]*$/i, '').trim() || sqlText;
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
  sortCol = null;
  sortDir = 'asc';
  selectedPks.clear();
  (document.getElementById('filter-input') as HTMLInputElement).value = '';

  hide('loading-section'); hide('error-section');
  document.getElementById('query-time')!.textContent = `${data.duration} ms`;

  // Sync table context from executed SQL
  const detected = detectTableFromSQL(runningSQL);
  const detectedName = detected?.name ?? '';
  if (detectedName !== currentTable) {
    currentTable = '';
    primaryKeys  = [];
    columnDefs   = [];
    (document.getElementById('btn-insert-row')  as HTMLButtonElement).hidden = true;
    (document.getElementById('btn-delete-rows') as HTMLButtonElement).hidden = true;
    if (detected) {
      vscode.postMessage({ type: 'getTableMeta', table: detected.name, schema: detected.schema });
    }
  }

  renderHeaders();
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

// ── Table detection ───────────────────────────────────────────────────────────

function detectTableFromSQL(sql: string): { name: string; schema: string } | null {
  const clean = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!/^\s*SELECT\b/i.test(clean)) return null;   // only SELECT
  if (/\bJOIN\b/i.test(clean)) return null;         // skip JOINs — ambiguous table
  const m = clean.match(
    /\bFROM\s+[`"[]?(\w+)[`"\]]?\s*\.\s*[`"[]?(\w+)[`"\]]?\s*(?:$|\s|;)/i,
  );
  if (m) return { schema: m[1], name: m[2] };
  const m2 = clean.match(/\bFROM\s+[`"[]?(\w+)[`"\]]?\s*(?:$|\s|;)/i);
  if (m2) return { schema: '', name: m2[1] };
  return null;
}

// ── Pagination + Filter ───────────────────────────────────────────────────────

function renderHeaders() {
  if (!currentData) return;
  const hasKeys = currentTable && primaryKeys.length > 0;
  const checkTh = hasKeys ? `<th class="col-check"><input type="checkbox" id="check-all" title="Select all"></th>` : '';
  document.getElementById('t-head')!.innerHTML = checkTh + currentData.columns
    .map((c) => {
      const active = c === sortCol;
      const arrow = active ? `<span class="sort-arrow">${sortDir === 'asc' ? '▲' : '▼'}</span>` : '';
      return `<th data-col="${esc(c)}">${esc(c)}${arrow}</th>`;
    })
    .join('');
}

function filteredRows(): Record<string, unknown>[] {
  if (!currentData) return [];
  let rows: Record<string, unknown>[] = currentData.rows;
  if (filterText) {
    const lower = filterText.toLowerCase();
    rows = rows.filter((row) =>
      currentData!.columns.some((col) => {
        const v = row[col];
        return v !== null && v !== undefined && String(v).toLowerCase().includes(lower);
      }),
    );
  }
  if (sortCol) {
    const col = sortCol;
    rows = [...rows].sort((a, b) => {
      const av = a[col], bv = b[col];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const an = Number(av), bn = Number(bv);
      const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }
  return rows;
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
      const rawPk  = editable ? JSON.stringify(Object.fromEntries(primaryKeys.map((k) => [k, row[k]]))) : '';
      const pkJson = editable ? esc(rawPk) : '';
      const rowAttr  = editable ? ` data-pk="${pkJson}"` : '';
      const checkTd  = editable
        ? `<td class="col-check"><input type="checkbox" class="row-check" data-pk="${pkJson}"${selectedPks.has(rawPk) ? ' checked' : ''}></td>`
        : '';
      return `<tr${rowAttr}>${checkTd}${currentData!.columns.map((col) => {
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

// ── Query Formatter ───────────────────────────────────────────────────────────

const SQL_KEYWORDS = [
  'SELECT','DISTINCT','FROM','WHERE','AND','OR','NOT','IN','EXISTS','BETWEEN','LIKE','IS','NULL',
  'JOIN','INNER','LEFT','RIGHT','FULL','OUTER','CROSS','ON','USING',
  'GROUP BY','ORDER BY','HAVING','LIMIT','OFFSET','UNION','ALL','EXCEPT','INTERSECT',
  'INSERT INTO','INSERT','INTO','VALUES','UPDATE','SET','DELETE FROM','DELETE',
  'CREATE TABLE','CREATE INDEX','CREATE VIEW','ALTER TABLE','DROP TABLE','DROP INDEX',
  'WITH','AS','CASE','WHEN','THEN','ELSE','END','CAST','COALESCE','NULLIF',
  'COUNT','SUM','AVG','MIN','MAX','UPPER','LOWER','TRIM','LENGTH','SUBSTRING',
  'ASC','DESC','RETURNING','PRIMARY KEY','FOREIGN KEY','REFERENCES','DEFAULT',
  'NOT NULL','UNIQUE','CHECK','INDEX','CONSTRAINT','BEGIN','COMMIT','ROLLBACK',
];

function formatQuery() {
  const raw = editor.state.doc.toString().trim();
  if (!raw) return;

  // Uppercase keywords
  let sql = raw;
  const sorted = [...SQL_KEYWORDS].sort((a, b) => b.length - a.length);
  for (const kw of sorted) {
    sql = sql.replace(new RegExp(`\\b${kw}\\b`, 'gi'), kw);
  }

  // Normalize whitespace
  sql = sql.replace(/\s+/g, ' ').trim();

  // Line breaks before major clauses
  const BREAKS = ['SELECT','FROM','WHERE','GROUP BY','ORDER BY','HAVING','LIMIT','OFFSET',
                  'INNER JOIN','LEFT JOIN','RIGHT JOIN','FULL JOIN','CROSS JOIN','JOIN',
                  'UNION ALL','UNION','EXCEPT','INTERSECT','INSERT INTO','VALUES','UPDATE',
                  'SET','DELETE FROM','WITH'];
  const breakRe = new RegExp(`\\b(${BREAKS.map((k) => k.replace(/ /g, '\\s+')).join('|')})\\b`, 'g');
  sql = sql.replace(breakRe, '\n$1');

  // AND / OR on new indented line inside WHERE/HAVING
  sql = sql.replace(/\b(AND|OR)\b/g, '\n  $1');

  // Clean leading newline
  sql = sql.replace(/^\n+/, '').trim();

  setEditorContent(sql);
  showToast('Query formatted');
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
  ['export-csv', 'export-json', 'export-excel', 'export-pdf'].forEach((id) => {
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

function exportExcel() {
  if (!currentData) return;
  const rows = filteredRows();
  const { columns } = currentData;

  const xmlEsc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const cell = (val: unknown): string => {
    if (val === null || val === undefined) return '<Cell><Data ss:Type="String"></Data></Cell>';
    const str = String(val);
    const type = !isNaN(Number(str)) && str.trim() !== '' ? 'Number' : 'String';
    return `<Cell><Data ss:Type="${type}">${xmlEsc(str)}</Data></Cell>`;
  };

  const headerRow = `<Row>${columns.map((c) => `<Cell><Data ss:Type="String">${xmlEsc(c)}</Data></Cell>`).join('')}</Row>`;
  const dataRows  = rows.map((r) => `<Row>${columns.map((c) => cell(r[c])).join('')}</Row>`).join('');

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<?mso-application progid="Excel.Sheet"?>`,
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"`,
    ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`,
    `<Worksheet ss:Name="Results"><Table>`,
    headerRow,
    dataRows,
    `</Table></Worksheet></Workbook>`,
  ].join('');

  download(xml, 'query_results.xls', 'application/vnd.ms-excel');
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

function closeCtxMenu() { document.getElementById('ctx-menu')?.remove(); }

function updateDeleteBtn() {
  const btn = document.getElementById('btn-delete-rows') as HTMLButtonElement | null;
  if (btn) btn.disabled = selectedPks.size === 0;
}

function updateCheckAll() {
  const checkAll = document.getElementById('check-all') as HTMLInputElement | null;
  if (!checkAll || !currentData) return;
  const pageRows = filteredRows().slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const sel = pageRows.filter((row) =>
    selectedPks.has(JSON.stringify(Object.fromEntries(primaryKeys.map((k) => [k, row[k]]))))).length;
  checkAll.checked       = sel > 0 && sel === pageRows.length;
  checkAll.indeterminate = sel > 0 && sel < pageRows.length;
}

function deleteSelectedRows() {
  if (!selectedPks.size || !currentTable || !primaryKeys.length) return;
  const q = quoteIdentifier;
  const tableRef = currentSchema ? `${q(currentSchema)}.${q(currentTable)}` : q(currentTable);
  const sqls = Array.from(selectedPks).map((rawPk) => {
    const pkValues = JSON.parse(rawPk) as Record<string, unknown>;
    const where = primaryKeys.map((k) => {
      const v = pkValues[k];
      if (v === null || v === undefined) return `${q(k)} IS NULL`;
      const n = Number(v);
      return `${q(k)} = ${!isNaN(n) && String(v).trim() !== '' ? v : `'${String(v).replace(/'/g, "''")}'`}`;
    }).join(' AND ');
    return `DELETE FROM ${tableRef} WHERE ${where}`;
  });
  vscode.postMessage({ type: 'deleteRows', sqls });
}

// ── Insert Row Modal ──────────────────────────────────────────────────────────

function showInsertModal() {
  if (!currentTable || !columnDefs.length) return;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const autoDateRe = /^(created_at|updated_at|created_date|updated_date|createdat|updatedat)$/i;

  const fields = columnDefs.map((col) => {
    const isPk  = primaryKeys.includes(col.name);
    const isDate = autoDateRe.test(col.name);
    const val   = isDate ? now : '';
    const badge = isPk ? `<span class="insert-badge insert-pk">PK</span>` : (!col.nullable ? `<span class="insert-badge insert-req">*</span>` : '');
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
        <span>Insert into <strong>${esc(currentTable)}</strong></span>
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

function onInsertKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeInsertModal();
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitInsert();
}

function closeInsertModal() {
  document.getElementById('insert-overlay')?.remove();
  document.removeEventListener('keydown', onInsertKeydown);
}

function quoteIdentifier(name: string): string {
  return dbType === 'mysql' ? `\`${name}\`` : `"${name}"`;
}

function submitInsert() {
  const overlay = document.getElementById('insert-overlay');
  if (!overlay) return;
  const inputs = overlay.querySelectorAll<HTMLInputElement>('.insert-input');
  const q = quoteIdentifier;
  const tableRef = currentSchema ? `${q(currentSchema)}.${q(currentTable)}` : q(currentTable);
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

function showToast(msg: string) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('toast-visible');
  setTimeout(() => toast!.classList.remove('toast-visible'), 2000);
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
    columnDefs      = (msg.columnDefs as typeof columnDefs) || [];
    dbType          = (msg.dbType as string) || '';
    document.getElementById('conn-name')!.textContent = msg.connectionName as string;
    document.getElementById('db-name')!.textContent   = msg.database as string;
    (document.getElementById('btn-insert-row')  as HTMLButtonElement).hidden = !currentTable;
    (document.getElementById('btn-delete-rows') as HTMLButtonElement).hidden = !(currentTable && primaryKeys.length > 0);
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
  insertRowSuccess: ()   => { closeInsertModal(); showToast('Row inserted'); },
  insertRowError:  (msg) => {
    const errEl = document.getElementById('insert-error');
    if (errEl) { errEl.textContent = msg.message as string; errEl.hidden = false; }
  },
  tableMeta: (msg) => {
    currentTable  = msg.table as string;
    currentSchema = (msg.schema as string) || currentSchema;
    primaryKeys   = (msg.primaryKeys as string[]) || [];
    columnDefs    = (msg.columnDefs as typeof columnDefs) || [];
    (document.getElementById('btn-insert-row')  as HTMLButtonElement).hidden = !currentTable;
    (document.getElementById('btn-delete-rows') as HTMLButtonElement).hidden = !(currentTable && primaryKeys.length > 0);
    renderHeaders();
    renderPage();
  },
  deleteRowsSuccess: (msg) => {
    selectedPks.clear();
    updateDeleteBtn();
    showToast(`${msg.count as number} row(s) deleted`);
  },
  deleteRowError:  (msg) => showToast(`Error: ${msg.message as string}`),
};

window.addEventListener('message', (event) => {
  const msg = event.data as Record<string, unknown>;
  MESSAGE_HANDLERS[msg.type as string]?.(msg);
});

document.addEventListener('DOMContentLoaded', init);
