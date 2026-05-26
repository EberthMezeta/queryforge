# Auditoría MVP — DB Connection Extension

> **Fecha:** 2026-05-25
> **Versión:** 0.1.0 · branch `main`
> **Enfoque:** Evaluación del producto como MVP y definición de requerimientos

---

## Veredicto ejecutivo

**¿Es un MVP?** No completamente — es más un _feature-complete prototype_.

El producto tiene más funcionalidades de las que necesita un MVP (8 motores, CRUD inline, PDF export, procedimientos), pero le faltan elementos **de producto** fundamentales que impiden que sea publicable hoy: no se puede editar una conexión, hay un crash garantizado con SQLite empaquetado, no hay README ni assets para el Marketplace, y `openProcedure` está implementado en el backend pero es invisible al usuario porque no tiene entrada en `package.json`.

Un MVP real podría haberse lanzado con 2-3 motores y solo lectura. Lo que hay es sólido técnicamente, pero necesita cerrar las brechas de producto antes de publicar.

---

## 1. Inventario de lo que existe hoy

### 1.1 Capas de la arquitectura

| Capa | Estado |
|---|---|
| Tree view (conexiones → BD → schemas → tablas → columnas → procedimientos) | ✅ Completo |
| Adapter pattern (IAdapter / ISchemaAdapter / IProcedureAdapter) | ✅ Bien diseñado |
| Almacenamiento de credenciales (SecretStorage API) | ✅ Correcto (migrado de globalState) |
| Webview con CodeMirror 6 (resaltado SQL, autocomplete) | ✅ Funcional |
| IPC host ↔ webview vía postMessage | ✅ Correcto |
| CSP con nonce criptográfico | ✅ Correcto |

### 1.2 Motores soportados

| Motor | Adaptador | Operaciones |
|---|---|---|
| PostgreSQL | `pg` | CRUD, DDL, PK, procedures, cancelación de query |
| MySQL | `mysql2` | CRUD, DDL, procedures, cancelación |
| SQLite | `sql.js` | CRUD, DDL (lectura de archivo .db local) |
| SQL Server | `mssql` | CRUD, DDL, procedures |
| Oracle | `oracledb` | CRUD, DDL, procedures |
| MongoDB | `mongodb` | find/aggregate (sintaxis Mongo) |
| Redis | `redis` | comandos directos (KEYS, GET, SET, etc.) |
| GraphQL | `fetch` | queries/mutations via HTTP |

### 1.3 Funcionalidades del editor de queries

| Feature | Estado |
|---|---|
| Editor CodeMirror 6 con SQL highlighting | ✅ |
| Autocompletado desde schema de la BD | ✅ (carga async en background) |
| Ejecutar query con Ctrl+Enter | ✅ |
| Cancelar query en ejecución | ✅ |
| Historial de queries (Alt+↑↓) | ✅ |
| Bookmarks (guardar/cargar/borrar queries) | ✅ |
| Format query (Ctrl+Alt+F) | ✅ |
| Exportar query en .sql / .txt / .md / PDF | ✅ |
| Copiar query al clipboard | ✅ |

### 1.4 Funcionalidades de resultados

| Feature | Estado |
|---|---|
| Tabla de resultados con columnas y filas | ✅ |
| Paginación (100 filas/página, client-side) | ✅ (ilusión — ver REQ-NF-04) |
| Filtro de filas en tiempo real | ✅ |
| Ordenamiento por columna (click en header) | ✅ |
| Edición inline de celdas (doble click) | ✅ |
| Insertar fila (modal con campos) | ✅ |
| Eliminar fila(s) seleccionadas (multi-select) | ✅ |
| Menú contextual: "Copy as INSERT" | ✅ |
| Exportar resultados: CSV, JSON, Excel, PDF | ✅ |
| Indicador de tiempo de ejecución | ✅ |
| Indicador de filas retornadas | ✅ |

### 1.5 Gestión de conexiones

