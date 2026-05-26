import { ConnectionConfig } from '../types';
import { IStorageContext } from './IStorageContext';

const STORAGE_KEY = 'dbConnection.connections';
const SECRET_PREFIX = 'db.password.';

type StoredConfig = Omit<ConnectionConfig, 'password'>;

export class ConnectionStorage {
  constructor(private readonly context: IStorageContext) {}

  async getConnections(): Promise<ConnectionConfig[]> {
    const stored = this.context.globalState.get<(StoredConfig & { password?: string })[]>(STORAGE_KEY, []);
    let needsCleanup = false;

    const configs = await Promise.all(stored.map(async (entry) => {
      const { password: legacyPwd, ...safe } = entry;

      if (legacyPwd) {
        await this.context.secrets.store(`${SECRET_PREFIX}${entry.id}`, legacyPwd);
        needsCleanup = true;
        return { ...safe, password: legacyPwd } as ConnectionConfig;
      }

      const password = await this.context.secrets.get(`${SECRET_PREFIX}${entry.id}`);
      return { ...safe, ...(password ? { password } : {}) } as ConnectionConfig;
    }));

    if (needsCleanup) {
      const clean = stored.map(({ password: _, ...s }) => s);
      await this.context.globalState.update(STORAGE_KEY, clean);
    }

    return configs;
  }

  async saveConnection(config: ConnectionConfig): Promise<void> {
    const { password, ...safe } = config;

    if (password !== undefined) {
      await this.context.secrets.store(`${SECRET_PREFIX}${config.id}`, password);
    }

    const stored = this.context.globalState.get<StoredConfig[]>(STORAGE_KEY, []);
    const idx = stored.findIndex(c => c.id === config.id);
    if (idx >= 0) {
      stored[idx] = safe;
    } else {
      stored.push(safe);
    }
    await this.context.globalState.update(STORAGE_KEY, stored);
  }

  async deleteConnection(id: string): Promise<void> {
    await this.context.secrets.delete(`${SECRET_PREFIX}${id}`);
    const stored = this.context.globalState.get<StoredConfig[]>(STORAGE_KEY, []).filter(c => c.id !== id);
    await this.context.globalState.update(STORAGE_KEY, stored);
  }
}
