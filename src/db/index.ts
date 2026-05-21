import { ConnectionConfig, DbType } from '../types';
import { IAdapter } from './IAdapter';
import { PostgresAdapter } from './PostgresAdapter';
import { MysqlAdapter } from './MysqlAdapter';
import { SqliteAdapter } from './SqliteAdapter';
import { SqlServerAdapter } from './SqlServerAdapter';
import { OracleAdapter } from './OracleAdapter';
import { MongoAdapter } from './MongoAdapter';
import { RedisAdapter } from './RedisAdapter';
import { GraphQLAdapter } from './GraphQLAdapter';

type AdapterFactory = (config: ConnectionConfig) => IAdapter;

const ADAPTER_REGISTRY: Record<DbType, AdapterFactory> = {
  postgres: (c) => new PostgresAdapter(c),
  mysql:    (c) => new MysqlAdapter(c),
  sqlite:   (c) => new SqliteAdapter(c),
  mssql:    (c) => new SqlServerAdapter(c),
  oracle:   (c) => new OracleAdapter(c),
  mongodb:  (c) => new MongoAdapter(c),
  redis:    (c) => new RedisAdapter(c),
  graphql:  (c) => new GraphQLAdapter(c),
};

export function createAdapter(config: ConnectionConfig): IAdapter {
  const factory = ADAPTER_REGISTRY[config.type];
  if (!factory) throw new Error(`Unsupported database type: ${config.type}`);
  return factory(config);
}

export { IAdapter };
export { isSchemaAdapter, isProcedureAdapter } from './IAdapter';
