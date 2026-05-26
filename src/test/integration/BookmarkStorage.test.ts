import { describe, it, expect, beforeEach } from 'vitest';
import { BookmarkStorage } from '../../storage/BookmarkStorage';
import { makeMockContext } from './mockStorage';
import { MAX_BOOKMARKS, MAX_SQL_LENGTH } from '../../constants';

describe('BookmarkStorage', () => {
  let storage: BookmarkStorage;
  const conn = 'conn-1';
  const db   = 'mydb';

  beforeEach(() => {
    storage = new BookmarkStorage(makeMockContext());
  });

  it('starts empty', () => {
    expect(storage.getAll(conn, db)).toEqual([]);
  });

  it('adds a bookmark and returns the list', () => {
    const all = storage.add(conn, db, 'My query', 'SELECT 1');
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('My query');
    expect(all[0].sql).toBe('SELECT 1');
  });

  it('prepends new bookmarks (most-recent first)', () => {
    storage.add(conn, db, 'First',  'SELECT 1');
    const all = storage.add(conn, db, 'Second', 'SELECT 2');
    expect(all[0].name).toBe('Second');
    expect(all[1].name).toBe('First');
  });

  it('truncates SQL longer than MAX_SQL_LENGTH', () => {
    const longSql = 'A'.repeat(MAX_SQL_LENGTH + 100);
    const all = storage.add(conn, db, 'Big', longSql);
    expect(all[0].sql.length).toBe(MAX_SQL_LENGTH);
  });

  it('caps list at MAX_BOOKMARKS', () => {
    for (let i = 0; i < MAX_BOOKMARKS + 5; i++) {
      storage.add(conn, db, `q${i}`, `SELECT ${i}`);
    }
    expect(storage.getAll(conn, db)).toHaveLength(MAX_BOOKMARKS);
  });

  it('deletes a bookmark by id', () => {
    const all = storage.add(conn, db, 'ToDelete', 'SELECT 99');
    const id  = all[0].id;
    const remaining = storage.delete(conn, db, id);
    expect(remaining).toHaveLength(0);
  });

  it('delete is a no-op for unknown id', () => {
    storage.add(conn, db, 'Keep', 'SELECT 1');
    const remaining = storage.delete(conn, db, 'no-such-id');
    expect(remaining).toHaveLength(1);
  });
});
