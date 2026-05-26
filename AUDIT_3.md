# Auditoría de Código — Tercera Iteración

> **Fecha:** 2026-05-22
> **Alcance:** Revisión completa del codebase post-Fase 3. Foco en bugs confirmados, seguridad, memory leaks, SOLID y mantenibilidad.
> **Metodología:** Análisis estático manual, lectura de todos los archivos fuente.

---

## Estado de remediaciones anteriores

Todas las fases anteriores (SEC-A→D, BUG-A→F, RES-A→C, INFO-1→6) están resueltas en el código actual.

---

## Hallazgos nuevos

---

### CRÍTICO

#### BUG-01 · `AddConnectionPanel.saveConnection` — conexión se abre y jamás se cierra

**Archivo:** `src/panels/AddConnectionPanel.ts:72-89`
**Severidad:** CRÍTICA · Resource leak confirmado

```typescript
case 'saveConnection': {
  const adapter = createAdapter(config);
  await adapter.connect();          // ← se abre
  await this.storage.saveConnection(config);
  this.provider.refresh();
  this.panel.dispose();             // ← adapter nunca se cierra
  // adapter.disconnect() → ausente
}
```

El adapter se instancia, conecta, y abandona. Para MySQL queda un pool abierto; para PostgreSQL un `pg.Client`; para MongoDB un `MongoClient`. Cada vez que el usuario guarda una conexión, un handle de red queda activo hasta que el proceso muere o el servidor cierra el TCP por inactividad.

**Fix:**
```typescript
const adapter = createAdapter(config);
try {
  await adapter.connect();
  await this.storage.saveConnection(config);
  this.provider.refresh();
  this.panel.dispose();
  vscode.window.showInformationMessage(`✓ Connection "${config.name}" saved.`);
} catch (err: unknown) {
  this.send({ type: 'saveResult', success: false, message: err instanceof Error ? err.message : String(err) });
} finally {
  await adapter.disconnect().catch(() => {});
}
```

---

#### SEC-01 · `AddConnectionPanel` — ID de conexión basado en `Date.now()` sobrescribe silenciosamente

**Archivo:** `src/panels/AddConnectionPanel.ts:74`
**Severidad:** CRÍTICA · Pérdida de datos silenciosa

```typescript
const config: ConnectionConfig = { id: Date.now().toString(), ...raw };
```

`ConnectionStorage.saveConnection()` usa `findIndex(c => c.id === config.id)` para decidir si actualiza o inserta. Si dos conexiones se guardan en el mismo milisegundo (posible con doble-click, tests, o baja resolución de reloj), la segunda actualiza silenciosamente la primera — el usuario pierde una conexión sin ningún aviso.

El mismo patrón ya fue corregido en `BookmarkStorage`/`HistoryStorage` (INFO-6), pero quedó sin corregir aquí.

**Fix:**
```typescript
import { randomBytes } from 'crypto';
// ...
const config: ConnectionConfig = { id: randomBytes(8).toString('hex'), ...raw };
```

---

### ALTO

#### BUG-02 · `ConnectionsProvider.getOrConnect()` — race condition al expandir nodos concurrentemente

**Archivo:** `src/tree/ConnectionsProvider.ts:128-138`
**Severidad:** ALTA · Double-connect confirmado

```typescript
async getOrConnect(config: ConnectionConfig): Promise<IAdapter> {
  const existing = this.adapters.get(config.id);
  if (existing?.isConnected()) return existing;   // ← check sin lock

  const adapter = createAdapter(fullConfig);
  await adapter.connect();                         // ← async gap
  this.adapters.set(config.id, adapter);           // ← sobreescribe si llegó otro
}
```

Si el usuario expande dos nodos hijos de la misma conexión casi simultáneamente, ambas llamadas pasan el check `isConnected() = false`, ambas llaman `adapter.connect()`, y la primera conexión establecida queda huérfana en memoria (el Map solo guarda la segunda). Para bases de datos con límite de conexiones (Postgres default: 100, Oracle: licencia), esto es un leak que se puede reproducir expandiendo el árbol rápido.

