import * as vscode from 'vscode';

export interface Bookmark {
  id: string;
  name: string;
  sql: string;
  createdAt: number;
}

export class BookmarkStorage {
  private static readonly KEY = 'dbConnection.bookmarks';

  constructor(private readonly context: vscode.ExtensionContext) {}

  getAll(): Bookmark[] {
    return this.context.globalState.get<Bookmark[]>(BookmarkStorage.KEY, []);
  }

  add(name: string, sql: string): Bookmark[] {
    const bookmark: Bookmark = {
      id: Date.now().toString(),
      name: name.trim(),
      sql,
      createdAt: Date.now(),
    };
    const all = [bookmark, ...this.getAll()];
    this.context.globalState.update(BookmarkStorage.KEY, all);
    return all;
  }

  delete(id: string): Bookmark[] {
    const all = this.getAll().filter((b) => b.id !== id);
    this.context.globalState.update(BookmarkStorage.KEY, all);
    return all;
  }
}
