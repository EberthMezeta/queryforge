# Pendientes — DB Connection Extension

## Alta prioridad (impacto en uso diario)

- [ ] **Ejecutar texto seleccionado** — si hay texto seleccionado en el editor, ejecutar solo esa porción (como DBeaver con F5/Ctrl+Enter sobre selección)
- [ ] **Múltiples statements** — ejecutar un bloque con varios queries separados por `;` y mostrar cada resultado por separado
- [ ] **Transacciones persistentes** — `BEGIN` → queries → `COMMIT`/`ROLLBACK` en la misma sesión (actualmente PostgreSQL crea una conexión nueva por query)
- [ ] **Cancelar query en ejecución** — botón o Ctrl+C para abortar una query que tarda demasiado

## Media prioridad (UX/productividad)

- [ ] **Historial de queries** — guardar las últimas N queries ejecutadas, navegables con flechas o panel lateral
- [ ] **Múltiples tabs de resultados** — poder tener varias queries abiertas al mismo tiempo en el mismo panel
- [ ] **Ver DDL de una tabla** — click derecho → "Ver DDL" para mostrar el CREATE TABLE/VIEW de la tabla seleccionada
- [X] **Stored Procedures y Functions** — carpeta "Procedures" en el árbol; click abre la definición en el editor
- [X] **Paginación de resultados** — para queries que devuelven miles de filas, cargar por páginas en lugar de todo en memoria
- [X] **Autocompletado con schema** — sugerencias en el editor con nombres de tablas y columnas del schema activo

## Baja prioridad / mejoras

- [ ] **Editar celdas inline** — click en una celda y editar su valor directamente (genera UPDATE automático)
- [X] **Queries guardadas / bookmarks** — guardar queries con nombre para reutilizarlas
- [X] **Exportar resultado filtrado** — aplicar filtro rápido en la tabla antes de exportar
- [ ] **Formato de query** — botón para formatear/indentar el SQL automáticamente
- [ ] **Soporte a múltiples schemas** (PostgreSQL/SQL Server) — actualmente asume `public`/`dbo`
- [ ] **Reconectar automáticamente** — si la conexión cae, intentar reconectar antes de lanzar error

## Bugs conocidos

- [X] **Transacciones PostgreSQL** — `BEGIN`/`COMMIT` no funcionan porque cada query usa una conexión efímera (`withDb`)
- [X] **SQLite es read-only** — `sql.js` carga el archivo en memoria; los cambios no se persisten al disco
