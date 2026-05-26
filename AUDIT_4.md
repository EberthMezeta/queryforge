# AUDIT_4 — Senior Software Engineer Review

> Scope: full codebase after AUDIT_3 fixes.  
> Covers: correctness bugs, security, resource leaks, design, clean code.  
> Excluded by request: automated tests.

---

## BUG — Confirmed defects

### BUG-01 · `PostgresAdapter.getSessionClient` has an unguarded race condition
**File:** `src/db/PostgresAdapter.ts:193`

Two async callers for the same `database` both pass the `!sessionClients.get(database)` check before either resolves. Two `Client` instances are created; only the second is stored, the first leaks its TCP connection permanently.

The same pattern was fixed in `ConnectionsProvider.getOrConnect` (a deduplicated Promise Map). Apply the same fix here: a `Map<string, Promise<Client>>` for in-flight connects.

---

### BUG-02 · `MysqlAdapter.activeConn` is corrupted under concurrent usage
**File:** `src/db/MysqlAdapter.ts:9,94`

`activeConn` is an instance field. Two `QueryPanel`s sharing the same MySQL connection (same `config.id`) both call `adapter.query()` and overwrite each other's connection handle. When `cancelQuery()` is called, it destroys the wrong connection — or `null` if the first query already cleared the field. Additionally, `finally { this.activeConn = null }` from the first query nulls the handle while the second is still running.

Fix: remove `activeConn` from instance state. Track the cancellable connection locally inside `query()` and expose it through a closure stored per-call.

---

### BUG-03 · `SqliteAdapter.query` writes to disk on SELECT that returns zero rows
**File:** `src/db/SqliteAdapter.ts:74`

```ts
if (!results.length) {           // zero-result SELECT hits this branch
  const affected = this.db!.getRowsModified();
  if (this.config.filename) {
    await writeFile(this.config.filename, Buffer.from(this.db!.export()));
  }
  return this.dmlResult(affected, duration);
}
```

`results.length === 0` is true for **any query that returns no rows**, not just DML. `SELECT * FROM empty_table` triggers an unnecessary `writeFile`. `getRowsModified()` returns 0, so the DML result is wrong (`rowCount: 0, status: 'Query OK'`) for a SELECT.

Fix: distinguish DML from SELECT by checking `getRowsModified() > 0` or by inspecting the normalized SQL prefix (`/^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)/i`).

---

### BUG-04 · `RedisAdapter` SCAN cursor type mismatch — potential infinite loop
**File:** `src/db/RedisAdapter.ts:53`

```ts
let cursor = '0';          // string
const reply = await this.client!.scan(cursor, { COUNT: 200 });
cursor = reply.cursor;     // redis v4 returns cursor: number
// ...
} while (cursor !== '0'   // number 0 !== string '0' is always true
```

In `redis` v4 the SCAN cursor is `number`. When all keys have been scanned `reply.cursor === 0` (number). The comparison `cursor !== '0'` (string) is always `true` for a number, so the loop never terminates on an empty or small keyspace — it runs until `keys.length >= 500` or hangs if there are fewer keys.

Fix: initialize `cursor = 0` (number), compare `cursor !== 0`.

---

### BUG-05 · `RedisAdapter.select()` changes the shared connection database mid-flight
**File:** `src/db/RedisAdapter.ts:51, 73`

`select(dbNum)` is called in both `getTables` and `query`. Because the adapter is shared across all panels for the same connection, a `query` in one panel calling `select(db:1)` while another panel's `getTables` is about to execute `SCAN` on `db:0` will silently operate on the wrong database.

Fix: create per-operation clients (or use connection pools with isolation) rather than `select()` on a shared client.

---

## SEC — Security issues

### SEC-01 · `GraphQLAdapter.execute` has no request timeout
**File:** `src/db/GraphQLAdapter.ts:99`

