# Auditoría de Código — Segunda Iteración

> **Fecha:** 2026-05-22  
> **Base:** Tras aplicar Fase 1 y Fase 2 del AUDIT.md anterior  
> **Commit de referencia:** main (post-phase-2)

---

## Estado de remediaciones anteriores

| ID | Descripción | Estado |
|---|---|---|
| SEC-01 | Passwords a SecretStorage | ✅ Resuelto |
| SEC-02 | MongoDB JSON.parse con validación | ✅ Resuelto |
| SEC-03 | Nonce criptográfico | ✅ Resuelto |
| SEC-04 | Queries parametrizadas (SQLite DDL + updateCell, SQL Server WHERE clauses) | ⚠️ Parcial — ver SEC-A y SEC-B |
| SEC-05 | `trustServerCertificate` configurable | ✅ Resuelto |
| SEC-06 | GraphQL headers sin validación | ❌ Pendiente |
| SEC-07 | MySQL backtick escaping | ✅ Resuelto |
| RES-01 | Concurrencia limitada en loadSchemaAsync | ✅ Resuelto |
| RES-02 | SQLite writeFile async | ✅ Resuelto |
| BUG-01 | autoRun en mensaje init | ✅ Resuelto |
| BUG-02 | Ruta WASM de SQLite | ✅ Resuelto |

---

## Hallazgos nuevos / residuales

### CRÍTICO

#### SEC-A · SQL Server `updateCell`: identificadores sin escapar
**Archivo:** `src/db/SqlServerAdapter.ts:175`  
**Severidad:** CRÍTICA

```typescript
await req.query(
  `UPDATE [${database}].[${schema}].[${table}] SET [${column}] = @newVal WHERE ${where}`
);
```

`database`, `schema`, `table` y `column` son interpolados sin `SqlServerAdapter.esc()`. Un valor como `master]; DROP TABLE users; --` cierra el bracket y ejecuta SQL arbitrario. Los valores PK en `where` usan `@pk0` paramétrico (correcto), pero los identificadores no.

**Fix:**
```typescript
const d = SqlServerAdapter.esc(database);
const s = SqlServerAdapter.esc(schema);
const t = SqlServerAdapter.esc(table);
const c = SqlServerAdapter.esc(column);
await req.query(
  `UPDATE [${d}].[${s}].[${t}] SET [${c}] = @newVal WHERE ${where}`
);
```

---

#### SEC-B · SQL Server `getProcedureDefinition`: `database` sin escapar
**Archivo:** `src/db/SqlServerAdapter.ts:145`  
**Severidad:** CRÍTICA

```typescript
`SELECT OBJECT_DEFINITION(OBJECT_ID('[${database}].[${schema.replace(...)}].[${name.replace(...)}]'))`
```

`schema` y `name` están escapados con `.replace(/]/g, ']]')` pero `database` NO. Un database name con `]` rompe la query.

**Fix:** reemplazar `${database}` con `${SqlServerAdapter.esc(database)}`.

---

### ALTA

#### SEC-C · GraphQL: headers de usuario pueden sobrescribir `Content-Type`
**Archivo:** `src/db/GraphQLAdapter.ts:92-95`  
**Severidad:** ALTA

```typescript
const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  ...(this.config.headers ?? {}),  // ← sobrescribe cualquier header
};
```

Headers definidos por el usuario tienen precedencia. Un `Content-Type: text/plain` hace que algunos servidores rechacen el body JSON. Más relevante: un usuario malintencionado con acceso al formulario puede inyectar `Authorization: Bearer <token_ajeno>`.

**Fix:**
```typescript
const PROTECTED = new Set(['content-type', 'content-length']);
const userHeaders = Object.fromEntries(
  Object.entries(this.config.headers ?? {}).filter(
    ([k]) => !PROTECTED.has(k.toLowerCase()),
  ),
);
const headers = { 'Content-Type': 'application/json', ...userHeaders };
```

---

#### BUG-A · UI: el campo `LIMIT` de la toolbar no tiene efecto
**Archivo:** `src/panels/QueryPanelHtml.ts:43`, `media/webview/main.ts:143-149`  
**Severidad:** ALTA

La toolbar muestra un `<input id="limit-input" value="150">` pero `runQuery()` nunca lo lee:
```typescript
function runQuery() {
  const sqlText = editor.state.doc.toString().trim();
  // ← limit-input no se usa en ningún momento
  vscode.postMessage({ type: 'runQuery', sql: sqlText, database: currentDatabase });
}
```

El usuario ve el campo, lo cambia, y no pasa nada. Es confuso y genera expectativas falsas.

**Fix:** O leerlo e inyectarlo al query como sugerencia (`/* LIMIT ${val} */`), o eliminar el input del HTML.

---

#### BUG-B · Ejecución concurrente de queries: `cancelFn` se sobreescribe
**Archivo:** `src/panels/QueryPanel.ts:154-182`  
**Severidad:** ALTA

