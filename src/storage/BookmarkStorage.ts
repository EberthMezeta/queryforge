import * as vscode from 'vscode';

export interface Bookmark {
  id: string;
  name: string;
  sql: string;
  createdAt: number;
}

export class BookmarkStorage {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private key(connectionId: string, database: string): string {
    return `dbConnection.bookmarks.${connectionId}.${database}`;
  }

  getAll(connectionId: string, database: string): Bookmark[] {
    return this.context.globalState.get<Bookmark[]>(this.key(connectionId, database), []);
  }

  add(connectionId: string, database: string, name: string, sql: string): Bookmark[] {
    const bookmark: Bookmark = {
      id: Date.now().toString(),
      name: name.trim(),
      sql,
      createdAt: Date.now(),
    };
    const all = [bookmark, ...this.getAll(connectionId, database)];
    this.context.globalState.update(this.key(connectionId, database), all);
    return all;
  }

  delete(connectionId: string, database: string, id: string): Bookmark[] {
    const all = this.getAll(connectionId, database).filter((b) => b.id !== id);
    this.context.globalState.update(this.key(connectionId, database), all);
    return all;
  }
}
