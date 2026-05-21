/* eslint-disable @typescript-eslint/no-explicit-any */
import { BaseAdapter } from './BaseAdapter';
import { IAdapter } from './IAdapter';
import { ConnectionConfig, QueryResult, TableInfo, DatabaseInfo, ColumnInfo } from '../types';

const INTROSPECTION = `{
  __schema {
    queryType { fields { name description args { name type { name kind } } } }
    mutationType { fields { name description } }
  }
}`;

export class GraphQLAdapter extends BaseAdapter implements IAdapter {
  private connected = false;

  constructor(private readonly config: ConnectionConfig) { super(); }

  async connect(): Promise<void> {
    if (!this.config.url) throw new Error('GraphQL endpoint URL is required');
    await this.execute('{ __typename }');
    this.connected = true;
  }

  async disconnect(): Promise<void> { this.connected = false; }

  isConnected(): boolean { return this.connected; }

  buildDefaultQuery(table: string, _schema?: string): string {
    return `{\n  ${table} {\n    id\n  }\n}`;
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    return [{ name: 'schema' }];
  }

  async getTables(_database: string): Promise<TableInfo[]> {
    const data = await this.execute(INTROSPECTION);
    const schema = data?.data?.__schema;
    const queries: TableInfo[] = (schema?.queryType?.fields ?? []).map(
      (f: { name: string }) => ({ name: f.name, type: 'table' as const }),
    );
    const mutations: TableInfo[] = (schema?.mutationType?.fields ?? []).map(
      (f: { name: string }) => ({ name: `[mut] ${f.name}`, type: 'view' as const }),
    );
    return [...queries, ...mutations];
  }

  async getColumns(_database: string, queryField: string): Promise<ColumnInfo[]> {
    const data = await this.execute(INTROSPECTION);
    const fields: Array<{ name: string; args: Array<{ name: string; type: { name: string } }> }> =
      data?.data?.__schema?.queryType?.fields ?? [];
    const field = fields.find((f) => f.name === queryField);
    return (field?.args ?? []).map((a) => ({
      name: a.name,
      type: a.type?.name ?? 'Any',
      nullable: true,
    }));
  }

  async query(graphqlQuery: string, _database?: string): Promise<QueryResult> {
    const start = Date.now();
    const response = await this.execute(graphqlQuery);

    if (response.errors?.length) {
      throw new Error(response.errors.map((e: { message: string }) => e.message).join('\n'));
    }

    const data = response.data ?? {};
    const topKeys = Object.keys(data);

    for (const key of topKeys) {
      const val = data[key];
      if (Array.isArray(val) && val.length > 0) {
        const columns = Object.keys(val[0]);
        const rows = val.map((item: Record<string, unknown>) => {
          const row: Record<string, unknown> = {};
          columns.forEach((c) => {
            const v = item[c];
            row[c] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
          });
          return row;
        });
        return { columns, rows, rowCount: rows.length, duration: Date.now() - start };
      }
    }

    const rows = topKeys.map((k) => ({ key: k, value: JSON.stringify(data[k]) }));
    return { columns: ['key', 'value'], rows, rowCount: rows.length, duration: Date.now() - start };
  }

  private async execute(query: string): Promise<Record<string, any>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.config.headers ?? {}),
    };
    const res = await fetch(this.config.url!, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json() as Promise<Record<string, unknown>>;
  }
}
