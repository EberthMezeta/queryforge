# Code Audit — DB Connection Extension

> Fecha: 2026-05-25  
> Alcance: `src/**/*.ts`, `media/webview/main.ts`  
> Líneas analizadas: ~5 000+

---

## Resumen ejecutivo

El proyecto tiene una arquitectura base sólida (Adapter + Factory + Observer), pero acumula deuda técnica significativa en tres áreas críticas: **complejidad ciclomática alta**, **webview monolítica** y **uso indebido de TypeScript** (`any`, casteos inseguros, ausencia de Discriminated Unions). Las áreas de seguridad también requieren atención urgente.

| Área | Calificación |
|------|-------------|
| Arquitectura general | ★★★★☆ |
| Principios SOLID | ★★★☆☆ |
| TypeScript correctness | ★★☆☆☆ |
| Complejidad ciclomática | ★★☆☆☆ |
| Seguridad | ★★★☆☆ |
| Testabilidad | ★☆☆☆☆ |
| Clean Code | ★★★☆☆ |

---

## 1. Arquitectura actual

### 1.1 Patrones identificados

| Patrón | Ubicación | Estado |
|--------|-----------|--------|
| **Adapter / Strategy** | `src/db/` — 8 implementaciones de `IAdapter` | ✅ Bien aplicado |
| **Factory** | `src/db/index.ts` — `createAdapter()` + `ADAPTER_REGISTRY` | ✅ Bien aplicado |
| **Observer** | `ConnectionsProvider._onDidChangeTreeData` | ✅ Bien aplicado |
| **Registry** | `ADAPTER_REGISTRY` — `Record<DBType, (config) => IAdapter>` | ✅ Bien aplicado |
| **Singleton por clave** | `QueryPanel.panels: Map<string, QueryPanel>` | ✅ Correcto |
| **Template Method** | `BaseAdapter.dmlResult()` | ✅ Correcto |
| **Type Guard** | `isSchemaAdapter()`, `isProcedureAdapter()` | ✅ Correcto |

### 1.2 Flujo de mensajes (WebView ↔ Extension)

```
Webview → { type: 'runQuery', sql, database }
              ↓
QueryPanel.handleMessage()  ← punto crítico (CC = 9)
              ↓
adapter.query(sql, database)
              ↓
Webview ← { type: 'queryResult', columns, rows, rowCount, duration }
```

### 1.3 Jerarquía de interfaces de adaptadores

```
IAdapter
├── connect / disconnect / isConnected
├── getDatabases / getTables / getColumns
├── query / buildDefaultQuery / cancelQuery?
│
ISchemaAdapter extends IAdapter
├── getTableDDL
├── getPrimaryKeys
└── updateCell
│
IProcedureAdapter extends IAdapter
├── getProcedures
└── getProcedureDefinition
```

---

## 2. Principios SOLID

### 2.1 Single Responsibility (SRP)

**Violaciones encontradas:**

#### `QueryPanel.handleMessage()` — 100+ líneas, 11 ramas `if`

```typescript
// PROBLEMA: una función hace todo
async handleMessage(msg: any) {
  if (msg.type === 'ready') { ... }
  if (msg.type === 'cancelQuery') { ... }
  if (msg.type === 'updateCell') { ... }
  if (msg.type === 'clearHistory') { ... }
  if (msg.type === 'runQuery') { ... }
  if (msg.type === 'getTableMeta') { ... }
  if (msg.type === 'deleteRows') { ... }
  if (msg.type === 'deleteRow') { ... }
  if (msg.type === 'insertRow') { ... }
  if (msg.type === 'saveBookmark') { ... }
  if (msg.type === 'deleteBookmark') { ... }
}
```

**Solución recomendada:**

