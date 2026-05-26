import { describe, it, expect } from 'vitest';
import { PostgresAdapter }   from '../../db/PostgresAdapter';
import { MysqlAdapter }      from '../../db/MysqlAdapter';
import { SqlServerAdapter }  from '../../db/SqlServerAdapter';
import { SqliteAdapter }     from '../../db/SqliteAdapter';
import { OracleAdapter }     from '../../db/OracleAdapter';
import { MongoAdapter }      from '../../db/MongoAdapter';
import { DEFAULT_PREVIEW_LIMIT } from '../../constants';

const N = DEFAULT_PREVIEW_LIMIT; // 150

describe('buildDefaultQuery', () => {
  describe('PostgresAdapter', () => {
    const adapter = new PostgresAdapter({} as any);

    it('uses schema when provided', () => {
      expect(adapter.buildDefaultQuery('users', 'public'))
        .toBe(`SELECT * FROM "public"."users" LIMIT ${N}`);
    });

    it('omits schema when not provided', () => {
      expect(adapter.buildDefaultQuery('orders'))
        .toBe(`SELECT * FROM "orders" LIMIT ${N}`);
    });
  });

  describe('MysqlAdapter', () => {
    const adapter = new MysqlAdapter({} as any);

    it('backtick-quotes the table name', () => {
      expect(adapter.buildDefaultQuery('products'))
        .toBe(`SELECT * FROM \`products\` LIMIT ${N}`);
    });
  });

  describe('SqlServerAdapter', () => {
    const adapter = new SqlServerAdapter({} as any);

    it('uses TOP syntax with schema', () => {
      expect(adapter.buildDefaultQuery('Employees', 'dbo'))
        .toBe(`SELECT TOP ${N} * FROM [dbo].[Employees]`);
    });

    it('omits schema when not provided', () => {
      expect(adapter.buildDefaultQuery('Employees'))
        .toBe(`SELECT TOP ${N} * FROM [Employees]`);
    });
  });

  describe('SqliteAdapter', () => {
    const adapter = new SqliteAdapter({} as any);

    it('double-quotes the table name', () => {
      expect(adapter.buildDefaultQuery('logs'))
        .toBe(`SELECT * FROM "logs" LIMIT ${N}`);
    });
  });

  describe('OracleAdapter', () => {
    const adapter = new OracleAdapter({} as any);

    it('uses FETCH FIRST syntax', () => {
      expect(adapter.buildDefaultQuery('ACCOUNTS'))
        .toBe(`SELECT * FROM "ACCOUNTS" FETCH FIRST ${N} ROWS ONLY`);
    });
  });

  describe('MongoAdapter', () => {
    const adapter = new MongoAdapter({} as any);

    it('produces shell find syntax', () => {
      expect(adapter.buildDefaultQuery('events'))
        .toBe(`db.events.find({}).limit(${N})`);
    });
  });
});
