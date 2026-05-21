import { MongoClient, Db } from 'mongodb';
import { IAdapter } from './IAdapter';
import { ConnectionConfig, QueryResult, TableInfo, DatabaseInfo, ColumnInfo } from '../types';

export class MongoAdapter implements IAdapter {
  private client: MongoClient | null = null;
  private connected = false;

  constructor(private readonly config: ConnectionConfig) {}

  async connect(): Promise<void> {
    const uri = this.config.url || this.buildUri();
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await this.client.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    if (!this.client) throw new Error('Not connected');
    const adminDb = this.client.db('admin');
    const { databases } = await adminDb.command({ listDatabases: 1, nameOnly: true });
    return (databases as Array<{ name: string }>)
      .filter((d) => !['admin', 'local', 'config'].includes(d.name))
      .map((d) => ({ name: d.name }));
  }

  async getTables(database: string): Promise<TableInfo[]> {
    if (!this.client) throw new Error('Not connected');
    const db: Db = this.client.db(database);
    const collections = await db.listCollections().toArray();
    return collections.map((c) => ({
      name: c.name,
      type: c.type === 'view' ? 'view' : 'table',
    }));
  }

  async getColumns(database: string, collection: string): Promise<ColumnInfo[]> {
    if (!this.client) throw new Error('Not connected');
    const doc = await this.client.db(database).collection(collection).findOne({});
    if (!doc) return [];
    return Object.keys(doc).map((k) => ({
      name: k,
      type: typeof doc[k] === 'object' ? (doc[k] instanceof Date ? 'Date' : 'Object') : typeof doc[k],
      nullable: true,
    }));
  }

  // Accepts Mongo shell syntax: db.collection.find({filter}).limit(n)
  async query(queryStr: string, database?: string): Promise<QueryResult> {
    if (!this.client) throw new Error('Not connected');
    const start = Date.now();

    const match = queryStr.trim().match(/^db\.(\w+)\.find\(([\s\S]*?)\)(?:\.limit\((\d+)\))?$/);
    if (!match) {
      throw new Error(
        'Use MongoDB shell syntax:\n  db.collection.find({ field: value }).limit(150)',
      );
    }

    const [, collection, filterStr, limitStr] = match;
    const filter = filterStr.trim() ? JSON.parse(filterStr) : {};
    const limit = parseInt(limitStr || '150') || 150;

    const db = this.client.db(database);
    const docs = await db.collection(collection).find(filter).limit(limit).toArray();

    const columns = docs.length > 0 ? Object.keys(docs[0]) : ['(empty)'];
    const rows = docs.map((doc) => {
      const row: Record<string, unknown> = {};
      columns.forEach((c) => {
        const v = doc[c];
        row[c] = v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : v;
      });
      return row;
    });

    return { columns, rows, rowCount: docs.length, duration: Date.now() - start };
  }

  private buildUri(): string {
    const user = this.config.user
      ? `${encodeURIComponent(this.config.user)}:${encodeURIComponent(this.config.password || '')}@`
      : '';
    const host = this.config.host || '127.0.0.1';
    const port = this.config.port || 27017;
    const db = this.config.database ? `/${this.config.database}` : '';
    return `mongodb://${user}${host}:${port}${db}`;
  }
}