**Fix:** guardar la promesa de conexión mientras está en curso:

```typescript
private connecting = new Map<string, Promise<IAdapter>>();

async getOrConnect(config: ConnectionConfig): Promise<IAdapter> {
  const existing = this.adapters.get(config.id);
  if (existing?.isConnected()) return existing;

  const pending = this.connecting.get(config.id);
  if (pending) return pending;

  const promise = (async () => {
    const fullConfig = await this.storage.getFullConfig(config.id) ?? config;
    const adapter = createAdapter(fullConfig);
    await adapter.connect();
    this.adapters.set(config.id, adapter);
    this.connecting.delete(config.id);
    this._onDidChangeTreeData.fire();
    return adapter;
  })();

  this.connecting.set(config.id, promise);
  return promise;
}
```

---

#### SEC-02 · `OracleAdapter.updateCell` — identificadores sin escapar

**Archivo:** `src/db/OracleAdapter.ts:125-136`
**Severidad:** ALTA · SQL injection en nombres de columna/tabla

```typescript
await this.conn.execute(
  `UPDATE "${table}" SET "${column}" = :newVal WHERE ${where}`,
  binds,
  { autoCommit: true },
);
```

`table`, `column` y los nombres de PK en `where` (línea 130: `"${k}" = :pk${i}`) están entre comillas dobles pero sin escapar comillas internas. Un nombre de tabla `foo"bar` genera SQL inválido o injection. La misma vulnerabilidad se corrigió en Postgres (SEC-D, AUDIT_2). Oracle usa el mismo estándar SQL para escapar: `""` dentro de identificadores entre `"..."`.

Además, `buildDefaultQuery`:
```typescript
return `SELECT * FROM "${table}" FETCH FIRST 150 ROWS ONLY`;  // table sin escapar
```

**Fix:**
```typescript
private static esc(name: string): string {
  return name.replace(/"/g, '""');
}
// usar OracleAdapter.esc() en updateCell y buildDefaultQuery
```

---

#### MEM-01 · `ConnectionsProvider._onDidChangeTreeData` — EventEmitter nunca se dispone

**Archivo:** `src/tree/ConnectionsProvider.ts:29`
**Severidad:** ALTA · Memory leak en extensión de larga duración

```typescript
private _onDidChangeTreeData = new vscode.EventEmitter<AnyItem | undefined | void>();
```

`EventEmitter` crea listeners internos en VS Code. No se registra en `context.subscriptions`, no se dispone en ningún `deactivate`. En sesiones largas de VS Code (días / semanas sin cerrar), o si la extensión se recarga varias veces, acumula listeners.

**Fix:** registrar en `activate()`:
```typescript
context.subscriptions.push(provider['_onDidChangeTreeData']);
// o exponer un método dispose() en ConnectionsProvider
```

---

#### BUG-03 · `QueryPanel` — query en vuelo no se cancela cuando el panel se cierra

**Archivo:** `src/panels/QueryPanel.ts:59`
**Severidad:** ALTA · Queries huérfanas, adapter usage post-dispose

```typescript
this.panel.onDidDispose(() => {
  QueryPanel.panels.delete(this.panelKey);
  // ← cancelFn y adapter.cancelQuery() no se invocan
});
```

Si el usuario cierra el tab mientras una query está en vuelo:
1. `cancelFn` nunca se llama → la `cancelPromise` queda con `reject` pendiente forever
2. `adapter.cancelQuery()` nunca se llama → la query sigue corriendo en el servidor
3. Cuando el servidor responde, `this.send()` se llama sobre un panel dispuesto (no-op, pero el resultado se pierde)
4. El `IAdapter` sigue referenciado por el closure de `handleMessage`, impidiendo GC

**Fix:**
```typescript
this.panel.onDidDispose(() => {
  QueryPanel.panels.delete(this.panelKey);
  this.cancelFn?.();
  if (this.adapter.cancelQuery) {
    this.adapter.cancelQuery(this.runningDatabase).catch(() => {});
  }
});
```

---

### MEDIO

#### BUG-04 · `OracleAdapter` — conexión única, sin pool: queries concurrentes colisionan

