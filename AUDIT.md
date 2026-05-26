# Auditoría de Código — DB Connection Extension

> **Fecha:** 2026-05-22  
> **Auditor:** Claude Sonnet 4.6 (análisis estático automatizado)  
> **Versión analizada:** branch `main` (commit `d1fd302`)  
> **Alcance:** Todo el código fuente TypeScript bajo `src/` y `media/webview/`

---

## Índice

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Vista General de la Arquitectura](#2-vista-general-de-la-arquitectura)
3. [Hallazgos de Seguridad — CRÍTICOS](#3-hallazgos-de-seguridad--críticos)
4. [Hallazgos de Seguridad — ALTOS](#4-hallazgos-de-seguridad--altos)
5. [Hallazgos de Seguridad — MEDIOS](#5-hallazgos-de-seguridad--medios)
6. [Memory Leaks y Gestión de Recursos](#6-memory-leaks-y-gestión-de-recursos)
7. [Bugs Funcionales](#7-bugs-funcionales)
8. [Mantenibilidad y Calidad de Código](#8-mantenibilidad-y-calidad-de-código)
9. [Escalabilidad](#9-escalabilidad)
10. [UI / UX](#10-ui--ux)
11. [Plan de Remediación Priorizado](#11-plan-de-remediación-priorizado)

---

## 1. Resumen Ejecutivo

La extensión es **sólida en arquitectura** — patrón adaptador bien aplicado, IPC bien diseñado entre el host y la webview, y buena separación de responsabilidades. Sin embargo, presenta **3 vulnerabilidades críticas** y varios problemas de alta prioridad que deben corregirse antes de cualquier publicación en el Marketplace.

| Categoría | Crítico | Alto | Medio | Bajo |
|---|---|---|---|---|
| Seguridad | 3 | 4 | 3 | — |
| Bugs | — | 1 | 2 | 1 |
| Recursos / Leaks | — | 2 | 3 | — |
| Calidad / Mantenimiento | — | — | 3 | 4 |

---

## 2. Vista General de la Arquitectura

```
┌─────────────────────────────────────────────────────┐
│  VS Code Extension Host (Node.js)                   │
│                                                     │
│  extension.ts ──► ConnectionsProvider (TreeView)    │
│       │                                             │
│       ├──► ConnectionStorage  (globalState)         │
│       ├──► BookmarkStorage    (globalState)         │
│       ├──► HistoryStorage     (globalState)         │
│       └──► QueryPanel         (WebviewPanel)        │
│                 │                                   │
│                 └──► IAdapter (8 implementaciones)  │
│                       pg / mysql2 / sql.js /        │
│                       mssql / oracledb / mongodb /  │
│                       redis / fetch (graphql)       │
└──────────────────────┬──────────────────────────────┘
                       │  postMessage / onDidReceiveMessage
┌──────────────────────▼──────────────────────────────┐
│  Webview (browser sandbox)                          │
│  media/webview/main.ts                              │
│  CodeMirror 6 + jsPDF + DOM manual                  │
└─────────────────────────────────────────────────────┘
```

**Fortalezas de diseño:**
- Patrón adaptador con `IAdapter` / `ISchemaAdapter` / `IProcedureAdapter` limpiamente segregados.
- Todos los comandos suscritos a `context.subscriptions` — ciclo de vida correcto.
- CSP habilitado en la webview con `nonce`.
- HTML escapado con `esc()` en el frontend — no hay XSS DOM básico.
- `Promise.allSettled` para reconexión al inicio — no crashea si una conexión falla.

---

## 3. Hallazgos de Seguridad — CRÍTICOS

### SEC-01 · Contraseñas almacenadas en texto plano
**Archivo:** `src/storage/ConnectionStorage.ts:10`  
**Severidad:** CRÍTICA

```typescript
// Almacena todo el ConnectionConfig incluyendo .password sin cifrado
return this.context.globalState.get<ConnectionConfig[]>(STORAGE_KEY, []);
```

VS Code's `globalState` persiste en disco como JSON sin cifrado. Cualquier proceso con acceso al perfil del usuario puede leer todas las contraseñas de base de datos.

**Fix:** Migrar a `context.secrets` (VS Code SecretStorage API — cifrado a nivel de sistema operativo):

```typescript
// Guardar
await context.secrets.store(`db.password.${config.id}`, config.password ?? '');

// Guardar el resto sin la contraseña
const safe = { ...config, password: undefined };
await context.globalState.update(STORAGE_KEY, safe);

// Leer
const password = await context.secrets.get(`db.password.${config.id}`);
```

---

### SEC-02 · MongoDB: `JSON.parse()` sin validación sobre input del usuario
**Archivo:** `src/db/MongoAdapter.ts:73`  
**Severidad:** CRÍTICA

```typescript
const filter = filterStr.trim() ? JSON.parse(filterStr) : {};
// filterStr viene directamente de la query del usuario, sin sanitización
```

Si el usuario o un atacante que controla el query ejecuta:
```js
db.users.find({"$where": "function(){ return true; }"})
```
MongoDB ejecutará el operador `$where` con JavaScript del lado del servidor (si no está deshabilitado). Además, el `JSON.parse` sin `try/catch` puede lanzar una excepción no controlada que crashea el proceso.

**Fix:**
```typescript
let filter: Record<string, unknown> = {};
if (filterStr.trim()) {
  try {
    filter = JSON.parse(filterStr);
  } catch {
    throw new Error('Invalid filter JSON syntax');
  }
  if (typeof filter !== 'object' || Array.isArray(filter)) {
    throw new Error('Filter must be a JSON object');
  }
}
```

---

### SEC-03 · Nonce criptográficamente débil para CSP de la webview
**Archivo:** `src/panels/QueryPanel.ts:257-260`  
**Severidad:** CRÍTICA

```typescript
function randomNonce(): string {
  const chars = 'ABCDEF...0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
```

`Math.random()` **no es criptográficamente seguro** (PRNG determinista). Un nonce predecible puede ser explotado para bypassear la Content Security Policy de la webview.

**Fix:**
```typescript
import { randomBytes } from 'crypto';
function randomNonce(): string {
  return randomBytes(24).toString('base64url');
}
```

---

## 4. Hallazgos de Seguridad — ALTOS

### SEC-04 · SQL Server y SQLite: interpolación de strings en lugar de queries parametrizadas
**Archivos:** `src/db/SqlServerAdapter.ts:70-75`, `src/db/SqliteAdapter.ts:59,94,101`  
**Severidad:** ALTA

SQL Server usa `replace(/'/g, "''")` (quote-escaping manual) para nombres de tabla y schema en las queries de metadatos — técnica propensa a bypasses con encodings o caracteres especiales. SQLite hace lo mismo con comillas dobles.

```typescript
// SqlServerAdapter.ts — vulnerable
WHERE TABLE_SCHEMA = '${schema.replace(/'/g, "''")}'
AND TABLE_NAME = '${table.replace(/'/g, "''")}'

// SqliteAdapter.ts — vulnerable
`SELECT sql FROM sqlite_master WHERE name = '${table.replace(/'/g, "''")}'`
```

**Fix para SQL Server:** Usar `.input()` parametrizado en todos los métodos, no solo en `updateCell`.  
**Fix para SQLite:** `sql.js` soporta statements preparados con `db.prepare()`:
```typescript
const stmt = this.db!.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`);
const result = stmt.getAsObject([table]);
stmt.free();
```

---

### SEC-05 · SQL Server: `trustServerCertificate: true` hardcodeado
**Archivo:** `src/db/SqlServerAdapter.ts:20`  
**Severidad:** ALTA

```typescript
options: {
  trustServerCertificate: true,   // ← siempre deshabilitado, sin opción del usuario
  encrypt: this.config.encrypt ?? false,
}
```

Esto deshabilita la validación TLS/SSL del servidor, abriendo la puerta a ataques **man-in-the-middle** en redes no confiables.

**Fix:** Exponer `trustServerCertificate` como opción en `ConnectionConfig` (default `false`) y mostrarlo en el formulario de conexión.

---

### SEC-06 · GraphQL: headers del usuario merged sin validación
**Archivo:** `src/db/GraphQLAdapter.ts`  
**Severidad:** ALTA

```typescript
headers: {
  'Content-Type': 'application/json',
  ...(this.config.headers ?? {}),  // El usuario puede sobreescribir cualquier header
}
```

Un usuario puede sobrescribir `Content-Type`, agregar `Authorization` con tokens robados de otra conexión, o manipular headers de CORS si la extensión se usa en un contexto compartido.

**Fix:** Validar que `this.config.headers` no sobreescriba headers de sistema:
```typescript
const PROTECTED_HEADERS = ['content-type', 'content-length'];
const safeHeaders = Object.fromEntries(
  Object.entries(this.config.headers ?? {}).filter(
    ([k]) => !PROTECTED_HEADERS.includes(k.toLowerCase())
  )
);
```

---

### SEC-07 · MySQL: `USE \`${database}\`` sin validación de nombre de base de datos
**Archivo:** `src/db/MysqlAdapter.ts`  
**Severidad:** ALTA

```typescript
if (database) await conn.query(`USE \`${database}\``);
```

Los backticks en MySQL se pueden cerrar con un backtick dentro del nombre. Un nombre de base de datos como `` foo`; DROP DATABASE bar; -- `` podría ejecutar sentencias arbitrarias.

**Fix:** Validar que el nombre solo contenga caracteres alfanuméricos, guiones y underscores antes de interpolarlo, o usar el método de cambio de base de datos de la librería si está disponible.

---

## 5. Hallazgos de Seguridad — MEDIOS

### SEC-08 · Credenciales transmitidas en texto plano por IPC (postMessage)
**Archivo:** `src/panels/AddConnectionPanel.ts`  
**Severidad:** MEDIA

Durante la prueba y guardado de conexión, el objeto completo `ConnectionConfig` (incluyendo `password`) se envía como mensaje JSON en el IPC de VS Code:
```typescript
{ type: 'testConnection', config: ConnectionConfig }  // config incluye .password
```

Aunque el IPC de VS Code está sandboxed, esta práctica es innecesaria: la password podría obtenerse solo del lado del host.

---

### SEC-09 · Redis: parsing de comandos sin sanitización
**Archivo:** `src/db/RedisAdapter.ts`  
**Severidad:** MEDIA

El adapter parsea el input como comandos Redis directos y los envía a `sendCommand()`. Un usuario con acceso al editor puede ejecutar comandos destructivos (`FLUSHALL`, `CONFIG SET`, `DEBUG SLEEP`) sin ninguna restricción o advertencia.

---

### SEC-10 · Oracle: autocommit implícito en `updateCell`
**Archivo:** `src/db/OracleAdapter.ts`  
**Severidad:** MEDIA

```typescript
await this.conn.execute(updateSql, binds, { autoCommit: true });
```

Cada edición de celda se confirma inmediatamente sin soporte de transacciones. Si falla a mitad de una operación compuesta, los datos quedan en estado inconsistente sin posibilidad de rollback.

---

## 6. Memory Leaks y Gestión de Recursos

### RES-01 · `loadSchemaAsync`: concurrencia ilimitada contra la base de datos
**Archivo:** `src/panels/QueryPanel.ts:197-213`  
**Severidad:** ALTA

```typescript
await Promise.allSettled(
  tables.map(async (t) => {
    const cols = await this.adapter.getColumns(database, t.name, t.schema);
    // ...
  }),
);
```

Para bases de datos con 200+ tablas, esto dispara 200+ queries simultáneas contra el servidor. Puede agotar el pool de conexiones o saturar el servidor.

**Fix:** Limitar la concurrencia con un semáforo simple:
```typescript
async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  const executing = new Set<Promise<void>>();
  for (const task of tasks) {
    const p = task().then(r => { results.push(r); executing.delete(p as unknown as Promise<void>); });
    executing.add(p as unknown as Promise<void>);
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.allSettled(executing);
  return results;
}
```

---

### RES-02 · SQLite: `fs.writeFileSync` síncrono en el event loop de Node.js
**Archivo:** `src/db/SqliteAdapter.ts:77`  
**Severidad:** ALTA

```typescript
fs.writeFileSync(this.config.filename, Buffer.from(this.db!.export()));
```

Esta escritura síncrona ocurre en el process loop de la extensión (Extension Host). Para archivos SQLite grandes (>50MB), **congela VS Code** hasta que termina.

**Fix:**
```typescript
import { writeFile } from 'fs/promises';
await writeFile(this.config.filename, Buffer.from(this.db!.export()));
```

---

### RES-03 · PostgreSQL: conexiones por base de datos nunca expiran
**Archivo:** `src/db/PostgresAdapter.ts`  
**Severidad:** MEDIA

El adapter mantiene un `Map<string, pg.Client>` de clientes por base de datos. Si el usuario abre N bases de datos distintas, se crean N conexiones que nunca se cierran hasta que se desconecta manualmente.

**Fix:** Implementar LRU o cierre automático por inactividad (ej. 30 min).

---

### RES-04 · `cancelPromise` abandona reject sin resolución
**Archivo:** `src/panels/QueryPanel.ts:161-163`  
**Severidad:** MEDIA

```typescript
const cancelPromise = new Promise<never>((_, reject) => {
  this.cancelFn = () => { cancelled = true; reject(new Error('Query cancelled')); };
});
```

Si la query completa normalmente, `cancelPromise` queda en estado `pending` y el `reject` se almacena en `this.cancelFn`. Aunque `this.cancelFn = null` en `finally` libera la referencia, la promesa en sí permanece en la cola de microtareas hasta que el GC la recolecte. En Node.js esto puede generar warnings de `UnhandledPromiseRejection` si el reject nunca es llamado antes de que la promesa sea recolectada (depende de la versión).

**Fix:** Usar `AbortController` (nativo en Node 16+):
```typescript
const ac = new AbortController();
this.cancelFn = () => { ac.abort(new Error('Query cancelled')); };
const result = await this.adapter.query(msg.sql, msg.database, { signal: ac.signal });
```

---

### RES-05 · Almacenamiento de bookmarks ilimitado en `globalState`
**Archivo:** `src/storage/BookmarkStorage.ts`  
**Severidad:** MEDIA

Los bookmarks no tienen límite de tamaño ni cantidad. Queries SQL muy largas guardadas como bookmarks pueden inflar indefinidamente el `globalState` de VS Code, degradando el rendimiento de serialización.

---

## 7. Bugs Funcionales

### BUG-01 · `autoRun` descartado en nuevos paneles — la tabla no se ejecuta automáticamente
**Archivo:** `src/panels/QueryPanel.ts:63`  
**Severidad:** ALTA

```typescript
private constructor(
  ...
  autoRun = false,  // ← recibido pero...
) {
  ...
  void autoRun;     // ← explícitamente descartado (silencia el lint)
}
```

El mensaje `init` que se envía a la webview no incluye el campo `autoRun`. Cuando el usuario hace "Open Table in New Tab", el query NO se ejecuta automáticamente, contradiciendo la UX esperada.

La intención original está en `createNew()` que pasa `true` al constructor, pero el valor nunca llega a la webview.

**Fix:**
```typescript
// En pendingInit, guardar el flag
this.pendingInit = { connectionName, database, query, autoRun };

// En handleMessage('ready'), incluirlo en el send:
this.send({ type: 'init', ...this.pendingInit, ... });
```

---

### BUG-02 · Ruta WASM de SQLite hardcodeada — fallará en extensión empaquetada
**Archivo:** `src/db/SqliteAdapter.ts:16-17`  
**Severidad:** MEDIA

```typescript
const wasmPath = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
```

Después de compilar con esbuild, `__dirname` apunta a `out/`. La ruta resultante es `out/../node_modules/sql.js/dist/sql-wasm.wasm`. En una extensión empaquetada (`.vsix`), `node_modules` no existe en esa ubicación relativa. Esto causa un error fatal al conectar a cualquier SQLite.

**Fix:** Usar la URI del contexto de extensión para localizar el archivo WASM, y copiarlo al directorio `out/` en el build script.

---

### BUG-03 · `query()` de SQL Server retorna resultado incorrecto cuando `recordset === undefined`
**Archivo:** `src/db/SqlServerAdapter.ts:89-93`  
**Severidad:** MEDIA

```typescript
const rs = result.recordset ?? [];
const affected = result.rowsAffected[0] ?? 0;
if (!rs.length && result.recordset === undefined) {
  return this.dmlResult(affected, Date.now() - start);
}
```

La condición `!rs.length && result.recordset === undefined` es contradictoria: `rs` ya es `result.recordset ?? []`, así que si `result.recordset` es `undefined`, `rs` es `[]` y `rs.length` es `0`. La comprobación es redundante pero pasa. Sin embargo, si `result.recordset` es un array vacío `[]`, la condición falla silenciosamente y retorna `{ columns: [], rows: [], rowCount: 0 }` en lugar de `dmlResult(affected, ...)`.

---

### BUG-04 · Doble registro en `panels` Map al revelar panel existente
**Archivo:** `src/panels/QueryPanel.ts:78-85`  
**Severidad:** BAJA

Cuando `createOrShow` encuentra un panel existente, lo revela y retorna antes de hacer `panels.set`. Correcto. Pero si `createNew` se llama con la misma clave (por la lógica del contador), podría colisionar si el contador no es único entre sesiones. El contador se resetea a `0` en cada activación de extensión.

---

## 8. Mantenibilidad y Calidad de Código

### MNT-01 · HTML generado por concatenación de strings — imposible de mantener
**Archivo:** `src/panels/QueryPanelHtml.ts`  
**Severidad:** MEDIA

El HTML de la webview se construye como template literal gigante. Cualquier cambio de estructura requiere editar strings en TypeScript, sin autocompletado ni validación de HTML.

**Recomendación:** Usar archivos `.html` como recurso estático cargados en tiempo de ejecución (ya disponible via `panel.webview.asWebviewUri`), o al menos separar secciones en funciones nombradas.

---

### MNT-02 · Sin tests unitarios ni de integración
**Severidad:** MEDIA

El proyecto no tiene ningún test. Los adapters tienen lógica compleja (parseo MongoDB, construcción DDL, manejo de conexiones) que se presta perfectamente para tests unitarios con mocks de drivers.

---

### MNT-03 · `extension.ts` tiene un bloque de registro de comandos monolítico
**Archivo:** `src/extension.ts`  
**Severidad:** MEDIA

Todos los comandos se registran en línea dentro de `activate()`. Con 12+ comandos y sus handlers, el archivo crece de forma difícil de navegar. 

**Recomendación:** Extraer a un objeto de tabla de comandos:
```typescript
const commands: Record<string, (...args: unknown[]) => unknown> = {
  'dbConnection.addConnection': () => AddConnectionPanel.createOrShow(...),
  // ...
};
Object.entries(commands).forEach(([id, handler]) =>
  context.subscriptions.push(vscode.commands.registerCommand(id, handler))
);
```

---

### MNT-04 · `buildDefaultQuery` retorna formatos inconsistentes entre adapters
- PostgreSQL: `SELECT * FROM "table" LIMIT 150`
- MySQL: `SELECT * FROM \`table\` LIMIT 150`
- SQL Server: `SELECT TOP 150 * FROM [table]`
- MongoDB: `db.collection.find({}).limit(150)`

No es incorrecto, pero acopla la lógica de dialectos SQL dentro del adapter en lugar de tenerla en un lugar centralizado.

---

### MNT-05 · Falta de logging estructurado
Los errores en `loadSchemaAsync`, reconexión al inicio, y varios `catch` vacíos se silencian completamente. Hace muy difícil diagnosticar problemas en producción.

**Recomendación:** Usar `vscode.window.createOutputChannel('DB Connection')` para loggear errores no críticos con contexto.

---

## 9. Escalabilidad

| Problema | Impacto | Archivo |
|---|---|---|
| Todas las filas cargadas en memoria sin límite del lado del servidor | OOM para tablas >1M rows | `QueryPanel.ts` — ningún `LIMIT` forzado |
| `loadSchemaAsync` sin concurrencia limitada | Satura pool de conexiones | `QueryPanel.ts:197` |
| `fs.readFileSync` carga SQLite completo en RAM al conectar | OOM para archivos >500MB | `SqliteAdapter.ts:18` |
| `globalState` de VS Code no está diseñado para datos grandes | Degradación de rendimiento | `ConnectionStorage`, `BookmarkStorage` |
| No hay paginación server-side | Queries lentas retornan todo antes de mostrar nada | Todos los adapters |

---

## 10. UI / UX

| # | Problema | Impacto |
|---|---|---|
| UX-01 | No hay indicador de que el schema de autocompletado se está cargando | El usuario no sabe por qué el autocomplete no funciona al abrir un panel nuevo |
| UX-02 | No hay forma de editar una conexión existente (solo agregar/eliminar) | Cambiar una contraseña requiere borrar y recrear la conexión |
| UX-03 | `autoRun` roto (BUG-01) — "Open Table" no ejecuta el query | Confusión: tabla abierta pero vacía, el usuario no sabe que debe ejecutar manualmente |
| UX-04 | Los errores de conexión en el Tree View muestran stack traces crudos | Mensajes de error poco útiles para el usuario final |
| UX-05 | No hay confirmación antes de ejecutar DML (`UPDATE`, `DELETE`, `DROP`) | Pérdida accidental de datos con un Ctrl+Enter |
| UX-06 | La paginación es client-side (100 filas/página) pero todas las filas se traen del servidor | Ilusión de paginación — no mejora el rendimiento en tablas grandes |

---

## 11. Plan de Remediación Priorizado

### Fase 1 — Seguridad crítica (antes de publicar)

| ID | Tarea | Esfuerzo |
|---|---|---|
| SEC-01 | Migrar passwords a `context.secrets` (SecretStorage API) | 3h |
| SEC-02 | Envolver `JSON.parse(filterStr)` con try/catch y validación de tipo | 30min |
| SEC-03 | Reemplazar `Math.random()` con `crypto.randomBytes()` en `randomNonce` | 15min |
| BUG-01 | Incluir `autoRun` en el mensaje `init` de la webview | 30min |
| BUG-02 | Corregir ruta WASM de SQLite usando `context.extensionUri` | 1h |

### Fase 2 — Seguridad alta y bugs importantes

| ID | Tarea | Esfuerzo |
|---|---|---|
| SEC-04 | Reemplazar quote-escaping con queries parametrizadas en SQLite y SQL Server | 4h |
| SEC-05 | Hacer `trustServerCertificate` configurable por el usuario | 1h |
| SEC-07 | Validar nombres de base de datos antes de interpolar en MySQL | 1h |
| RES-01 | Limitar concurrencia en `loadSchemaAsync` a 5-10 threads | 1h |
| RES-02 | Hacer `writeFileSync` asíncrono en SQLite | 15min |

### Fase 3 — Calidad y UX

| ID | Tarea | Esfuerzo |
|---|---|---|
| UX-02 | Agregar formulario de edición de conexión existente | 4h |
| UX-05 | Agregar confirmación antes de ejecutar DML destructivo | 2h |
| RES-03 | Expiración de conexiones inactivas en PostgreSQL | 2h |
| MNT-02 | Agregar tests unitarios para adapters críticos | 8h |
| MNT-05 | Agregar Output Channel para logging estructurado | 1h |

---

*Reporte generado por análisis estático sobre código fuente. Las severidades son estimaciones de riesgo relativo — no reemplazan un pentest dinámico sobre instancias de base de datos reales.*
