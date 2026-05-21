import * as vscode from 'vscode';
import { ConnectionConfig } from '../types';

const STORAGE_KEY = 'dbConnection.connections';

export class ConnectionStorage {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getConnections(): ConnectionConfig[] {
    return this.context.globalState.get<ConnectionConfig[]>(STORAGE_KEY, []);
  }

  async saveConnection(config: ConnectionConfig): Promise<void> {
    const connections = this.getConnections();
    const idx = connections.findIndex(c => c.id === config.id);
    if (idx >= 0) {
      connections[idx] = config;
    } else {
      connections.push(config);
    }
    await this.context.globalState.update(STORAGE_KEY, connections);
  }

  async deleteConnection(id: string): Promise<void> {
    const connections = this.getConnections().filter(c => c.id !== id);
    await this.context.globalState.update(STORAGE_KEY, connections);
  }
}
