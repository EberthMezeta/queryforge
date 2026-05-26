import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { state } from './state';
import { filteredRows } from './table-renderer';
import { download, csvCell } from './ui-helpers';

export function setExportButtonsEnabled(enabled: boolean): void {
  ['export-csv', 'export-json', 'export-excel', 'export-pdf'].forEach((id) => {
    (document.getElementById(id) as HTMLButtonElement).disabled = !enabled;
  });
}

export function exportCSV(): void {
  if (!state.currentData) return;
  const rows = filteredRows();
  const { columns } = state.currentData;
  const lines = [
    columns.map(csvCell).join(','),
    ...rows.map((r) => columns.map((c) => csvCell(String(r[c] ?? ''))).join(',')),
  ];
  download(lines.join('\r\n'), 'query_results.csv', 'text/csv');
}

export function exportJSON(): void {
  if (!state.currentData) return;
  download(JSON.stringify(filteredRows(), null, 2), 'query_results.json', 'application/json');
}

export function exportExcel(): void {
  if (!state.currentData) return;
  const rows = filteredRows();
  const { columns } = state.currentData;

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
    headerRow, dataRows,
    `</Table></Worksheet></Workbook>`,
  ].join('');

  download(xml, 'query_results.xls', 'application/vnd.ms-excel');
}

export function exportPDF(): void {
  if (!state.currentData) return;
  const rows = filteredRows();
  const { columns } = state.currentData;
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

type QueryExporter = (sql: string, base: string) => void;

const QUERY_EXPORTERS: Record<string, QueryExporter> = {
  sql: (s, b) => download(s, `${b}.sql`, 'text/plain'),
  txt: (s, b) => download(s, `${b}.txt`, 'text/plain'),
  md:  (s, b) => download('```sql\n' + s + '\n```\n', `${b}.md`, 'text/markdown'),
  pdf: (s, b) => exportQueryPDF(s, b),
};

export function doExportQuery(sqlText: string, baseName: string): void {
  const fmt = (document.getElementById('export-query-fmt') as HTMLSelectElement).value;
  QUERY_EXPORTERS[fmt]?.(sqlText, baseName);
}

export function exportQuery(sqlText: string): void {
  if (!sqlText) return;
  doExportQuery(sqlText, 'query');
}

function exportQueryPDF(sqlText: string, baseName = 'query'): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFont('Courier', 'normal');
  doc.setFontSize(10);
  const lines = doc.splitTextToSize(sqlText, 515);
  doc.text(lines, 40, 40);
  doc.save(`${baseName}.pdf`);
}
