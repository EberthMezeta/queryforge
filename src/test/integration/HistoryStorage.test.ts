import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryStorage } from '../../storage/HistoryStorage';
import { makeMockContext } from './mockStorage';
import { MAX_HISTORY } from '../../constants';

describe('HistoryStorage', () => {
  let storage: HistoryStorage;
  const conn = 'conn-1';
  const db   = 'mydb';

  beforeEach(() => {
    storage = new HistoryStorage(makeMockContext());
  });

  it('starts empty', () => {
    expect(storage.getAll(conn, db)).toEqual([]);
  });

  it('pushes an entry and returns it at the front', () => {
    const all = storage.push(conn, db, 'SELECT 1');
    expect(all).toHaveLength(1);
    expect(all[0].sql).toBe('SELECT 1');
  });

  it('deduplicates: re-pushing an existing query moves it to front', () => {
    storage.push(conn, db, 'SELECT 1');
    storage.push(conn, db, 'SELECT 2');
    const all = storage.push(conn, db, 'SELECT 1');
    expect(all[0].sql).toBe('SELECT 1');
    expect(all).toHaveLength(2); // not 3
  });

  it('caps list at MAX_HISTORY', () => {
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      storage.push(conn, db, `SELECT ${i}`);
    }
    expect(storage.getAll(conn, db)).toHaveLength(MAX_HISTORY);
  });

  it('clear removes all entries', () => {
    storage.push(conn, db, 'SELECT 1');
    storage.push(conn, db, 'SELECT 2');
    storage.clear(conn, db);
    expect(storage.getAll(conn, db)).toHaveLength(0);
  });

  it('stores entries for different databases independently', () => {
    storage.push(conn, 'db1', 'SELECT A');
    storage.push(conn, 'db2', 'SELECT B');
    expect(storage.getAll(conn, 'db1')).toHaveLength(1);
    expect(storage.getAll(conn, 'db2')).toHaveLength(1);
    expect(storage.getAll(conn, 'db1')[0].sql).toBe('SELECT A');
  });
});
