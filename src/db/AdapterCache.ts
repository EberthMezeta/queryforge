import { createAdapter, IAdapter } from './index';
import { ConnectionConfig } from '../types';

export class AdapterCache {
  private readonly cache = new Map<string, IAdapter>();

  async getOrConnect(config: ConnectionConfig): Promise<IAdapter> {
    const existing = this.cache.get(config.id);
    if (existing?.isConnected()) return existing;

    const adapter = createAdapter(config);
    await adapter.connect();
    this.cache.set(config.id, adapter);
    return adapter;
  }

  get(id: string): IAdapter | undefined {
    return this.cache.get(id);
  }

  async disconnect(id: string): Promise<void> {
    const adapter = this.cache.get(id);
    if (adapter) {
      await adapter.disconnect();
      this.cache.delete(id);
    }
  }

  isConnected(id: string): boolean {
    return this.cache.get(id)?.isConnected() ?? false;
  }
}
