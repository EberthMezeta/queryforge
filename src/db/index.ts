import { ConnectionConfig } from '../types';
import { IAdapter } from './IAdapter';
import { PostgresAdapter } from './PostgresAdapter';
import { MysqlAdapter } from './MysqlAdapter';
import { SqliteAdapter } from './SqliteAdapter';
import { SqlServerAdapter } from './SqlServerAdapter';
import { OracleAdapter } from './OracleAdapter';
import { MongoAdapter } from './MongoAdapter';
import { RedisAdapter } from './RedisAdapter';
import { GraphQLAdapter } from './GraphQLAdapter';

export function createAdapter(config: ConnectionConfig): IAdapter {
  switch (config.type) {
    case 'postgres': return new PostgresAdapter(config);
    case 'mysql':    return new MysqlAdapter(config);
    case 'sqlite':   return new SqliteAdapter(config);
    case 'mssql':    return new SqlServerAdapter(config);
    case 'oracle':   return new OracleAdapter(config);
    case 'mongodb':  return new MongoAdapter(config);
    case 'redis':    return new RedisAdapter(config);
    case 'graphql':  return new GraphQLAdapter(config);
    default: throw new Error(`Unsupported database type: ${(config as ConnectionConfig).type}`);
  }
}

export { IAdapter };