| Feature | Estado |
|---|---|
| Agregar conexión (formulario por motor) | ✅ |
| Probar conexión antes de guardar | ✅ |
| Eliminar conexión (con confirmación) | ✅ |
| Reconectar al iniciar VS Code | ✅ |
| Indicador visual conectado/desconectado | ✅ |
| **Editar conexión existente** | ❌ **FALTANTE** |

---

## 2. Brechas de producto (blockers para MVP publicable)

### BP-01 · No existe "Editar conexión" — CRÍTICO para UX

**Severidad:** Bloqueante  
**Impacto:** Cambiar la contraseña, el host, o el puerto de una conexión existente obliga al usuario a eliminarla y recrearla desde cero. Esto destruye la UX para cualquier usuario real.

**Requerimiento:** El formulario `AddConnectionPanel` debe poder recibir una `ConnectionConfig` existente, pre-poblar todos los campos, y guardar como update en vez de insert.

---

### BP-02 · `openProcedure` no declarado en `package.json` — comando fantasma

**Severidad:** Bloqueante funcional  
**Archivo:** `src/extension.ts:96`, `package.json:contributes.commands`

El comando `dbConnection.openProcedure` está registrado en `extension.ts` y los procedimientos se listan en el Tree View, pero no existe ninguna entrada en `package.json` para:
- `contributes.commands` → no aparece en el Command Palette
- `contributes.menus.view/item/context` con `viewItem == procedure` → no hay botón de acción en el árbol

El usuario ve los procedimientos listados, pero no puede abrirlos. El nodo `ProcedureItem` es decorativo.

**Requerimiento:** Declarar el comando en `package.json` y agregar la entrada de menú contextual.

---

### BP-03 · Crash garantizado al conectar SQLite en extensión empaquetada

**Severidad:** Bloqueante funcional  
**Archivo:** `src/db/SqliteAdapter.ts:16`

```typescript
const wasmPath = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
```

Después de `esbuild`, `__dirname` apunta a `out/`. La ruta resultante intenta leer `out/../node_modules/…` que no existe en el `.vsix` empaquetado. Resultado: **error fatal** en cualquier conexión SQLite cuando el usuario instala la extensión desde el Marketplace.

---

### BP-04 · Sin confirmación antes de DML destructivo

**Severidad:** Alto  
**Impacto:** Un `Ctrl+Enter` accidental con un `DELETE FROM users` o `DROP TABLE orders` ejecuta sin advertencia. Pérdida de datos irrecuperable en segundos.

**Requerimiento:** Antes de ejecutar cualquier statement que contenga `DELETE`, `DROP`, `TRUNCATE`, o `UPDATE` sin `WHERE`, mostrar un modal de confirmación.

---

### BP-05 · No hay assets ni README para el Marketplace

**Severidad:** Bloqueante para publicación  
El `package.json` tiene:
- `"publisher": "db-connection"` → placeholder, no es un publisher registrado en VS Code Marketplace
- `"categories": ["Other"]` → debería ser `["Data Science"]` o incluir al menos esa categoría para visibilidad
- No hay `README.md` en la raíz del proyecto
- No hay campo `"icon"` en `package.json`
- No hay `"repository"` ni `"homepage"`
- No hay `"license"`
- No hay `CHANGELOG.md`

---

## 3. Requerimientos del producto

### 3.1 Requerimientos funcionales — Núcleo del MVP (v0.1)

#### RF-01 Gestión de conexiones

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-01-a | El usuario puede crear una conexión especificando motor, host, puerto, usuario y contraseña | Must |
| RF-01-b | Las credenciales se almacenan cifradas (OS SecretStorage) | Must |
| RF-01-c | El usuario puede probar la conexión antes de guardar | Must |
| RF-01-d | El usuario puede eliminar una conexión (con confirmación) | Must |
| RF-01-e | **El usuario puede editar una conexión existente** | Must |
| RF-01-f | Las conexiones se reconectan automáticamente al abrir VS Code | Should |
| RF-01-g | El estado conectado/desconectado es visible en el árbol | Should |

