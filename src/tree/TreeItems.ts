import * as vscode from 'vscode';
import { ConnectionConfig, TableInfo, ColumnInfo } from '../types';
import { IAdapter } from '../db/IAdapter';

export class ConnectionItem extends vscode.TreeItem {
  contextValue = 'connection';

  constructor(
    public readonly config: ConnectionConfig,
    public readonly connected: boolean = false,
  ) {
    super(config.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = connected ? config.type : `${config.type} · disconnected`;
    this.tooltip = connected
      ? `${config.type.toUpperCase()} · ${config.host || config.filename}`
      : 'Click to expand and connect';
    this.iconPath = new vscode.ThemeIcon(
      'database',
      new vscode.ThemeColor(connected ? 'charts.green' : 'foreground'),
    );
    if (connected) {
      this.contextValue = 'connection-connected';
    }
  }
}

export class DatabaseItem extends vscode.TreeItem {
  contextValue = 'database';

  constructor(
    public readonly database: string,
    public readonly config: ConnectionConfig,
    public readonly adapter: IAdapter,
  ) {
    super(database, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('database');
    this.tooltip = database;
  }
}

export class FolderItem extends vscode.TreeItem {
  contextValue = 'folder';

  constructor(
    label: string,
    public readonly tables: TableInfo[],
    public readonly database: string,
    public readonly config: ConnectionConfig,
    public readonly adapter: IAdapter,
    icon: string,
  ) {
    super(`${label} (${tables.length})`, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

export class TableItem extends vscode.TreeItem {
  constructor(
    public readonly table: string,
    public readonly tableType: 'table' | 'view',
    public readonly database: string,
    public readonly config: ConnectionConfig,
    public readonly adapter: IAdapter,
  ) {
    super(table, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = tableType;
    this.iconPath = new vscode.ThemeIcon(tableType === 'view' ? 'eye' : 'table');
    this.tooltip = `${tableType}: ${database}.${table}`;
    this.command = {
      command: 'dbConnection.openTable',
      title: 'Open Table',
      arguments: [this],
    };
  }
}

export class ColumnItem extends vscode.TreeItem {
  contextValue = 'column';

  constructor(public readonly column: ColumnInfo) {
    super(column.name, vscode.TreeItemCollapsibleState.None);
    this.description = `${column.type}${column.nullable ? '' : ' NOT NULL'}`;
    this.iconPath = new vscode.ThemeIcon('symbol-field');
    this.tooltip = `${column.name}: ${column.type}${column.nullable ? ' (nullable)' : ''}`;
  }
}

export class ErrorItem extends vscode.TreeItem {
  contextValue = 'error';

  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
    this.tooltip = message;
  }
}
