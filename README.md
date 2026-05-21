# DB Connection

A Visual Studio Code extension that provides a unified interface for browsing and querying multiple database engines directly from the editor.

---

## Supported Databases

| Engine | Type |
|---|---|
| PostgreSQL | Relational |
| MySQL / MariaDB | Relational |
| SQLite | Relational (file-based) |
| SQL Server (MSSQL) | Relational |
| Oracle | Relational |
| MongoDB | Document |
| Redis | Key-Value |
| GraphQL | API |

---

## Features

### Connection Management

- **Add connections** via a guided form — name, host, port, credentials, database, and type
- **Test connection** before saving to verify credentials are correct
- **Auto-reconnect** on startup — all saved connections are restored automatically when VS Code opens
- **Disconnect / reconnect** on demand from the tree view
- **Delete connections** with a confirmation prompt to prevent accidents
- Connection state (connected / disconnected) is reflected in the tree view icon

### Database Explorer (Tree View)

The sidebar panel organizes objects in a collapsible tree:

```
Connection
└── Database
    ├── Tables
    │   ├── table_name
    │   │   ├── column_name  (type)
    │   │   └── ...
    │   └── ...
    ├── Views
    │   └── ...
    └── Stored Procedures / Functions
        └── ...
```

For databases with multiple schemas (PostgreSQL, SQL Server), objects are grouped by schema before being split into Tables / Views / Procedures folders:

```
Connection
└── Database
    ├── public
    │   ├── Tables
    │   └── Views
    └── reporting
        ├── Tables
        └── Views
```

### Query Editor

- Powered by **CodeMirror 6** with SQL syntax highlighting and the One Dark theme
- **SQL autocomplete** — tables and columns from the current database populate the autocomplete list automatically after connecting
- **Keyword uppercasing** — SQL keywords are suggested in uppercase
- **Run query** with `Ctrl+Enter` (or `Cmd+Enter` on macOS) or the Run button
- **Cancel** long-running queries mid-execution without disconnecting
- **LIMIT control** — set the row limit directly from the toolbar before running
- Opening a table pre-fills the editor with a default `SELECT` query and runs it immediately
- Opening a stored procedure or function loads its full definition into the editor

### Results Table

- Paginated display — 100 rows per page with previous/next controls
- **Live filter** — type in the filter box to search across all columns in real time; the row counter shows `filtered / total`
- Column headers are sticky while scrolling vertically
- `NULL` values are displayed with distinct italic styling to distinguish them from empty strings
- Rows show their primary-key values internally for cell editing purposes

### Inline Cell Editing

For tables with a primary key, non-PK columns are editable directly in the results table:

1. Click a cell to enter edit mode
2. Type the new value (leave empty to set `NULL`)
3. Press `Ctrl+S` or click `✓` to save, `Esc` to cancel
4. The change is committed to the database immediately; all open panels showing the same table reload automatically

### DDL Viewer

Right-click any table or view in the tree and select **View DDL** to open its `CREATE` statement in the query editor.

Supported on: PostgreSQL, MySQL, SQLite, SQL Server, Oracle.

### Export Results

From the results bar, export the current (filtered) result set as:

| Format | Notes |
|---|---|
| **CSV** | Standard comma-separated, quoted where needed |
| **JSON** | Pretty-printed array of objects |
| **PDF** | Landscape-oriented table via jsPDF AutoTable |

### Export Query

From the toolbar, export the current query in the editor as:

| Format | Notes |
|---|---|
| **.sql** | Plain SQL file |
| **.txt** | Plain text |
| **.md** | Fenced code block (` ```sql `) |
| **PDF** | Monospaced, A4, text-wrapped |

### Bookmarks

Save frequently-used queries for each connection + database combination:

- Click **Save** (⭐) to name and store the current query
- The **bookmarks panel** (☰) lists all saved queries with options to:
  - Load the query into the editor
  - Copy the SQL to clipboard (📋)
  - Export the query file (📤)
  - Delete the bookmark (✕)
- Bookmarks are persisted across VS Code sessions and scoped per connection + database

### Query History

Every executed query is automatically recorded per connection + database:

- Open the **history panel** (⏱) to browse recent queries
- Click any entry to reload it into the editor
- Navigate history directly from the keyboard: `Alt+↑` / `Alt+↓`
- **Clear history** button removes all entries for the current database
- History is persisted across sessions

---

## Requirements

- Visual Studio Code `^1.85.0`
- Node.js (for building from source)
- Database drivers are bundled — no separate client installation needed

---

## Installation (from source)

```bash
git clone <repo-url>
cd db_connection
npm install
npm run build
```

Then open the folder in VS Code and press `F5` to launch the Extension Development Host.

To produce a `.vsix` package:

```bash
npx vsce package
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` / `Cmd+Enter` | Run query |
| `Alt+↑` | Navigate to older history entry |
| `Alt+↓` | Navigate to newer history entry |
| `Ctrl+S` (in cell edit) | Commit cell value |
| `Esc` (in cell edit) | Cancel cell edit |

---

## Architecture Overview

```
src/
├── db/
│   ├── BaseAdapter.ts        # Shared helpers (assertConnected, dmlResult)
│   ├── IAdapter.ts           # IAdapter / ISchemaAdapter / IProcedureAdapter interfaces
│   ├── index.ts              # Adapter registry + createAdapter factory
│   ├── PostgresAdapter.ts
│   ├── MysqlAdapter.ts
│   ├── SqliteAdapter.ts
│   ├── SqlServerAdapter.ts
│   ├── OracleAdapter.ts
│   ├── MongoAdapter.ts
│   ├── RedisAdapter.ts
│   └── GraphQLAdapter.ts
├── panels/
│   ├── QueryPanel.ts         # WebviewPanel host + message bridge
│   ├── QueryPanelHtml.ts     # HTML template
│   ├── QueryPanelCss.ts      # Embedded stylesheet
│   └── AddConnectionPanel.ts
├── tree/
│   ├── ConnectionsProvider.ts  # TreeDataProvider
│   └── TreeItems.ts            # TreeItem subclasses
├── storage/
│   ├── ConnectionStorage.ts
│   ├── BookmarkStorage.ts
│   └── HistoryStorage.ts
├── types.ts
└── extension.ts
media/webview/
└── main.ts                   # Webview UI (CodeMirror + DOM logic)
```

Adding a new database type requires only:

1. Create `src/db/YourAdapter.ts` extending `BaseAdapter`
2. Add one entry to `ADAPTER_REGISTRY` in `src/db/index.ts`
3. Add the npm driver dependency
