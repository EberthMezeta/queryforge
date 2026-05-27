# Changelog

All notable changes to QueryForge will be documented in this file.

## [0.1.0] — 2026-05-27

### Added

- **Connection management** — add, edit, delete, test, connect and disconnect from the activity bar tree view
- **Auto-reconnect** — saved connections are restored automatically on VS Code startup
- **Database explorer** — browse databases, schemas, tables, views, columns, stored procedures and functions
- **Query editor** — powered by CodeMirror 6 with SQL syntax highlighting, One Dark theme, and autocomplete from schema
- **Run query** (`Ctrl+Enter` / `Cmd+Enter`) with cancel support for long-running queries
- **Safety confirmation** for destructive statements (`DELETE`, `TRUNCATE`, `DROP`, `UPDATE`)
- **Paginated results** — 100 rows per page with live filter across all columns
- **Inline cell editing** — click any non-PK cell to edit and commit directly to the database
- **DDL viewer** — open the `CREATE` statement for any table or view
- **Export results** — CSV, JSON, and PDF (landscape, via jsPDF AutoTable)
- **Export query** — save the current query as `.sql`, `.txt`, `.md`, or PDF
- **Bookmarks** — save, load, copy, export and delete named queries per connection + database
- **Query history** — automatic per-database history with keyboard navigation (`Alt+↑` / `Alt+↓`)
- **Supported engines** — PostgreSQL, MySQL / MariaDB, SQLite, SQL Server, Oracle, MongoDB, Redis, GraphQL
- Passwords stored securely via VS Code SecretStorage (OS keychain)
- Webview Content Security Policy with per-panel nonces
