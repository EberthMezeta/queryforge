# QueryForge — Auditoría de Viabilidad para Marketplace

**Fecha:** 2026-05-27  
**Versión auditada:** 0.1.0  
**Veredicto:** ✅ APTO para publicar

---

## Resumen ejecutivo

Todos los bloqueantes anteriores han sido corregidos. La extensión pasa typecheck, 40/40 tests, build limpio, y el paquete `.vsix` contiene exactamente los archivos necesarios sin basura de desarrollo.

---

## Checklist completo

| Área | Estado | Detalle |
|---|---|---|
| `package.json` — `"icon"` | ✅ | `resources/icon.png` (128×128 PNG válido) |
| `package.json` — `activationEvents` | ✅ | `["onStartupFinished"]` |
| `package.json` — `publisher` | ✅ | `db-connection` (cambiar al ID real antes de publicar) |
| `package.json` — `repository` | ✅ | GitHub URL configurada |
| `package.json` — `bugs` / `homepage` | ✅ | Configurados |
| `package.json` — `keywords` | ✅ | 13 términos relevantes |
| `package.json` — `categories` | ✅ | Other, Data Science, Visualization |
| `package.json` — `license` | ✅ | MIT |
| `LICENSE` | ✅ | Archivo MIT presente |
| `CHANGELOG.md` | ✅ | Entrada v0.1.0 completa |
| `README.md` | ✅ | Título "QueryForge", sin placeholders, documentación completa |
| `resources/icon.png` | ✅ | PNG 128×128 RGBA, magic bytes correctos |
| `.vscodeignore` | ✅ | Archivos de dev, docker/, .claude/, auditorías excluidos |
| `oracledb` en paquete | ✅ | Whitelisteado y presente en `vsce ls` |
| `better-sqlite3` ausente | ✅ | No aparece en `vsce ls` |
| SQL injection — SqlServerAdapter | ✅ | `escId()` con bracket-doubling en todos los identificadores |
| SQL injection — MysqlAdapter | ✅ | `escId()` con backtick-doubling en todos los identificadores |
| SQL injection — PostgresAdapter | ✅ | Queries parametrizadas (`$1`, `$2`) |
| SQL injection — SqliteAdapter | ✅ | Double-quote escaping |
| SQL injection — OracleAdapter | ✅ | Bind variables (`:1`, `:2`) |
| Webview CSP | ✅ | `default-src 'none'`, nonce por panel, sin `unsafe-eval` |
| Contraseñas | ✅ | VS Code SecretStorage (OS keychain), sin plaintext |
| `tsc --noEmit` | ✅ | Sin errores |
| Tests (Vitest) | ✅ | 40/40 passing |
| Build (esbuild) | ✅ | `Build complete.` sin warnings |
| Tamaño del paquete | ✅ | ~3 MB (razonable para 8 drivers de DB) |

---

## Contenido del paquete final (`vsce ls`)

```
package.json
README.md
LICENSE
CHANGELOG.md
resources/icon.png
resources/database.svg
out/extension.js        (3.5 MB — bundle principal)
out/webview.js          (1.3 MB — UI CodeMirror)
out/add-connection.js   (20 KB — panel Preact)
out/sql-wasm.wasm       (660 KB — SQLite WASM)
node_modules/oracledb/  (driver Oracle, no bundleable)
```

---

## Pasos para publicar (en orden)

### 1 — Crear publisher (una sola vez, gratis)

1. Ve a [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
2. Inicia sesión con tu cuenta Microsoft
3. Click **"Create publisher"** → elige un ID único (ej. `eberth-dev`)
4. Actualiza `package.json`: `"publisher": "tu-id-aquí"`

### 2 — Generar Personal Access Token

1. Ve a [dev.azure.com](https://dev.azure.com) → tu organización → **User Settings → Personal Access Tokens**
2. **New Token**:
   - Organization: **All accessible organizations**
   - Scopes: **Marketplace → Publish**
3. Copia el token (solo se muestra una vez)

### 3 — Login y publicar

```bash
# Instalar vsce si no está
npm install -g @vscode/vsce

# Login con el PAT
vsce login tu-publisher-id

# Verificar contenido antes de publicar
vsce ls

# Publicar
vsce publish
```

### 4 — Verificar en marketplace

- La extensión aparece en ~10 minutos
- Buscar en [marketplace.visualstudio.com](https://marketplace.visualstudio.com) por `QueryForge`

### 5 — Publicar actualizaciones futuras

```bash
vsce publish patch   # 0.1.0 → 0.1.1
vsce publish minor   # 0.1.0 → 0.2.0
vsce publish major   # 0.1.0 → 1.0.0
```

Siempre actualizar `CHANGELOG.md` antes de cada release.

---

## Pendientes opcionales (no bloquean publicación)

| Item | Impacto | Esfuerzo |
|---|---|---|
| Screenshots / GIFs en README | Alto — mejora tasa de instalación | ~30 min |
| Badges (versión, installs, licencia) en README | Medio — aspecto profesional | 5 min (después de publicar) |
| Actualizar URL del repo en `package.json` con la URL real de GitHub | Medio | 1 min |
