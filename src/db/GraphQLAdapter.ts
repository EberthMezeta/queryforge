import { BaseAdapter } from './BaseAdapter';
import { IAdapter } from './IAdapter';
import { ConnectionConfig, QueryResult, TableInfo, DatabaseInfo, ColumnInfo } from '../types';

// ── Syntax validator ─────────────────────────────────────────────────────────

function validateGraphQLSyntax(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) throw new Error('GraphQL query cannot be empty');
  if (!/^(\{|query\b|mutation\b|subscription\b|fragment\b)/.test(trimmed)) {
    throw new Error('GraphQL query must start with { or an operation keyword (query, mutation, subscription, fragment)');
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (const ch of trimmed) {
    if (escape)         { escape = false; continue; }
    if (ch === '\\')    { escape = true;  continue; }
    if (ch === '"')     { inString = !inString; continue; }
    if (inString)       continue;
    if (ch === '{')     depth++;
    else if (ch === '}') {
      depth--;
      if (depth < 0) throw new Error('Unexpected } in GraphQL query');
    }
  }
  if (depth !== 0) throw new Error('Unbalanced braces in GraphQL query');
}

// ── Introspection query ───────────────────────────────────────────────────────

const INTROSPECTION = `{
  __schema {
    queryType { fields { name description args { name type { name kind } } } }
    mutationType { fields { name description } }
  }
}`;

interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface SchemaQueryType {
  fields: Array<{
    name: string;
    args: Array<{ name: string; type: { name: string } }>;
  }>;
}

interface MutationType {
  fields: Array<{ name: string }>;
}

interface IntrospectionData {
  __schema: {
    queryType: SchemaQueryType;
    mutationType?: MutationType;
  };
}

export class GraphQLAdapter extends BaseAdapter implements IAdapter {
  private connected = false;

  constructor(private readonly config: ConnectionConfig) { super(); }

  async connect(): Promise<void> {
    if (!this.config.url) throw new Error('GraphQL endpoint URL is required');
    await this.execute<{ __typename: string }>('{ __typename }');
    this.connected = true;
  }

  async disconnect(): Promise<void> { this.connected = false; }

  isConnected(): boolean { return this.connected; }

  async cancelQuery(_database?: string): Promise<void> { /* GraphQL HTTP requests are not cancellable after dispatch */ }

  buildDefaultQuery(table: string, _schema?: string): string {
    return `{\n  ${table} {\n    id\n  }\n}`;
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    return [{ name: 'schema' }];
  }

  async getTables(_database: string): Promise<TableInfo[]> {
    const response = await this.execute<IntrospectionData>(INTROSPECTION);
    const schema = response.data?.__schema;
    const queries: TableInfo[] = (schema?.queryType?.fields ?? []).map(
      (f) => ({ name: f.name, type: 'table' as const }),
    );
    const mutations: TableInfo[] = (schema?.mutationType?.fields ?? []).map(
      (f) => ({ name: `[mut] ${f.name}`, type: 'view' as const }),
    );
    return [...queries, ...mutations];
  }

  async getColumns(_database: string, queryField: string): Promise<ColumnInfo[]> {
    const response = await this.execute<IntrospectionData>(INTROSPECTION);
    const fields = response.data?.__schema?.queryType?.fields ?? [];
    const field = fields.find((f) => f.name === queryField);
    return (field?.args ?? []).map((a) => ({
      name: a.name,
      type: a.type?.name ?? 'Any',
      nullable: true,
    }));
  }

  async query(graphqlQuery: string, _database?: string): Promise<QueryResult> {
    validateGraphQLSyntax(graphqlQuery);
    const start = Date.now();
    const response = await this.execute<Record<string, unknown>>(graphqlQuery);

    if (response.errors?.length) {
      throw new Error(response.errors.map((e) => e.message).join('\n'));
    }

    const data = response.data ?? {};
    const topKeys = Object.keys(data);

    for (const key of topKeys) {
      const val = data[key];
      if (Array.isArray(val) && val.length > 0) {
        const columns = Object.keys(val[0] as object);
        const rows = (val as Record<string, unknown>[]).map((item) => {
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

  private async execute<T = unknown>(query: string): Promise<GraphQLResponse<T>> {
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
    return res.json() as Promise<GraphQLResponse<T>>;
  }
}