```typescript
// src/panels/handlers/QueryMessageHandlers.ts
type MessageHandler = (msg: WebviewMessage) => Promise<void>;

private readonly handlers: Partial<Record<WebviewMessage['type'], MessageHandler>> = {
  ready:          (msg) => this.handleReady(msg),
  runQuery:       (msg) => this.handleRunQuery(msg),
  saveBookmark:   (msg) => this.handleSaveBookmark(msg),
  deleteBookmark: (msg) => this.handleDeleteBookmark(msg),
  updateCell:     (msg) => this.handleUpdateCell(msg),
  deleteRow:      (msg) => this.handleDeleteRow(msg),
  insertRow:      (msg) => this.handleInsertRow(msg),
  cancelQuery:    (msg) => this.handleCancelQuery(msg),
  clearHistory:   (msg) => this.handleClearHistory(msg),
  getTableMeta:   (msg) => this.handleGetTableMeta(msg),
};

async handleMessage(msg: WebviewMessage): Promise<void> {
  const handler = this.handlers[msg.type];
  if (handler) await handler(msg);
}
```

#### `ConnectionsProvider` — mezcla datos del árbol con gestión del ciclo de vida de adaptadores

La clase combina dos responsabilidades distintas:
- Proveer nodos del TreeView
- Crear, cachear y desconectar adaptadores

**Solución recomendada:** Extraer un `AdapterCache` o `ConnectionManager` que maneje solo el ciclo de vida de los adaptadores.

```typescript
// src/db/AdapterCache.ts
export class AdapterCache {
  private readonly cache = new Map<string, IAdapter>();

  async getOrConnect(config: ConnectionConfig): Promise<IAdapter> {
    const existing = this.cache.get(config.id);
    if (existing?.isConnected()) return existing;
    const adapter = createAdapter(config);
    await adapter.connect();
    this.cache.set(config.id, adapter);
    return adapter;
  }

  async disconnect(id: string): Promise<void> {
    const adapter = this.cache.get(id);
    if (adapter) {
      await adapter.disconnect();
      this.cache.delete(id);
    }
  }
}
```

---

### 2.2 Open/Closed (OCP)

**Estado: ✅ Bien implementado**

Agregar un nuevo motor de base de datos requiere únicamente:
1. Crear `src/db/NewAdapter.ts` implementando `IAdapter`
2. Registrarlo en `ADAPTER_REGISTRY`

No se modifica ningún consumidor existente.

---

### 2.3 Liskov Substitution (LSP)

**Violación en `cancelQuery()`:**

```typescript
// IAdapter — método opcional, comportamientos divergentes
interface IAdapter {
  cancelQuery?(database?: string): Promise<void>;  // ← opcional en interfaz
}

// MysqlAdapter — ignora el parámetro
async cancelQuery(): Promise<void> {
  this.activeConn?.destroy();
  this.activeConn = null;
}

// PostgresAdapter — usa el parámetro
async cancelQuery(database?: string): Promise<void> {
  const db = database ?? this.config.database ?? 'postgres';
  const client = this.sessionClients.get(db);
  await client?.end().catch(() => {});
  this.sessionClients.delete(db);
}
```

**Problema:** el contrato del método no es uniforme entre implementaciones. Un consumidor que llama `adapter.cancelQuery('mydb')` obtiene resultados distintos según el adaptador concreto, violando LSP.

**Solución:**

```typescript
interface IAdapter {
  cancelQuery(database?: string): Promise<void>;  // obligatorio, firma unificada
}

// Adapters que no soportan cancelación:
async cancelQuery(_database?: string): Promise<void> {
  // no-op explícito — el contrato se cumple
}
```

---

### 2.4 Interface Segregation (ISP)

**Estado: ✅ Bien implementado**

`ISchemaAdapter` e `IProcedureAdapter` permiten que MongoDB y Redis implementen solo `IAdapter` sin stubs vacíos. Los type guards (`isSchemaAdapter`, `isProcedureAdapter`) son el mecanismo correcto de narrowing en tiempo de ejecución.

---

### 2.5 Dependency Inversion (DIP)