#### RF-02 Exploración del esquema

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-02-a | El árbol muestra: conexión → base de datos → tablas → columnas (nombre + tipo) | Must |
| RF-02-b | Las vistas (views) se listan separadas de las tablas | Should |
| RF-02-c | Los stored procedures y funciones se listan y pueden abrirse | Should |
| RF-02-d | Para motores con schemas (PostgreSQL, SQL Server, Oracle), se agrupan por schema | Should |
| RF-02-e | El usuario puede refrescar el árbol manualmente | Must |

#### RF-03 Editor de queries

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-03-a | Editor de texto con resaltado de sintaxis SQL | Must |
| RF-03-b | Ejecutar query con Ctrl+Enter o botón Run | Must |
| RF-03-c | Cancelar query en ejecución | Should |
| RF-03-d | Autocompletado de tablas y columnas desde el schema activo | Should |
| RF-03-e | Historial de queries ejecutados por conexión/base de datos | Should |
| RF-03-f | Bookmarks: guardar y recuperar queries nombrados | Could |

#### RF-04 Visualización de resultados

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-04-a | Mostrar resultados en tabla con columnas y filas | Must |
| RF-04-b | Indicar número de filas y tiempo de ejecución | Must |
| RF-04-c | Paginación de resultados | Must |
| RF-04-d | Filtro de filas en tiempo real (búsqueda en cliente) | Should |
| RF-04-e | Ordenamiento por columna | Should |
| RF-04-f | Exportar resultados a CSV | Must |
| RF-04-g | Exportar resultados a JSON | Should |
| RF-04-h | Exportar resultados a Excel (.xlsx) | Could |
| RF-04-i | Exportar resultados a PDF | Could |

#### RF-05 Operaciones CRUD

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-05-a | Edición inline de celdas (click en celda) | Could |
| RF-05-b | Insertar fila a través de un formulario | Could |
| RF-05-c | Eliminar fila(s) seleccionadas | Could |
| RF-05-d | **Confirmación obligatoria antes de ejecutar DML destructivo** | Must |

#### RF-06 Utilidades

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-06-a | Ver DDL de una tabla | Should |
| RF-06-b | Abrir tabla (ejecuta SELECT * con LIMIT) | Must |
| RF-06-c | Abrir editor de queries por base de datos | Must |
| RF-06-d | Copiar fila como INSERT al clipboard | Could |

---

### 3.2 Requerimientos no funcionales

#### RNF-01 Seguridad

| ID | Requerimiento | Prioridad |
|---|---|---|
| RNF-01-a | Las contraseñas nunca se persisten en disco en texto plano | Must |
| RNF-01-b | El nonce de la CSP de la webview es criptográficamente seguro | Must |
| RNF-01-c | Las queries de metadatos usan parámetros, no interpolación de strings | Must |
| RNF-01-d | `trustServerCertificate` en SQL Server debe ser `false` por defecto | Should |
| RNF-01-e | Redis debe advertir al usuario antes de ejecutar comandos destructivos (`FLUSHALL`, `CONFIG SET`) | Should |

#### RNF-02 Rendimiento

| ID | Requerimiento | Prioridad |
|---|---|---|
| RNF-02-a | La carga del schema para autocompletado no bloquea el editor | Must |
| RNF-02-b | La carga de schema no dispara más de N consultas paralelas (N ≤ 8) | Should |
| RNF-02-c | Las escrituras de SQLite al disco son asíncronas (no bloquean el Extension Host) | Must |
| RNF-02-d | La paginación real (LIMIT/OFFSET en el servidor) debe implementarse para tablas > 10k filas | Should |

#### RNF-03 Compatibilidad

| ID | Requerimiento | Prioridad |
|---|---|---|
| RNF-03-a | Funciona en VS Code >= 1.85 (Windows, macOS, Linux) | Must |
| RNF-03-b | SQLite WASM se carga correctamente desde el `.vsix` empaquetado | Must |
| RNF-03-c | La extensión se activa en < 2 segundos (sin conexiones pendientes) | Should |