**Archivo:** `src/db/OracleAdapter.ts:11-19`
**Severidad:** MEDIA · Corrupción de estado bajo carga concurrente

`this.conn` es una sola conexión de `oracledb`. `loadSchemaAsync` dispara hasta 5 workers paralelos llamando `getColumns()` simultáneamente, todos sobre `this.conn`. El driver oracledb no es thread-safe con una conexión compartida: dos ejecuciones concurrentes en la misma conexión pueden causar `NJS-003: invalid connection` o mezcla de resultados.

Todos los demás adapters (MySQL, PostgreSQL, MSSQL) usan pools o conexiones por-operación. Oracle es la excepción.

**Fix:** reemplazar por `oracledb.getPool()` o abrir una nueva conexión por operación (cerrar en `finally`).

---

#### MEM-02 · `PostgresAdapter.evictStaleClients` — solo se llama al abrir una sesión nueva

**Archivo:** `src/db/PostgresAdapter.ts:186-203`
**Severidad:** MEDIA · Leak parcial

`evictStaleClients()` solo se invoca desde `getSessionClient()` cuando se crea un **nuevo** cliente. Si el usuario abre DB "foo" y nunca vuelve a abrir una sesión nueva, el cliente de "foo" nunca se evalúa para evicción, aunque haya pasado el TTL de 30 minutos.

Escenario concreto: usuario explora 10 bases de datos, luego deja el IDE idle 2 horas. Ninguna de esas 10 sesiones se evicta porque no se crean nuevas. Las 10 conexiones permanecen abiertas.

**Fix:** añadir un `setInterval` al conectar (y limpiarlo al desconectar):
```typescript
private evictionTimer: NodeJS.Timeout | null = null;

async connect(): Promise<void> {
  // ...conexión normal
  this.evictionTimer = setInterval(() => this.evictStaleClients(), 5 * 60 * 1000);
}

async disconnect(): Promise<void> {
  if (this.evictionTimer) { clearInterval(this.evictionTimer); this.evictionTimer = null; }
  // ...resto del disconnect
}
```

---

#### DESIGN-01 · `isConnected()` es un flag en memoria, no una prueba real de conectividad

**Archivos:** todos los adapters
**Severidad:** MEDIA · Errores silenciosos difíciles de diagnosticar

```typescript
private connected = false;
isConnected(): boolean { return this.connected; }
```

Si el servidor de base de datos se reinicia, la red se interrumpe, o el servidor cierra el idle-timeout, `isConnected()` sigue devolviendo `true`. `ConnectionsProvider.getOrConnect()` confía en este flag para no reconectar. El usuario ve un error en la query (o en el árbol) pero la extensión no intenta reconectar — tiene que desconectar y reconectar manualmente.

Este es el comportamiento estándar de la mayoría de herramientas similares, pero vale la pena un mecanismo de reconnect-on-fail:

```typescript
// En getOrConnect:
try {
  return await adapter.query('SELECT 1'); // ping
} catch {
  this.adapters.delete(config.id);
  return this.getOrConnect(config); // reconectar
}
```

---

#### DESIGN-02 · `QueryPanel` usa el `IAdapter` de `ConnectionsProvider` sin coordinación de lifecycle

**Archivo:** `src/panels/QueryPanel.ts`, `src/tree/ConnectionsProvider.ts`
**Severidad:** MEDIA · Uso-after-disconnect, desacoplamiento incompleto

`QueryPanel` recibe el adapter en el constructor y lo guarda para siempre. Si el usuario desconecta la conexión desde el árbol (`dbConnection.disconnectConnection`), `ConnectionsProvider.disconnect()` llama `adapter.disconnect()` y elimina el adapter del Map. Pero el `QueryPanel` abierto aún tiene la misma referencia al adapter desconectado. La próxima query fallará con "Not connected" en lugar de reconectar automáticamente.

**Fix:** `QueryPanel` no debería almacenar el adapter directamente, sino una referencia a `ConnectionsProvider` + `config.id`, y resolver el adapter en cada operación vía `getOrConnect()`.

---

#### DESIGN-03 · `AddConnectionPanel` — 340 líneas de HTML+JS en un string de TypeScript

