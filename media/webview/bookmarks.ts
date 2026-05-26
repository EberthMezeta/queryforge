import { state, Bookmark } from './state';
import { vscode } from './vscode-api';
import { esc, hide, copyText } from './ui-helpers';
import { doExportQuery } from './export';
import { setEditorContent } from './query-executor';

export function toggleBookmarksPanel(): void {
  const panel = document.getElementById('bookmarks-panel')!;
  if (panel.hidden) {
    document.getElementById('history-panel')!.hidden = true;
    document.getElementById('save-form')!.hidden = true;
    panel.hidden = false;
  } else {
    panel.hidden = true;
  }
}

export function openSaveForm(): void {
  document.getElementById('bookmarks-panel')!.hidden = false;
  document.getElementById('save-form')!.hidden = false;
  const input = document.getElementById('bookmark-name-input') as HTMLInputElement;
  input.value = ''; input.focus();
}

export function closeSaveForm(): void {
  document.getElementById('save-form')!.hidden = true;
}

export function confirmSave(): void {
  const input = document.getElementById('bookmark-name-input') as HTMLInputElement;
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  const sqlText = state.editor!.state.doc.toString().trim();
  if (!sqlText) { closeSaveForm(); return; }
  vscode.postMessage({ type: 'saveBookmark', name, sql: sqlText });
  closeSaveForm();
}

export function updateBookmarks(items: Bookmark[]): void {
  state.bookmarks = items;
  document.getElementById('bookmark-count')!.textContent = String(items.length);
  document.getElementById('bookmark-list')!.innerHTML = items.length
    ? items.map(renderBookmarkItem).join('')
    : `<div class="bookmark-empty">No saved queries</div>`;
}

export function renderBookmarkItem(b: Bookmark): string {
  return `<div class="bookmark-item" data-id="${esc(b.id)}">
    <span class="bookmark-item-name" title="${esc(b.sql)}">${esc(b.name)}</span>
    <button class="bookmark-cpy" data-action="copy" title="Copy SQL">📋</button>
    <button class="bookmark-exp" data-action="export" title="Export">📤</button>
    <button class="bookmark-del" data-action="delete" title="Delete">✕</button>
  </div>`;
}

export function initBookmarkListeners(): void {
  document.getElementById('bookmark-list')!.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.bookmark-item') as HTMLElement | null;
    if (!item) return;
    const id = item.dataset.id!;
    const bm = state.bookmarks.find((b) => b.id === id);
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
}