**Estado: ✅ Bueno — mejora posible en testabilidad**

Los paneles dependen de `IAdapter`, no de adaptadores concretos. La factory abstrae la creación. Sin embargo, la factory se llama directamente desde los paneles sin inyección, lo que impide el testing:

```typescript
// PROBLEMA: instanciación acoplada a implementación concreta
const adapter = createAdapter(config);  // difícil de mockear en tests

// SOLUCIÓN: inyectar la factory
constructor(
  private readonly adapterFactory: IAdapterFactory,
) {}

// En tests:
new QueryPanel({ create: () => mockAdapter });
```

---

## 3. Complejidad Ciclomática

### Hotspots identificados

| Función | Complejidad estimada | Umbral sugerido |
|---------|---------------------|-----------------|
| `QueryPanel.handleMessage()` | **CC ≈ 11** | ≤ 5 |
| `ConnectionsProvider.getChildren()` | **CC ≈ 8** | ≤ 5 |
| `media/webview/main.ts` (total) | **CC > 50** | — |
| `media/webview/main.ts:init()` | **CC ≈ 12** | ≤ 8 |
| Adaptadores individuales `.query()` | CC ≈ 3–5 | ≤ 8 ✅ |

### `ConnectionsProvider.getChildren()` — Refactoring sugerido

```typescript
// PROBLEMA: if-chain con instanceof
getChildren(element?: AnyItem): AnyItem[] {
  if (!element) return this.getRootConnections();
  if (element instanceof ConnectionItem) return this.getDatabasesFor(element);
  if (element instanceof DatabaseItem) return this.getSchemasOrFolders(element);
  if (element instanceof SchemaItem) return this.getFoldersFor(element);
  if (element instanceof FolderItem) return this.getTablesFor(element);
  if (element instanceof TableItem) return this.getColumnsFor(element);
  return [];
}

// SOLUCIÓN: Visitor o polimorfismo por tipo
private childResolvers = new Map<Function, (item: AnyItem) => Promise<AnyItem[]>>([
  [ConnectionItem, (item) => this.getDatabasesFor(item as ConnectionItem)],
  [DatabaseItem,   (item) => this.getSchemasOrFolders(item as DatabaseItem)],
  [SchemaItem,     (item) => this.getFoldersFor(item as SchemaItem)],
  [FolderItem,     (item) => this.getTablesFor(item as FolderItem)],
  [TableItem,      (item) => this.getColumnsFor(item as TableItem)],
]);

async getChildren(element?: AnyItem): Promise<AnyItem[]> {
  if (!element) return this.getRootConnections();
  const resolver = this.childResolvers.get(element.constructor);
  return resolver ? resolver(element) : [];
}
```

### `media/webview/main.ts` — Monolito (1 012 líneas)

Responsabilidades actuales mezcladas en un solo archivo:

- Ejecución de queries
- Edición de celdas inline
- Paginación y filtrado
- Exportación (CSV, JSON, Excel, PDF)
- Bookmarks y historial
- Autocompletado de esquema (CodeMirror)

**Estructura modular propuesta:**

```
media/webview/
├── main.ts              — init, registro de eventos, bootstrapping
├── query-executor.ts    — runQuery, confirmDML, cancelQuery
├── cell-editor.ts       — startCellEdit, commitCellEdit, revertCellEdit
├── table-renderer.ts    — renderResults, renderRow, pagination
├── export.ts            — exportCSV, exportJSON, exportExcel, exportPDF
├── bookmarks.ts         — toggleBookmarksPanel, renderBookmarks
├── history.ts           — navigateHistory, updateHistoryUI
└── ui-helpers.ts        — show, hide, copyText, download
```

---

## 4. TypeScript — Uso correcto

### 4.1 Tipos `any` — escapadas del sistema de tipos

