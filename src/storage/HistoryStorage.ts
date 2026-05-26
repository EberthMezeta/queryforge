import { IStorageContext } from './IStorageContext';
import { MAX_HISTORY } from '../constants';

export interface HistoryEntry {
  id: string;
  sql: string;
  executedAt: number;
}

export class HistoryStorage {
  constructor(private readonly context: IStorageContext) {}

  private key(connectionId: string, database: string): string {
    return `dbConnection.history.${connectionId}.${database}`;
  }

  getAll(connectionId: string, database: string): HistoryEntry[] {
    return this.context.globalState.get<HistoryEntry[]>(this.key(connectionId, database), []);
  }

  push(connectionId: string, database: string, sql: string): HistoryEntry[] {
    const entry: HistoryEntry = { id: Date.now().toString(), sql, executedAt: Date.now() };
    let all = this.getAll(connectionId, database).filter((e) => e.sql !== sql);
    all = [entry, ...all].slice(0, MAX_HISTORY);
    this.context.globalState.update(this.key(connectionId, database), all);
    return all;
  }

  clear(connectionId: string, database: string): void {
    this.context.globalState.update(this.key(connectionId, database), []);
  }
}
