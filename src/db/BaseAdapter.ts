import { QueryResult } from '../types';

export abstract class BaseAdapter {
  abstract isConnected(): boolean;

  protected assertConnected(): void {
    if (!this.isConnected()) throw new Error('Not connected');
  }

  protected dmlResult(affected: number, duration: number): QueryResult {
    return {
      columns: ['affected_rows', 'status'],
      rows: [{ affected_rows: affected, status: 'Query OK' }],
      rowCount: affected,
      duration,
    };
  }
}