```typescript
// src/db/OracleAdapter.ts — PROBLEMA
let _oracledb: any;
private conn: any = null;

// SOLUCIÓN
import type oracledb from 'oracledb';
let _oracledb: typeof oracledb | null = null;
private conn: oracledb.Connection | null = null;
```

```typescript
// src/db/GraphQLAdapter.ts — PROBLEMA
private async execute(query: string): Promise<Record<string, any>>

// SOLUCIÓN
interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
}
private async execute<T = unknown>(query: string): Promise<GraphQLResponse<T>>
```

### 4.2 Discriminated Unions para mensajes WebView

```typescript
// PROBLEMA: tipo suelto sin garantías en tiempo de compilación
async handleMessage(msg: any) { ... }

// SOLUCIÓN: union discriminada
type WebviewMessage =
  | { type: 'ready' }
  | { type: 'runQuery';       sql: string; database: string }
  | { type: 'saveBookmark';   name: string; sql: string }
  | { type: 'deleteBookmark'; id: string }
  | { type: 'updateCell';     table: string; pk: Record<string, unknown>; column: string; value: unknown }
  | { type: 'deleteRow';      table: string; pk: Record<string, unknown> }
  | { type: 'insertRow';      table: string; values: Record<string, unknown> }
  | { type: 'cancelQuery';    database: string }
  | { type: 'clearHistory' }
  | { type: 'getTableMeta';   table: string };

// El compilador rechaza propiedades inválidas y garantiza exhaustividad
async handleMessage(msg: WebviewMessage): Promise<void> { ... }
```

### 4.3 Casteos inseguros con `as`

```typescript
// PROBLEMA: SqlServerAdapter
return result.recordset.map((r) => ({
  name: r.name as string,           // ❌ no valida
  type: (r.type as string).trim(),  // ❌ puede fallar si r.type es null
  nullable: (r.nullable as string) === 'YES',
}));

// SOLUCIÓN
function isColumnRow(r: unknown): r is { name: string; type: string; nullable: string } {
  return (
    typeof r === 'object' && r !== null &&
    typeof (r as Record<string, unknown>).name === 'string' &&
    typeof (r as Record<string, unknown>).type === 'string'
  );
}

return result.recordset.map((r) => {
  if (!isColumnRow(r)) throw new Error(`Invalid column row: ${JSON.stringify(r)}`);
  return { name: r.name, type: r.type.trim(), nullable: r.nullable === 'YES' };
});
```

### 4.4 Narrowing de errores en `catch`

```typescript
// PROBLEMA: catch sin narrowing
} catch (err) {
  vscode.window.showErrorMessage(err.message);  // TS error: 'err' is unknown
}

// PATRÓN CORRECTO ya en uso en extension.ts — extender a toda la base de código
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  vscode.window.showErrorMessage(message);
}
```

---

## 5. Seguridad

### 5.1 SQL Injection — Riesgo medio

Algunos adaptadores construyen SQL por concatenación con escape manual:

```typescript
// src/db/SqliteAdapter.ts
const result = this.db!.exec(
  `SELECT sql FROM sqlite_master WHERE name = '${table.replace(/'/g, "''")}'`
);

