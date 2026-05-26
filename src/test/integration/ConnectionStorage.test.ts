import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionStorage } from '../../storage/ConnectionStorage';
import { makeMockContext } from './mockStorage';
import { ConnectionConfig } from '../../types';

const config: ConnectionConfig = {
  id: 'c1',
  name: 'Local PG',
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  user: 'admin',
  password: 'secret',
};

describe('ConnectionStorage', () => {
  let storage: ConnectionStorage;
  let ctx: ReturnType<typeof makeMockContext>;

  beforeEach(() => {
    ctx = makeMockContext();
    storage = new ConnectionStorage(ctx);
  });

  it('starts with no connections', async () => {
    expect(await storage.getConnections()).toEqual([]);
  });

  it('saves and retrieves a connection (password in secrets)', async () => {
    await storage.saveConnection(config);
    const result = await storage.getConnections();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
    expect(result[0].password).toBe('secret');
    // password must NOT be stored in globalState
    const raw = ctx.globalState.rawGet<any[]>('dbConnection.connections') ?? [];
    expect(raw[0]).not.toHaveProperty('password');
  });

  it('updates an existing connection on re-save', async () => {
    await storage.saveConnection(config);
    await storage.saveConnection({ ...config, name: 'Updated' });
    const result = await storage.getConnections();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Updated');
  });

  it('deletes a connection by id', async () => {
    await storage.saveConnection(config);
    await storage.deleteConnection('c1');
    expect(await storage.getConnections()).toHaveLength(0);
    expect(await ctx.secrets.get('db.password.c1')).toBeUndefined();
  });

  it('migrates legacy plaintext passwords to secrets', async () => {
    // Simulate old format: password stored inline in globalState
    await ctx.globalState.update('dbConnection.connections', [
      { id: 'old-1', name: 'Legacy', type: 'mysql', host: 'h', port: 3306, user: 'u', password: 'legacyPwd' },
    ]);

    const result = await storage.getConnections();
    expect(result[0].password).toBe('legacyPwd');

    // After migration the inline password should be removed from globalState
    const raw = ctx.globalState.rawGet<any[]>('dbConnection.connections') ?? [];
    expect(raw[0]).not.toHaveProperty('password');

    // And stored in secrets
    expect(await ctx.secrets.get('db.password.old-1')).toBe('legacyPwd');
  });
});