#### RNF-04 Calidad de código

| ID | Requerimiento | Prioridad |
|---|---|---|
| RNF-04-a | Tests unitarios para la lógica de cada adapter (al menos los 3 más usados) | Should |
| RNF-04-b | Logging estructurado de errores en un Output Channel de VS Code | Should |
| RNF-04-c | TypeScript strict mode sin errores ni `any` implícitos | Could |

#### RNF-05 Marketplace

| ID | Requerimiento | Prioridad |
|---|---|---|
| RNF-05-a | `README.md` con descripción, screenshots y guía de instalación | Must (para publicar) |
| RNF-05-b | `CHANGELOG.md` con historial de versiones | Should |
| RNF-05-c | Icono de extensión (128x128 PNG) | Should |
| RNF-05-d | Publisher registrado en VS Code Marketplace | Must (para publicar) |
| RNF-05-e | `"categories": ["Data Science"]` en `package.json` | Should |
| RNF-05-f | Campo `"license"` en `package.json` | Should |

---

## 4. Estado actual vs requerimientos

| Requerimiento | Estado | Notas |
|---|---|---|
| RF-01-a Crear conexión | ✅ | |
| RF-01-b Credenciales cifradas | ✅ | Migrado a SecretStorage |
| RF-01-c Probar conexión | ✅ | |
| RF-01-d Eliminar conexión | ✅ | |
| **RF-01-e Editar conexión** | ❌ | **Bloqueante** |
| RF-01-f Reconexión al arranque | ✅ | |
| RF-02-a Árbol schema | ✅ | |
| RF-02-c Procedures en árbol | ⚠️ | Se listan pero no se pueden abrir (BP-02) |
| RF-03-a Editor SQL | ✅ | CodeMirror 6 |
| RF-03-b Ejecutar query | ✅ | |
| RF-03-c Cancelar query | ✅ | |
| RF-03-d Autocompletado | ✅ | |
| RF-04-a Tabla de resultados | ✅ | |
| RF-04-c Paginación | ⚠️ | Client-side — no reduce carga del servidor |
| RF-04-f Export CSV | ✅ | |
| RF-05-d Confirmación DML | ❌ | **Bloqueante de seguridad** |
| RF-06-a Ver DDL | ✅ | |
| RNF-01-a Passwords cifradas | ✅ | |
| RNF-01-b Nonce CSP | ✅ | Usa `crypto.randomBytes` |
| RNF-02-b Concurrencia schema | ✅ | Limitada a 8 |
| RNF-02-c SQLite async | ❌ | `writeFileSync` síncrono |
| **RNF-03-b SQLite WASM en .vsix** | ❌ | **Crash garantizado (BP-03)** |
| RNF-04-a Tests | ❌ | No existe ningún test |
| RNF-05-a README | ❌ | No existe |
| RNF-05-d Publisher registrado | ❌ | Placeholder `"db-connection"` |

---

## 5. Backlog priorizado para llegar al MVP publicable

### Sprint 1 — Blockers (no se puede publicar sin esto)

| # | Tarea | Esfuerzo est. |
|---|---|---|
| S1-1 | Implementar "Editar conexión": reutilizar `AddConnectionPanel` con config pre-poblada | 4h |
| S1-2 | Corregir ruta WASM de SQLite usando `context.extensionUri` + copia al bundle en `esbuild.mjs` | 2h |
| S1-3 | Declarar `openProcedure` en `package.json` (commands + menu `viewItem == procedure`) | 30min |
| S1-4 | Agregar confirmación modal antes de DML destructivo | 2h |
| S1-5 | Escribir `README.md` con descripción, capturas y guía de uso | 3h |

### Sprint 2 — Calidad (importante pero no bloquea publicación)