El botón "Run" no se deshabilita mientras hay una query en vuelo (`showLoading()` no lo toca). Si el usuario ejecuta dos queries seguidas, la segunda sobreescribe `this.cancelFn`:
```typescript
// Query 1 en vuelo: this.cancelFn = () => { ... reject1() }
// Query 2 llega:
this.cancelFn = () => { ... reject2() };  // ← reject1 ya no es alcanzable
```
La primera query ya no puede cancelarse, y si retorna después, `this.send({ type: 'queryResult', ...result })` llega fuera de contexto.

**Fix:** deshabilitar el botón Run en la webview durante la carga.

En `main.ts`:
```typescript
function showLoading() {
  (document.getElementById('run-btn') as HTMLButtonElement).disabled = true;
  ...
}
function showResults(...) {
  (document.getElementById('run-btn') as HTMLButtonElement).disabled = false;
  ...
}
// igual en showError() y showCancelled()
```

---

#### RES-A · SQLite `connect()`: `readFileSync` síncrono bloquea el event loop
**Archivo:** `src/db/SqliteAdapter.ts:19`  
**Severidad:** ALTA

```typescript
const data = fs.readFileSync(this.config.filename);  // ← bloqueante
```

Se corrigió `writeFileSync` (RES-02) pero el `readFileSync` al conectar sigue siendo síncrono. Para archivos SQLite grandes (>100MB) congela el Extension Host hasta que termina.

**Fix:**
```typescript
import { readFile } from 'fs/promises';
// ...
const data = await readFile(this.config.filename);
```

---

#### RES-B · Redis `KEYS *` bloquea el servidor en producción
**Archivo:** `src/db/RedisAdapter.ts:52`  
**Severidad:** ALTA

```typescript
const keys = await this.client!.keys('*');
return keys.slice(0, 500).sort().map(...);
```

`KEYS *` es O(N) y bloquea todos los demás clientes de Redis mientras se ejecuta. En instancias de producción con millones de claves, causa timeouts generalizados.

**Fix:** reemplazar por `SCAN` con cursor:
```typescript
const keys: string[] = [];
let cursor = 0;
do {
  const reply = await this.client!.scan(cursor, { COUNT: 200 });
  cursor = reply.cursor;
  keys.push(...reply.keys);
} while (cursor !== 0 && keys.length < 500);
return keys.slice(0, 500).sort().map((k) => ({ name: k, type: 'table' as const }));
```

---

#### BUG-C · `BookmarkStorage` y `HistoryStorage`: `globalState.update()` sin `await`
**Archivos:** `src/storage/BookmarkStorage.ts:29,35`, `src/storage/HistoryStorage.ts:25,31`  
**Severidad:** ALTA

```typescript
// BookmarkStorage.ts
this.context.globalState.update(this.key(...), all);  // Promise ignorada
return all;

// HistoryStorage.ts
this.context.globalState.update(this.key(...), all);  // Promise ignorada
```

`globalState.update()` retorna `Promise<void>`. Al no esperarla, si VS Code se cierra o la extensión se desactiva durante la escritura, el dato se pierde silenciosamente. Los callers reciben el array en memoria como si ya se hubiera persistido.

**Fix:** hacer los métodos `async` y awaitar la llamada. Los callers (`QueryPanel`, `handleMessage`) deberán awaitar también.

---

### MEDIA

#### SEC-D · PostgreSQL `updateCell`: identificadores sin escaping de comillas dobles
**Archivo:** `src/db/PostgresAdapter.ts:181-182`  
**Severidad:** MEDIA

```typescript
const where = pkEntries.map(([k, v], i) => {
  params.push(v);
  return `"${k}" = $${i + 2}`;   // ← k no escapa comillas dobles internas
}).join(' AND ');
await client.query(
  `UPDATE "${schema}"."${table}" SET "${column}" = $1 WHERE ${where}`,
  params,
);
```

`schema`, `table`, `column` y los nombres de columnas PK (`k`) están entre comillas dobles pero sin escapar comillas dobles internas. Un nombre de columna como `col"name` generaría SQL inválido o injection. La probabilidad es baja (los nombres vienen de `getColumns`/`getPrimaryKeys`), pero no es cero.

**Fix:** usar `quote_ident()` de PostgreSQL o escapar con `.replace(/"/g, '""')`.

---

#### BUG-D · `BookmarkStorage.add()`: no tiene límite de tamaño
**Archivo:** `src/storage/BookmarkStorage.ts:21-31`  
**Severidad:** MEDIA

Los bookmarks se acumulan sin límite. Queries SQL muy largas guardadas como bookmarks inflan `globalState` indefinidamente. VS Code serializa todo `globalState` en cada cambio.

**Fix:** limitar a un máximo razonable (ej. 200 bookmarks por conexión/base de datos).

---

