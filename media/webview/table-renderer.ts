import { state } from './state';
import { esc, show, hide } from './ui-helpers';

const PAGE_SIZE = 100;

export function filteredRows(): Record<string, unknown>[] {
  if (!state.currentData) return [];
  let rows: Record<string, unknown>[] = state.currentData.rows;
  if (state.filterText) {
    const lower = state.filterText.toLowerCase();
    rows = rows.filter((row) =>
      state.currentData!.columns.some((col) => {
        const v = row[col];
        return v !== null && v !== undefined && String(v).toLowerCase().includes(lower);
      }),
    );
  }
  if (state.sortCol) {
    const col = state.sortCol;
    rows = [...rows].sort((a, b) => {
      const av = a[col], bv = b[col];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const an = Number(av), bn = Number(bv);
      const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : String(av).localeCompare(String(bv));
      return state.sortDir === 'asc' ? cmp : -cmp;
    });
  }
  return rows;
}

export function renderHeaders(): void {
  if (!state.currentData) return;
  const hasKeys = state.currentTable && state.primaryKeys.length > 0;
  const checkTh = hasKeys ? `<th class="col-check"><input type="checkbox" id="check-all" title="Select all"></th>` : '';
  document.getElementById('t-head')!.innerHTML = checkTh + state.currentData.columns
    .map((c) => {
      const active = c === state.sortCol;
      const arrow = active ? `<span class="sort-arrow">${state.sortDir === 'asc' ? '▲' : '▼'}</span>` : '';
      return `<th data-col="${esc(c)}">${esc(c)}${arrow}</th>`;
    })
    .join('');
}

export function renderPage(): void {
  if (!state.currentData) return;
  const rows = filteredRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.currentPage = Math.min(state.currentPage, totalPages - 1);

  const pageRows = rows.slice(state.currentPage * PAGE_SIZE, (state.currentPage + 1) * PAGE_SIZE);
  const editable = state.currentTable && state.primaryKeys.length > 0;

  document.getElementById('t-body')!.innerHTML = pageRows
    .map((row) => {
      const rawPk  = editable ? JSON.stringify(Object.fromEntries(state.primaryKeys.map((k) => [k, row[k]]))) : '';
      const pkJson = editable ? esc(rawPk) : '';
      const rowAttr  = editable ? ` data-pk="${pkJson}"` : '';
      const checkTd  = editable
        ? `<td class="col-check"><input type="checkbox" class="row-check" data-pk="${pkJson}"${state.selectedPks.has(rawPk) ? ' checked' : ''}></td>`
        : '';
      return `<tr${rowAttr}>${checkTd}${state.currentData!.columns.map((col) => {
        const val = row[col];
        const isPk = state.primaryKeys.includes(col);
        const colAttr = editable && !isPk ? ` class="cell-editable" data-col="${esc(col)}"` : '';
        return val === null || val === undefined
          ? `<td${colAttr}><span class="null-val">NULL</span></td>`
          : `<td${colAttr}>${esc(String(val))}</td>`;
      }).join('')}</tr>`;
    })
    .join('');

  document.getElementById('table-wrapper')!.scrollTop = 0;

  const countEl = document.getElementById('row-count')!;
  if (state.filterText && rows.length !== state.currentData.rowCount) {
    countEl.textContent = `${rows.length.toLocaleString()} / ${state.currentData.rowCount.toLocaleString()} rows`;
  } else {
    countEl.textContent = `${state.currentData.rowCount.toLocaleString()} rows`;
  }

  if (totalPages > 1) {
    document.getElementById('page-info')!.textContent = `Page ${state.currentPage + 1} of ${totalPages}`;
    (document.getElementById('page-prev') as HTMLButtonElement).disabled = state.currentPage === 0;
    (document.getElementById('page-next') as HTMLButtonElement).disabled = state.currentPage >= totalPages - 1;
    show('pagination');
  } else {
    hide('pagination');
  }

  setExportButtons(rows.length > 0);
}

export function goToPage(page: number): void {
  if (!state.currentData) return;
  const total = Math.ceil(filteredRows().length / PAGE_SIZE);
  state.currentPage = Math.max(0, Math.min(page, total - 1));
  renderPage();
}

export function updateCheckAll(): void {
  const checkAll = document.getElementById('check-all') as HTMLInputElement | null;
  if (!checkAll || !state.currentData) return;
  const pageRows = filteredRows().slice(state.currentPage * PAGE_SIZE, (state.currentPage + 1) * PAGE_SIZE);
  const sel = pageRows.filter((row) =>
    state.selectedPks.has(JSON.stringify(Object.fromEntries(state.primaryKeys.map((k) => [k, row[k]]))))).length;
  checkAll.checked       = sel > 0 && sel === pageRows.length;
  checkAll.indeterminate = sel > 0 && sel < pageRows.length;
}

export function updateDeleteBtn(): void {
  const btn = document.getElementById('btn-delete-rows') as HTMLButtonElement | null;
  if (btn) btn.disabled = state.selectedPks.size === 0;
}

export function setExportButtons(enabled: boolean): void {
  ['export-csv', 'export-json', 'export-excel', 'export-pdf'].forEach((id) => {
    (document.getElementById(id) as HTMLButtonElement).disabled = !enabled;
  });
}