| # | Tarea | Esfuerzo est. |
|---|---|---|
| S2-1 | Hacer `writeFileSync` asíncrono en SQLite (`fs.promises.writeFile`) | 15min |
| S2-2 | Paginación server-side para tablas grandes (agregar `LIMIT/OFFSET` forzado) | 3h |
| S2-3 | Output Channel para logging de errores de conexión | 1h |
| S2-4 | Agregar validación de nombre de BD en MySQL antes de interpolar en `USE \`…\`` | 1h |
| S2-5 | Registrar publisher en Marketplace y actualizar `package.json` | 1h |

### Sprint 3 — Valor agregado (post-MVP v0.2)

| # | Tarea | Esfuerzo est. |
|---|---|---|
| S3-1 | Tests unitarios para PostgresAdapter, MysqlAdapter, SqliteAdapter | 8h |
| S3-2 | Agrupar conexiones en carpetas/grupos definidos por el usuario | 4h |
| S3-3 | SSH tunneling (conexiones a BDs detrás de bastiones) | 6h |
| S3-4 | Multi-tab de resultados (varias queries abiertas en el mismo panel) | 4h |
| S3-5 | EXPLAIN / EXPLAIN ANALYZE integrado como comando | 3h |
| S3-6 | Soporte `.env` para importar cadenas de conexión del proyecto | 2h |

---

## 6. Evaluación de scope del MVP

### Motores que justifican el MVP

Los 8 motores actuales son excesivos para un MVP estricto, pero dado que ya están implementados, no tiene sentido eliminarlos. Lo que sí hay que decidir es cuáles tienen soporte **completo** (CRUD + DDL) vs soporte **básico** (solo lectura):

| Motor | Uso en mercado | Soporte actual | Prioridad |
|---|---|---|---|
| PostgreSQL | Muy alto | CRUD + DDL + procs | Core |
| MySQL / MariaDB | Muy alto | CRUD + DDL + procs | Core |
| SQLite | Alto | CRUD + DDL | Core |
| SQL Server | Alto | CRUD + DDL + procs | Core |
| Oracle | Medio | CRUD + DDL + procs | Extended |
| MongoDB | Medio | Solo queries | Extended |
| Redis | Bajo | Comandos directos | Extended |
| GraphQL | Bajo | Queries/mutations | Extended |

**Recomendación:** Documentar claramente qué operaciones son soportadas por motor. Los usuarios de MongoDB y Redis esperan comportamientos muy distintos a los de SQL.

---

## 7. Deuda técnica existente (de la auditoría de seguridad anterior)

Los siguientes hallazgos de la auditoría `AUDIT.md` (2026-05-22) siguen **abiertos**:

| ID original | Estado | Observación |
|---|---|---|
| SEC-01 Passwords en texto plano | ✅ Resuelto | Migrado a SecretStorage con auto-migración |
| SEC-03 Nonce CSP débil | ✅ Resuelto | Usa `crypto.randomBytes` |
| RES-01 Concurrencia schema | ✅ Resuelto | `withConcurrency` con límite 8 |
| BUG-01 autoRun descartado | ✅ Resuelto | `pendingInit` incluye `autoRun` |
| **SEC-04 SQL injection en SQLite/MSSQL** | ❌ Pendiente | Quote-escaping en metadatos aún vulnerable |
| **SEC-05 trustServerCertificate hardcodeado** | ⚠️ Parcial | `trustServerCertificate` añadido a `ConnectionConfig` pero valor en SqlServerAdapter por verificar |
| **SEC-07 MySQL backtick injection** | ❌ Pendiente | `USE \`${database}\`` sin validación |
| **RES-02 SQLite writeFileSync síncrono** | ❌ Pendiente | Sigue siendo síncrono |
| **BUG-02 WASM path en .vsix** | ❌ Pendiente | Hard crash al instalar extensión |
| MNT-02 Sin tests | ❌ Pendiente | Zero tests |

---

*Auditoría realizada por análisis estático sobre rama `main`. Los esfuerzos estimados asumen un desarrollador familiarizado con el codebase.*
