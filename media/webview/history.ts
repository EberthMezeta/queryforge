import { state, HistoryEntry } from './state';
import { esc, hide } from './ui-helpers';
import { setEditorContent } from './query-executor';

export function toggleHistoryPanel(): void {
  const panel = document.getElementById('history-panel')!;
  if (panel.hidden) {
    document.getElementById('bookmarks-panel')!.hidden = true;
    panel.hidden = false;
  } else {
    panel.hidden = true;
  }
}

export function updateHistory(items: HistoryEntry[]): void {
  if (items.length === 0) state.historyIndex = -1;
  state.historyEntries = items;
  document.getElementById('history-count')!.textContent = String(items.length);
  document.getElementById('history-list')!.innerHTML = items.length
    ? items.map(renderHistoryItem).join('')
    : `<div class="history-empty">No history yet</div>`;
}

export function renderHistoryItem(h: HistoryEntry): string {
  return `<div class="history-item" data-id="${esc(h.id)}">
    <span class="history-sql" title="${esc(h.sql)}">${esc(h.sql.replace(/\s+/g, ' ').trim())}</span>
    <span class="history-time">${relativeTime(h.executedAt)}</span>
  </div>`;
}

export function navigateHistory(dir: number): void {
  if (!state.historyEntries.length) return;
  const next = state.historyIndex + dir;
  if (next < 0) { state.historyIndex = -1; return; }
  if (next >= state.historyEntries.length) return;
  state.historyIndex = next;
  setEditorContent(state.historyEntries[state.historyIndex].sql);
}

export function initHistoryListeners(): void {
  document.getElementById('history-list')!.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.history-item') as HTMLElement | null;
    if (!item) return;
    const entry = state.historyEntries.find((h) => h.id === item.dataset.id);
    if (entry) { setEditorContent(entry.sql); hide('history-panel'); }
  });
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