**Archivo:** `src/panels/AddConnectionPanel.ts:99-443`
**Severidad:** MEDIA · Mantenibilidad crítica

El HTML del formulario, el CSS y el JavaScript del webview están todos embebidos en un template literal de TypeScript. El JS del webview usa `var`, no tiene tipos, no es verificable por el compilador, y es prácticamente imposible de testear en aislamiento. El patrón correcto ya existe en el proyecto (`QueryPanelHtml.ts` + `media/webview/main.ts` compilado por esbuild). `AddConnectionPanel` debería seguir la misma arquitectura.

---

#### DESIGN-04 · `ConnectionConfig` — tipo plano sin discriminación por `DbType`

**Archivo:** `src/types.ts`
**Severidad:** MEDIA · Falta de type safety, errores silenciosos

```typescript
export interface ConnectionConfig {
  type: DbType;
  host?: string;        // solo para server-based
  filename?: string;    // solo para SQLite
  serviceName?: string; // solo para Oracle
  url?: string;         // solo para GraphQL/MongoDB
  headers?: Record<string,string>; // solo para GraphQL
  // ...etc
}
```

TypeScript no puede garantizar que un config de tipo `'sqlite'` tenga `filename`. Un adapter puede recibir un config de tipo incorrecto sin que el compilador lo detecte. El patrón correcto es una unión discriminada:

```typescript
type ConnectionConfig = SqliteConfig | PostgresConfig | MysqlConfig | ...
// donde cada tipo tiene exactamente los campos requeridos
```

Este cambio es invasivo pero elimina una clase entera de bugs en tiempo de compilación.

---

### BAJO / INFO

#### INFO-01 · Funciones `randomNonce()` duplicadas

**Archivos:** `src/panels/QueryPanel.ts:260`, `src/panels/AddConnectionPanel.ts:95`

Ambos archivos definen la misma función. Debería estar en `src/utils/crypto.ts` o similar.

---

#### INFO-02 · `OracleAdapter` — tipado con `any` y `require()` CommonJS

**Archivo:** `src/db/OracleAdapter.ts`

```typescript
const oracledb = require('oracledb');  // sin tipos
private conn: any = null;
```

El driver `oracledb` tiene types en `@types/oracledb`. Sin ellos, el compilador no puede detectar usos incorrectos de la API (parámetros de bind, formatos de resultado, etc.). La propiedad `conn: any` se propaga: `result.rows as any[]`, `result.metaData as any[]`, etc. Un error de API silencioso en Oracle sería invisible para el compilador.

---

#### INFO-03 · `TreeItem` classes guardan referencias a `IAdapter`

**Archivos:** `src/tree/TreeItems.ts` — `DatabaseItem`, `FolderItem`, `TableItem`, `ProcedureItem`, `SchemaItem`

Cada nodo del árbol mantiene una referencia al adapter. Con un árbol profundo (1 conexión → 10 DBs → 50 schemas → 500 tablas → columnas), se crean cientos de objetos `TreeItem` que retienen el adapter en memoria. Esto impide que el adapter sea liberado por el GC mientras los nodos existen, incluso si la conexión ya fue cerrada.

---

#### INFO-04 · `MongoAdapter.query()` — parser regex frágil, no soporta operaciones reales

**Archivo:** `src/db/MongoAdapter.ts:67`

```typescript
const match = queryStr.trim().match(/^db\.(\w+)\.find\(([\s\S]*?)\)(?:\.limit\((\d+)\))?$/);
```

Solo soporta `db.col.find({}).limit(N)`. No soporta:
- `aggregate`, `insertOne`, `updateMany`, `deleteOne`, etc.
- Filtros con operadores anidados que contienen paréntesis (el `[\s\S]*?` usa lazy match pero sigue sin tolerar paréntesis balanceados)
- Proyecciones: `find({}, { name: 1 })`

Para una herramienta de base de datos MongoDB esto es muy limitante.

---

#### INFO-05 · `ConnectionsProvider.getChildren` — sin caché, re-fetcha en cada expansión