#### BUG-E · SQL Server `query()`: lógica de resultado vacío incorrecta
**Archivo:** `src/db/SqlServerAdapter.ts:99-103`  
**Severidad:** MEDIA

```typescript
const rs = result.recordset ?? [];
const affected = result.rowsAffected[0] ?? 0;
if (!rs.length && result.recordset === undefined) {   // ← siempre false si rs = []
  return this.dmlResult(affected, ...);
}
const columns = rs.length > 0 ? Object.keys(rs[0]) : [];
return { columns, rows: rs, rowCount: affected || rs.length, ... };
```

La condición `result.recordset === undefined` nunca se cumple porque en la línea anterior ya se evaluó `result.recordset ?? []`. Si `recordset` es `undefined`, `rs` es `[]` y la condición `!rs.length && result.recordset === undefined` evalúa `true && false = false`. El resultado de un DML que retorna 0 filas se reporta incorrectamente como `{ columns: [], rows: [], rowCount: 0 }` en lugar de `dmlResult`.

---

#### RES-C · PostgreSQL: `sessionClients` acumula conexiones sin TTL
**Archivo:** `src/db/PostgresAdapter.ts:185-193`  
**Severidad:** MEDIA

Por cada base de datos que el usuario consulta se abre un `pg.Client` que nunca expira. Tras explorar 10 bases de datos diferentes quedan 10 conexiones abiertas indefinidamente hasta que el usuario desconecta manualmente.

**Fix:** implementar LRU con cierre automático por inactividad (30 min).

---

#### BUG-F · `QueryPanel.counter` es estático y no persiste entre sesiones
**Archivo:** `src/panels/QueryPanel.ts:24`  
**Severidad:** BAJA

```typescript
private static counter = 0;
```

Al recargar la extensión (F1 → "Reload Window"), el contador se resetea a 0. Si el usuario había abierto tabs con keys `config1:db1:1`, `config1:db1:2`, al recargar los nuevos tabs usarían las mismas keys y podrían colisionar en el Map.

---

### BAJA

| # | Hallazgo | Archivo |
|---|---|---|
| INFO-1 | `SqlServerAdapter.buildDefaultQuery` no escapa `schema`/`table` en `[...]` | `SqlServerAdapter.ts:44-47` |
| INFO-2 | `MysqlAdapter.buildDefaultQuery` no escapa backtick en `table` | `MysqlAdapter.ts:39` |
| INFO-3 | Oracle `updateCell` auto-commit sin soporte de transacciones | `OracleAdapter.ts:134` |
| INFO-4 | Ausencia de Output Channel para diagnóstico | — |
| INFO-5 | `loadSchemaAsync` silencia todos los errores con `catch {}` | `QueryPanel.ts:215` |
| INFO-6 | `BookmarkStorage`/`HistoryStorage`: IDs basados en `Date.now()` colisionan si se crean en el mismo ms | `BookmarkStorage.ts:22`, `HistoryStorage.ts:23` |

> INFO-1 e INFO-2 son de bajo riesgo real porque los nombres de tabla/schema provienen de consultas al catálogo de la base de datos, no del input directo del usuario.

---

## Resumen de severidades

| Categoría | Crítico | Alto | Medio | Bajo |
|---|---|---|---|---|
| Seguridad | 2 | 1 | 1 | 2 |
| Bugs funcionales | — | 2 | 2 | 1 |
| Recursos | — | 2 | 1 | — |
| Calidad | — | 1 | — | 3 |

---

## Plan de remediación — Fase 3

### Prioridad inmediata (antes de publicar)

| ID | Tarea | Esfuerzo |
|---|---|---|
| SEC-A | Escapar `database/schema/table/column` con `esc()` en `SqlServerAdapter.updateCell` | 15min |
| SEC-B | Escapar `database` con `esc()` en `SqlServerAdapter.getProcedureDefinition` | 5min |
| BUG-B | Deshabilitar el botón Run durante ejecución de query | 20min |
| BUG-A | Conectar el campo `limit-input` al query o eliminarlo | 30min |
| BUG-C | Awaitar `globalState.update()` en `BookmarkStorage` y `HistoryStorage` | 30min |

### Prioridad alta

| ID | Tarea | Esfuerzo |
|---|---|---|
| RES-A | Cambiar `readFileSync` a `readFile` async en `SqliteAdapter.connect` | 15min |
| RES-B | Reemplazar `KEYS *` por `SCAN` en `RedisAdapter.getTables` | 30min |
| SEC-C | Filtrar headers protegidos en `GraphQLAdapter` | 15min |
| SEC-D | Escapar identifiers con `""` en `PostgresAdapter.updateCell` | 20min |
| BUG-E | Corregir lógica de resultado vacío en `SqlServerAdapter.query` | 10min |

---

*Segunda iteración de auditoría estática. Los hallazgos INFO-1/INFO-2 se mantienen como deuda técnica de baja prioridad.*