// src/db/SqlServerAdapter.ts
WHERE TABLE_SCHEMA = '${schema.replace(/'/g, "''")}' AND TABLE_NAME = '${table.replace(/'/g, "''")}'
```

El escape manual es propenso a errores (caracteres Unicode, encodings especiales).

**Solución:** usar queries parametrizadas en todos los adaptadores de metadatos:

```typescript
// PostgreSQL ya hace esto correctamente — modelo a seguir
const result = await client.query(
  `SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_schema = $1 AND table_name = $2`,
  [schema, table],
);
```

### 5.2 Secretos — Estado actual aceptable

```typescript
// ✅ Correcto: OS-level SecretStorage
await this.context.secrets.store(`dbConnection.secret.${config.id}`, password);
```

**Riesgo menor:** el código de migración de legado puede dejar contraseñas en `globalState` brevemente. Asegurarse de que `cleanupLegacyPasswords()` sea llamado y complete antes de cualquier lectura de `globalState`.

### 5.3 Validación de queries GraphQL

```typescript
// src/db/GraphQLAdapter.ts
async query(graphqlQuery: string): Promise<QueryResult> {
  const response = await this.execute(graphqlQuery);  // ← sin validación
```

Queries malformadas pueden causar errores de red o exponer el esquema completo vía introspección.

**Solución:**

```typescript
import { parse, validate, buildClientSchema } from 'graphql';

async query(graphqlQuery: string): Promise<QueryResult> {
  const doc = parse(graphqlQuery);  // lanza si sintaxis inválida
  // opcionalmente validar contra schema cacheado
  const response = await this.execute(graphqlQuery);
  // ...
}
```

---

## 6. Manejo de errores

### Inconsistencias detectadas

```typescript
// Patrón 1: throw directo (src/db/SqliteAdapter.ts)
if (!this.config.filename) throw new Error('SQLite filename is required');

// Patrón 2: catch silencioso (src/panels/QueryPanel.ts)
try {
  columnDefs = await this.adapter.getColumns(database, tableName, schema);
} catch { }  // ← borra el error silenciosamente

// Patrón 3: catch con log parcial
} catch (err: unknown) {
  vscode.window.showErrorMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
}
```

**Regla unificada sugerida:**

1. Errores de configuración → `throw new Error(message)` inmediato
2. Errores recuperables (carga de esquema) → loggear + estado degradado explícito
3. Errores de usuario (query inválida) → `postMessage({ type: 'queryError', message })`
4. Errores fatales del adaptador → `throw`, dejar que el caller decida

---

## 7. Rendimiento

### 7.1 Paginación en memoria (riesgo alto con datasets grandes)

```typescript
// media/webview/main.ts — todos los rows se cargan en memoria
let currentData: Row[] = [];

function renderResults(columns: string[], rows: Row[]) {
  currentData = rows;  // ← dataset completo en RAM del webview
  renderPage();        // pagina solo en UI
}
```

Esto significa que una query con 500 000 filas congela el webview aunque solo se muestre la primera página.

**Solución recomendada:** paginación server-side con `LIMIT`/`OFFSET` o cursor:

```typescript
// QueryPanel envía mensajes paginados
async handleRunQuery(msg: RunQueryMessage): Promise<void> {
  const result = await this.adapter.query(msg.sql, msg.database, {
    limit: PAGE_SIZE,
    offset: msg.page * PAGE_SIZE,
  });
  this.panel.webview.postMessage({ type: 'queryResult', ...result, hasMore: result.rowCount === PAGE_SIZE });
}
```

### 7.2 Conexiones PostgreSQL

PostgreSQL crea un cliente por base de datos, lo que puede agotar el pool del servidor con muchas bases de datos abiertas. Considerar un límite global de conexiones o reusar la misma sesión cambiando `SET search_path`.

---

## 8. Testabilidad

**Estado actual: sin tests**

### Problemas estructurales

1. **Acoplamiento duro a VS Code API** — `ConnectionStorage`, `BookmarkStorage` reciben `vscode.ExtensionContext` directamente.
2. **Webview DOM-dependiente** — `media/webview/main.ts` manipula el DOM directamente, imposible de testear sin jsdom.
3. **Adaptadores no mockeables** — la factory llama `new PostgresAdapter(config)` internamente.

### Plan de testabilidad

```typescript
// 1. Interfaz de contexto simplificada
interface IStorageContext {
  globalState: { get<T>(key: string): T | undefined; update(key: string, value: unknown): Thenable<void> };
  secrets: { get(key: string): Thenable<string | undefined>; store(key: string, value: string): Thenable<void> };
}

// 2. Factory inyectable
interface IAdapterFactory {
  create(config: ConnectionConfig): IAdapter;
}

// 3. Lógica webview en clases puras
export class QueryResultState {
  private data: Row[] = [];
  private page = 0;
  private filter = '';

  setData(rows: Row[]): void { this.data = rows; this.page = 0; }
  getPage(): Row[] { /* pure */ }
  setFilter(f: string): void { /* pure */ }
}
// → completamente testeable sin DOM
```

---

## 9. Clean Code — Hallazgos menores

| Issue | Ubicación | Prioridad |
|-------|-----------|-----------|
| Funciones > 60 líneas | `handleMessage`, `getChildren`, `init` | Alta |
| Variables globales mutables | `media/webview/main.ts` — 15+ globals | Alta |
| Magic numbers sin nombre | `LIMIT 150`, `50`, `100` dispersos | Media |
| Sin JSDoc en métodos públicos | Toda la base de código | Baja |
| Comentarios que describen el qué | Varios adaptadores | Baja |

```typescript
// PROBLEMA: magic numbers
const PAGE_SIZE = 50;  // definido, pero otros valores no

// Ejemplo de valor hardcodeado sin nombre
`SELECT * FROM ${table} LIMIT 150`  // ← ¿150 por qué?

// SOLUCIÓN: consolidar en src/constants.ts
export const DEFAULT_PREVIEW_LIMIT = 150;
export const MAX_BOOKMARKS_PER_DB = 100;
export const MAX_HISTORY_PER_DB = 50;
export const SCHEMA_CONCURRENCY = 8;
```

---

## 10. Roadmap de mejoras priorizadas

### Prioridad Alta (deuda técnica crítica)

- [ ] **Refactorizar `handleMessage()`** en mapa de handlers tipados con Discriminated Union (`src/panels/QueryPanel.ts`)
- [ ] **Modularizar `media/webview/main.ts`** — extraer al menos `export.ts`, `cell-editor.ts`, `query-executor.ts`
- [ ] **Eliminar `any`** en `OracleAdapter` y `GraphQLAdapter` — usar tipos del paquete o genéricos
- [ ] **Queries parametrizadas** en SQLite y SQL Server para metadata (security fix)

### Prioridad Media (calidad de código)

- [ ] **Extraer `AdapterCache`** de `ConnectionsProvider` (SRP)
- [ ] **Discriminated Union para `WebviewMessage`** — `src/types.ts`
- [ ] **Normalizar manejo de errores** — eliminar catches silenciosos
- [ ] **Corregir LSP** en `cancelQuery()` — hacerlo obligatorio con firma uniforme
- [ ] **Consolidar magic numbers** en `src/constants.ts`

### Prioridad Baja (mejora continua)

- [ ] **Paginación server-side** con `LIMIT`/`OFFSET` en `QueryPanel`
- [ ] **Inyección de dependencias** en paneles y storage para testabilidad
- [ ] **Tests unitarios** para adaptadores (con mock de drivers de BD)
- [ ] **Tests de integración** para `ConnectionStorage` y `BookmarkStorage`
- [ ] **Validación GraphQL** con `graphql-core`

---

## Apéndice — Fortalezas del proyecto

Antes de las mejoras, vale reconocer lo que ya está bien:

1. ✅ **Patrón Adapter limpio** — agregar un motor nuevo es < 150 líneas
2. ✅ **ISP aplicado** — `ISchemaAdapter` / `IProcedureAdapter` no fuerzan stubs en MongoDB/Redis
3. ✅ **SecretStorage** — contraseñas fuera de globalState, en almacenamiento seguro del OS
4. ✅ **`QueryResult` uniforme** — todos los adaptadores normalizan al mismo formato
5. ✅ **Type Guards** — `isSchemaAdapter()` / `isProcedureAdapter()` son el patrón correcto
6. ✅ **`strict: true`** en tsconfig — la base es correcta, la disciplina falta en los detalles
7. ✅ **Concurrencia limitada** en carga de esquemas (`SCHEMA_CONCURRENCY = 8`)
