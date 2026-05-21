import { EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from '@codemirror/view';
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

const vscode = acquireVsCodeApi();
let editor: EditorView;
let currentData: QueryResult | null = null;
let currentDatabase = '';

function init() {
  const container = document.getElementById('editor-container')!;

  editor = new EditorView({
    state: EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        sql(),
        oneDark,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          { key: 'Ctrl-Enter', run: () => { runQuery(); return true; } },
          { key: 'Mod-Enter', run: () => { runQuery(); return true; } },
        ]),
      ],
    }),
    parent: container,
  });

  document.getElementById('run-btn')!.addEventListener('click', runQuery);
  document.getElementById('export-csv')!.addEventListener('click', exportCSV);
  document.getElementById('export-json')!.addEventListener('click', exportJSON);
  document.getElementById('export-pdf')!.addEventListener('click', exportPDF);

  setExportButtons(false);
  vscode.postMessage({ type: 'ready' });
}

function runQuery() {
  const sql = editor.state.doc.toString().trim();
  if (!sql) return;
  showLoading();
  vscode.postMessage({ type: 'runQuery', sql, database: currentDatabase });
}

function setExportButtons(enabled: boolean) {
  ['export-csv', 'export-json', 'export-pdf'].forEach((id) => {
    const btn = document.getElementById(id) as HTMLButtonElement;
    btn.disabled = !enabled;
  });
}

function showLoading() {
  hide('results-section');
  hide('error-section');
  show('loading-section');
}

function showResults(data: QueryResult) {
  currentData = data;
  hide('loading-section');
  hide('error-section');

  document.getElementById('row-count')!.textContent = `${data.rowCount} rows`;
  document.getElementById('query-time')!.textContent = `${data.duration} ms`;

  const thead = document.getElementById('t-head')!;
  thead.innerHTML = data.columns.map((c) => `<th>${esc(c)}</th>`).join('');

  const tbody = document.getElementById('t-body')!;
  tbody.innerHTML = data.rows
    .map(
      (row) =>
        `<tr>${data.columns
          .map((col) => {
            const val = row[col];
            if (val === null || val === undefined) {
              return `<td><span class="null-val">NULL</span></td>`;
            }
            return `<td>${esc(String(val))}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');

  setExportButtons(data.rows.length > 0);
  show('results-section');
}

function showError(message: string) {
  hide('loading-section');
  hide('results-section');
  setExportButtons(false);
  document.getElementById('error-msg')!.textContent = message;
  show('error-section');
}

function setEditorContent(content: string) {
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: content },
  });
}

function exportCSV() {
  if (!currentData) return;
  const { columns, rows } = currentData;
  const lines = [
    columns.map(csvCell).join(','),
    ...rows.map((r) => columns.map((c) => csvCell(String(r[c] ?? ''))).join(',')),
  ];
  download(lines.join('\r\n'), 'query_results.csv', 'text/csv');
}

function exportJSON() {
  if (!currentData) return;
  download(JSON.stringify(currentData.rows, null, 2), 'query_results.json', 'application/json');
}

function exportPDF() {
  if (!currentData) return;
  const { columns, rows } = currentData;
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

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function show(id: string) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}

function hide(id: string) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}

window.addEventListener('message', (event) => {
  const msg = event.data as Record<string, unknown>;
  switch (msg.type) {
    case 'init':
      currentDatabase = msg.database as string;
      document.getElementById('conn-name')!.textContent = msg.connectionName as string;
      document.getElementById('db-name')!.textContent = msg.database as string;
      if (msg.query) {
        setEditorContent(msg.query as string);
        runQuery();
      }
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
  }
});

document.addEventListener('DOMContentLoaded', init);
