import type { EditorView } from '@codemirror/view';
import type { Compartment } from '@codemirror/state';

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  duration: number;
}

export interface Bookmark { id: string; name: string; sql: string; }
export interface HistoryEntry { id: string; sql: string; executedAt: number; }
export interface ColumnDef { name: string; type: string; nullable: boolean; }

export interface AppState {
  editor: EditorView | null;
  sqlLang: Compartment | null;
  currentData: QueryResult | null;
  currentDatabase: string;
  currentTable: string;
  currentSchema: string;
  primaryKeys: string[];
  bookmarks: Bookmark[];
  historyEntries: HistoryEntry[];
  historyIndex: number;
  currentPage: number;
  filterText: string;
  sortCol: string | null;
  sortDir: 'asc' | 'desc';
  baseQuery: string;
  runningSQL: string;
  columnDefs: ColumnDef[];
  dbType: string;
  selectedPks: Set<string>;
  editingCell: { td: HTMLElement; originalContent: string } | null;
  // Server-side pagination
  serverPage: number;
  hasMorePages: boolean;
}

export const state: AppState = {
  editor: null,
  sqlLang: null,
  currentData: null,
  currentDatabase: '',
  currentTable: '',
  currentSchema: '',
  primaryKeys: [],
  bookmarks: [],
  historyEntries: [],
  historyIndex: -1,
  currentPage: 0,
  filterText: '',
  sortCol: null,
  sortDir: 'asc',
  baseQuery: '',
  runningSQL: '',
  columnDefs: [],
  dbType: '',
  selectedPks: new Set<string>(),
  editingCell: null,
  serverPage: 0,
  hasMorePages: false,
};
