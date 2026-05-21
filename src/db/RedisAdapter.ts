import { createClient, RedisClientType } from 'redis';
import { IAdapter } from './IAdapter';
import { ConnectionConfig, QueryResult, TableInfo, DatabaseInfo, ColumnInfo } from '../types';

export class RedisAdapter implements IAdapter {
  private client: RedisClientType | null = null;
  private connected = false;

  constructor(private readonly config: ConnectionConfig) {}

  async connect(): Promise<void> {
    this.client = createClient({
      socket: { host: this.config.host || '127.0.0.1', port: this.config.port || 6379 },
      password: this.config.password || undefined,
    }) as RedisClientType;
    this.client.on('error', () => { this.connected = false; });
    await this.client.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    if (!this.client) throw new Error('Not connected');
    const info = await this.client.info('keyspace');
    const dbs: DatabaseInfo[] = [];
    const lines = info.split('\n').filter((l) => l.startsWith('db'));
    for (const line of lines) {
      const m = line.match(/^db(\d+):/);
      if (m) dbs.push({ name: `db:${m[1]}` });
    }
    return dbs.length > 0 ? dbs : [{ name: 'db:0' }];
  }

  async getTables(database: string): Promise<TableInfo[]> {
    if (!this.client) throw new Error('Not connected');
    const dbNum = parseInt(database.replace('db:', '')) || 0;
    await this.client.select(dbNum);
    const keys = await this.client.keys('*');
    return keys.slice(0, 500).sort().map((k) => ({ name: k, type: 'table' as const }));
  }

  async getColumns(_database: string, key: string): Promise<ColumnInfo[]> {
    if (!this.client) throw new Error('Not connected');
    const type = await this.client.type(key);
    return [{ name: 'key', type, nullable: false }];
  }

  // Accepts Redis CLI commands, one per line
  async query(commands: string, database?: string): Promise<QueryResult> {
    if (!this.client) throw new Error('Not connected');
    const start = Date.now();

    if (database) {
      const dbNum = parseInt(database.replace('db:', '')) || 0;
      await this.client.select(dbNum);
    }

    const lines = commands.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    const rows: Record<string, unknown>[] = [];

    for (const line of lines) {
      const parts = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
      const args = parts.map((p) => p.replace(/^['"]|['"]$/g, ''));
      try {
        const result = await (this.client as unknown as { sendCommand(a: string[]): Promise<unknown> }).sendCommand(args);
        rows.push({ command: line, result: JSON.stringify(result) });
      } catch (err) {
        rows.push({ command: line, result: `ERROR: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    return { columns: ['command', 'result'], rows, rowCount: rows.length, duration: Date.now() - start };
  }
}