**Archivo:** `src/tree/ConnectionsProvider.ts:66-98`

Cada vez que el usuario expande un nodo `DatabaseItem`, `getTables()` y `getProcedures()` se llaman de nuevo contra el servidor. Para bases de datos con cientos de tablas o alta latencia, esto hace el árbol lento. Un caché TTL de 60 segundos invalidado por `refresh()` mejoraría la experiencia significativamente.

---

#### INFO-06 · `loadSchemaAsync` — carga columnas de TODAS las tablas sin límite

**Archivo:** `src/panels/QueryPanel.ts:197`

Para una base de datos con 500 tablas, se lanzan 500 queries de `getColumns()` (en paralelo de 5 en 5). Para Postgres con schema-per-database, esto puede generar carga real en el servidor. Un límite de 100 tablas o autocomplete bajo demanda (lazy) sería más escalable.

---

#### INFO-07 · `esbuild.mjs` — `copyFileSync` sin manejo de error

**Archivo:** `esbuild.mjs:35`

```javascript
copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm', 'out/sql-wasm.wasm');
```

Si `sql.js` no está instalado (e.g., `npm ci` falló parcialmente), esto lanza una excepción síncrona que sale con stack trace raro. Un check explícito daría un mensaje de error más útil.

---

#### INFO-08 · Sin pruebas automatizadas

No existe ningún test unitario ni de integración. Los adapters, la lógica de storage y los paneles son completamente untestados. Cualquier refactor introduce riesgo silencioso. Considerando que se manejan credenciales y se ejecutan queries sobre bases de datos de producción, al menos los adapters deberían tener tests con bases de datos embebidas (SQLite ya es en memoria, PGLite para Postgres, etc.).

---

## Resumen de severidades

| Categoría | Crítico | Alto | Medio | Bajo/Info |
|---|---|---|---|---|
| Bugs funcionales | 1 | 2 | 1 | 2 |
| Seguridad | 1 | 1 | — | — |
| Memory leaks | — | 2 | 1 | 1 |
| Diseño/SOLID | — | — | 4 | 5 |
| Mantenibilidad | — | — | — | 2 |

---

## Plan de remediación — Fase 4

### Prioridad inmediata

| ID | Tarea | Esfuerzo |
|---|---|---|
| BUG-01 | Envolver `saveConnection` en try/finally con `adapter.disconnect()` | 10 min |
| SEC-01 | Reemplazar `Date.now()` por `randomBytes(8).toString('hex')` en `AddConnectionPanel` | 5 min |
| BUG-03 | Llamar `cancelFn` y `adapter.cancelQuery()` en el listener `onDidDispose` | 10 min |
| SEC-02 | Añadir `OracleAdapter.esc()` y aplicar en `updateCell` y `buildDefaultQuery` | 15 min |

### Prioridad alta

| ID | Tarea | Esfuerzo |
|---|---|---|
| BUG-02 | Añadir mapa de promesas en `getOrConnect()` para evitar doble-connect | 30 min |
| MEM-01 | Registrar `_onDidChangeTreeData` en `context.subscriptions` | 5 min |
| MEM-02 | Añadir `setInterval` de evicción en `PostgresAdapter.connect()` | 20 min |
| BUG-04 | Reemplazar conexión única de Oracle por pool o conexión por operación | 45 min |

### Deuda técnica (siguiente sprint)

| ID | Tarea |
|---|---|
| DESIGN-02 | Mover JS del webview de `AddConnectionPanel` a `media/` compilado por esbuild |
| DESIGN-04 | Refactorizar `ConnectionConfig` a unión discriminada por `DbType` |
| DESIGN-02 | Implementar reconnect-on-fail en `ConnectionsProvider.getOrConnect()` |
| INFO-04 | Ampliar `MongoAdapter.query()` con soporte de más operaciones |
| INFO-08 | Añadir tests unitarios para los adapters con base de datos embebida |

---

*Auditoría manual. Todos los hallazgos CRÍTICO y ALTO tienen línea de código exacta y fix propuesto. Los hallazgos MEDIO/INFO son arquitecturales o de calidad sin impacto inmediato en producción.*
