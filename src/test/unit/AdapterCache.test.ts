import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index', () => ({
  createAdapter: vi.fn(),
}));

import { AdapterCache } from '../../db/AdapterCache';
import { createAdapter } from '../../db/index';

const makeAdapter = (connected = true) => ({
  connect:     vi.fn().mockResolvedValue(undefined),
  disconnect:  vi.fn().mockResolvedValue(undefined),
  isConnected: vi.fn().mockReturnValue(connected),
});

const baseConfig = { id: 'conn-1', type: 'postgres', host: 'localhost', port: 5432 } as any;

describe('AdapterCache', () => {
  let adapter: ReturnType<typeof makeAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = makeAdapter();
    (createAdapter as ReturnType<typeof vi.fn>).mockReturnValue(adapter);
  });

  it('connects and caches on first call', async () => {
    const cache = new AdapterCache();
    const result = await cache.getOrConnect(baseConfig);
    expect(adapter.connect).toHaveBeenCalledOnce();
    expect(result).toBe(adapter);
  });

  it('returns the same adapter without reconnecting on repeat calls', async () => {
    const cache = new AdapterCache();
    const a1 = await cache.getOrConnect(baseConfig);
    const a2 = await cache.getOrConnect(baseConfig);
    expect(a1).toBe(a2);
    expect(adapter.connect).toHaveBeenCalledOnce();
  });

  it('reconnects when the cached adapter reports disconnected', async () => {
    const cache = new AdapterCache();
    await cache.getOrConnect(baseConfig);

    // Simulate the adapter dropping its connection
    const freshAdapter = makeAdapter(true);
    adapter.isConnected.mockReturnValue(false);
    (createAdapter as ReturnType<typeof vi.fn>).mockReturnValue(freshAdapter);

    await cache.getOrConnect(baseConfig);
    expect(adapter.connect).toHaveBeenCalledOnce();
    expect(freshAdapter.connect).toHaveBeenCalledOnce();
  });

  it('isConnected returns true after caching a connected adapter', async () => {
    const cache = new AdapterCache();
    await cache.getOrConnect(baseConfig);
    expect(cache.isConnected(baseConfig.id)).toBe(true);
  });

  it('isConnected returns false for unknown id', () => {
    const cache = new AdapterCache();
    expect(cache.isConnected('unknown')).toBe(false);
  });

  it('disconnect removes adapter from cache and calls disconnect()', async () => {
    const cache = new AdapterCache();
    await cache.getOrConnect(baseConfig);
    await cache.disconnect(baseConfig.id);
    expect(adapter.disconnect).toHaveBeenCalledOnce();
    expect(cache.get(baseConfig.id)).toBeUndefined();
  });

  it('disconnect is a no-op for unknown id', async () => {
    const cache = new AdapterCache();
    await expect(cache.disconnect('no-such-id')).resolves.not.toThrow();
    expect(adapter.disconnect).not.toHaveBeenCalled();
  });
});