`fetch(url, { method: 'POST', ... })` has no `AbortController` timeout. A slow or malicious endpoint stalls the extension indefinitely — the `query()` Promise never resolves, `QueryPanel` stays in loading state, and the panel cannot be cancelled (GraphQL doesn't implement `cancelQuery`).

Fix:
```ts
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30_000);
try {
  const res = await fetch(url, { signal: controller.signal, ... });
} finally {
  clearTimeout(timeout);
}
```

---

### SEC-02 · `SqliteAdapter.buildDefaultQuery` does not escape the table name
**File:** `src/db/SqliteAdapter.ts:34`

```ts
return `SELECT * FROM "${table}" LIMIT 150`;
```

Every other `buildDefaultQuery` and `getColumns` in this file escapes `"` → `""`. Here it doesn't. A table named `foo"bar` produces `SELECT * FROM "foo"bar" LIMIT 150` — a syntax error or injection if the table name originates from a crafted `.db` file.

Fix: `return \`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT 150\``.

---

## MEM — Resource leaks

### MEM-01 · `PostgresAdapter` eviction timer holds a live event-loop reference
**File:** `src/db/PostgresAdapter.ts:32`

```ts
this.evictionTimer = setInterval(() => this.evictStaleClients(), 5 * 60 * 1000);
```

The timer is not `.unref()`'d. When VS Code reloads the extension host (e.g., dev reload), the timer prevents Node.js from exiting cleanly until it fires or the process is killed. `disconnect()` does clear it, but if an adapter is GC'd without an explicit disconnect the timer outlives the adapter.

Fix: add `this.evictionTimer.unref()` immediately after `setInterval(...)`.

---

### MEM-02 · `QueryPanel.loadSchemaAsync` is fire-and-forget — runs after panel disposes
**File:** `src/panels/QueryPanel.ts:143`

```ts
this.loadSchemaAsync(this.database);   // no await, no cancel
```

The Promise is not stored. If the panel is disposed while `getTables` or `getColumns` is in progress, those operations continue consuming adapter resources and then call `this.send(...)` on a disposed webview. VS Code silently drops the message but the I/O work is wasted.

Fix: store the Promise, and in `onDidDispose` set an `aborted` flag checked before each `send` inside `loadSchemaAsync`.

---

### MEM-03 · `OracleAdapter.connect()` sets `poolAlias` before the pool is created
**File:** `src/db/OracleAdapter.ts:19`

```ts
this.poolAlias = `dbconn_${this.config.id}`;   // set first
await oracledb.createPool({ poolAlias: this.poolAlias, ... });  // may throw
this.connected = true;
```

If `createPool()` throws (wrong credentials, unavailable host), `this.poolAlias` is already set but the pool does not exist. A subsequent call to `connect()` tries to register a new pool with the same alias — OracleDB raises `NJS-037: pool alias already in use`. `disconnect()` tries to close a non-existent pool and silently swallows the error, leaving the state permanently broken.

Fix: assign `this.poolAlias` only after `createPool()` resolves:
```ts
const alias = `dbconn_${this.config.id}`;
await oracledb.createPool({ poolAlias: alias, ... });
this.poolAlias = alias;
this.connected = true;
```

---

## DESIGN — Architecture issues

### DES-01 · Audit-trail comments pollute production source
**Files:** `QueryPanel.ts`, `ConnectionsProvider.ts`, `AddConnectionPanel.ts`

Strings like `// BUG-03: cancel in-flight query when panel is closed`, `// DESIGN-02: always resolves adapter fresh`, `// INFO-05: avoid re-fetch on every expand`, `// SEC-01: use cryptographic ID instead of Date.now()` are scattered throughout. These are archaeology notes that belong in git history or commit messages, not in source. Future readers have to decide whether each comment is still accurate.

Remove all `// BUG-*`, `// SEC-*`, `// DESIGN-*`, `// INFO-*` annotation comments.

---

### DES-02 · `cancelQuery` contract is inconsistent across adapters
**File:** `src/db/IAdapter.ts:13`

The optional `cancelQuery?` method has three different semantics depending on the adapter:
- **Postgres**: closes the session client (side-effect: next query creates a new client)
- **MySQL**: destroys the pool connection (affected by BUG-02)
- **SQLite / Oracle / MongoDB / Redis / GraphQL**: not implemented at all

`QueryPanel` guards with `if (this.runningAdapter?.cancelQuery)` but has no guarantee the cancellation is effective. A user clicking "Cancel" on a MongoDB or Oracle query gets no feedback and the query keeps running. The interface should either be mandatory with a no-op default in `BaseAdapter`, or the optional call should surface a warning.

---

### DES-03 · `MssqlConfig.trustServerCertificate` default mismatch between form and adapter
**File:** `src/db/SqlServerAdapter.ts:25` vs `src/panels/AddConnectionPanel.ts:267`

The form pre-checks the "Trust server certificate" checkbox (`checked` attribute). But if that field was never saved (e.g., connection created before the feature existed), `config.trustServerCertificate` is `undefined`, and the adapter defaults to `false` (`?? false`). A user who relied on the visual default of "checked" may find an existing connection suddenly refuses to connect after an extension upgrade, with a confusing TLS error.

Fix: default to `true` in the adapter to match the form default, or — better — make the form explicitly save the checkbox value regardless of its state.

---

### DES-04 · `WebviewMessage` is a flat interface with all fields optional
**File:** `src/panels/QueryPanel.ts:13`

```ts
interface WebviewMessage {
  type: 'ready' | 'runQuery' | 'saveBookmark' | ...;
  sql?: string;
  database?: string;
  table?: string;
  // ...
}
```

All payload fields are optional at the type level, so a `runQuery` message missing `sql` or an `updateCell` message missing `table` are valid TypeScript. The runtime guards (`if (msg.type === 'runQuery' && msg.sql)`) are correct but the type gives false confidence.

Fix: replace with a discriminated union:
```ts
type WebviewMessage =
  | { type: 'ready' }
  | { type: 'runQuery'; sql: string; database?: string }
  | { type: 'updateCell'; table: string; column: string; newValue: string | null; pkValues: Record<string, unknown>; schema?: string }
  | ...
```

---

## CLEAN — Code quality

### CC-01 · `GraphQLAdapter` blanket eslint-disable hides the only real issue
**File:** `src/db/GraphQLAdapter.ts:1`

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
```

The only place `any` appears is the `execute()` return type: `Promise<Record<string, any>>`. Changing it to `Promise<Record<string, unknown>>` removes the need for the disable comment entirely, and makes the rest of the file type-safe again.

---

### CC-02 · `OracleAdapter.buildDefaultQuery` ignores the schema parameter
**File:** `src/db/OracleAdapter.ts:43`

```ts
buildDefaultQuery(table: string, _schema?: string): string {
  return `SELECT * FROM "${OracleAdapter.esc(table)}" FETCH FIRST 150 ROWS ONLY`;
}
```

When a user opens a table from a non-default Oracle schema (e.g., `HR.EMPLOYEES`), the generated query omits the schema prefix and targets the connected user's default schema instead. All other adapters that have multi-schema support (`PostgresAdapter`, `SqlServerAdapter`) include the schema in `buildDefaultQuery`.

Fix:
```ts
buildDefaultQuery(table: string, schema?: string): string {
  const t = `"${OracleAdapter.esc(table)}"`;
  const s = schema ? `"${OracleAdapter.esc(schema)}".` : '';
  return `SELECT * FROM ${s}${t} FETCH FIRST 150 ROWS ONLY`;
}
```

---

### CC-03 · `GraphQLAdapter` calls introspection twice per tree expansion
**File:** `src/db/GraphQLAdapter.ts:37, 49`

`getTables()` and `getColumns()` both execute the full `INTROSPECTION` query independently. Expanding a single GraphQL connection makes two identical HTTP POST requests. Cache the introspection result at instance scope with a short TTL (e.g., 60 s).

---

### CC-04 · `acquireVsCodeApi()` called at module scope in the webview
**File:** `media/webview/main.ts:25`

```ts
const vscode = acquireVsCodeApi();
```

This runs at module evaluation time, before `DOMContentLoaded`. The VS Code webview API is always available before script execution, so this works in practice, but best practice is to acquire it inside `init()` where all other DOM/API setup happens. Consistency with `media/addConnection/main.ts` (which also calls it at module scope but for a shorter-lived panel) is not sufficient justification to keep it at module scope in the main webview.

---

### CC-05 · `BaseAdapter.dmlResult` uses MySQL-centric column names for all adapters
**File:** `src/db/BaseAdapter.ts:10`

```ts
columns: ['affected_rows', 'status'],
rows: [{ affected_rows: affected, status: 'Query OK' }],
```

This text is shown for Postgres `INSERT`, Oracle `UPDATE`, SQLite `DELETE`, etc. "Query OK" is a MySQL phrase. More neutral alternatives: `affected_rows` → `rows_affected`, `status` → `message: 'Done'`.

---

## INFO — Low severity notes

### INFO-01 · `BookmarkStorage` / `HistoryStorage` composite keys are fragile
**File:** `src/storage/BookmarkStorage.ts:17`

The storage key is `dbConnection.bookmarks.${connectionId}.${database}`. `connectionId` is hex (safe), but `database` is a user-supplied name. A database named `foo.bar` and a database named `foo` with sub-key `bar` would produce the same key prefix in theory. In practice this is harmless today since the key is consumed as a whole unit, but it's the kind of assumption that breaks silently if the key format is ever parsed.

---

### INFO-02 · `ConnectionsProvider.tableCache` has no size bound
**File:** `src/tree/ConnectionsProvider.ts:42`

Cache entries accumulate for every `(connectionId, database)` pair opened. With many connections each expanded across many databases, the map grows without an eviction policy beyond `refresh()`. A simple max-entries LRU (e.g., 100 entries) would make the bound explicit.

---

### INFO-03 · `SqliteAdapter` loads the entire DB file into memory
**File:** `src/db/SqliteAdapter.ts:18`

`sql.js` operates entirely in WASM memory. A 500 MB SQLite file is fully loaded into the extension host's heap on `connect()`. This is inherent to the library, but worth documenting in the UI. Consider adding a warning when the file exceeds a threshold (e.g., 100 MB).

---

## Summary table

| ID | Severity | Area | Short description |
|----|----------|------|-------------------|
| BUG-01 | High | PostgresAdapter | Race condition on concurrent `getSessionClient` → leaked TCP connection |
| BUG-02 | High | MysqlAdapter | `activeConn` field shared across concurrent queries → wrong cancel target |
| BUG-03 | High | SqliteAdapter | Zero-row SELECT triggers unnecessary `writeFile` and returns DML result |
| BUG-04 | High | RedisAdapter | Cursor type mismatch `number !== '0'` → infinite SCAN loop |
| BUG-05 | Medium | RedisAdapter | `select()` on shared connection corrupts concurrent operations |
| SEC-01 | Medium | GraphQLAdapter | No fetch timeout → hangs indefinitely on unresponsive endpoint |
| SEC-02 | Medium | SqliteAdapter | `buildDefaultQuery` does not escape `"` in table name |
| MEM-01 | Medium | PostgresAdapter | Eviction timer not `.unref()`'d |
| MEM-02 | Medium | QueryPanel | Schema loading Promise not tracked → runs after panel disposes |
| MEM-03 | Medium | OracleAdapter | `poolAlias` set before pool creation → broken state on connect failure |
| DES-01 | Medium | All | Audit-trail comments (`// BUG-01`, `// DESIGN-02`) left in production code |
| DES-02 | Medium | IAdapter | `cancelQuery` has three incompatible semantics, four adapters don't implement it |
| DES-03 | Low | SqlServerAdapter | `trustServerCertificate` default differs between form (`true`) and adapter (`false`) |
| DES-04 | Low | QueryPanel | `WebviewMessage` flat interface should be a discriminated union |
| CC-01 | Low | GraphQLAdapter | Blanket `eslint-disable` for `any` should be a targeted one-line fix |
| CC-02 | Low | OracleAdapter | `buildDefaultQuery` ignores `schema` parameter |
| CC-03 | Low | GraphQLAdapter | Introspection query fetched twice on every tree expansion |
| CC-04 | Low | webview/main.ts | `acquireVsCodeApi()` at module scope instead of inside `init()` |
| CC-05 | Low | BaseAdapter | `dmlResult` uses MySQL-centric language for all DB types |
| INFO-01 | Info | Storage | Composite keys use `.` separator — fragile if `database` name contains `.` |
| INFO-02 | Info | ConnectionsProvider | `tableCache` has no size bound |
| INFO-03 | Info | SqliteAdapter | Entire DB file loaded into WASM heap — risky for large files |
