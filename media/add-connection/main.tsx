import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';

// ── Types ──────────────────────────────────────────────────────────────────────

type DbType = 'mysql' | 'postgres' | 'mssql' | 'oracle' | 'mongodb' | 'redis' | 'sqlite' | 'graphql';

interface ConnectionConfig {
  id?: string;
  name: string;
  type: DbType;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  serviceName?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  filename?: string;
  url?: string;
  headers?: Record<string, string>;
}

type Status = { msg: string; ok: boolean | null } | null;
type Errors = Partial<Record<keyof ConnectionConfig | 'headers', string>>;

// ── VSCode bridge ──────────────────────────────────────────────────────────────

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_PORTS: Partial<Record<DbType, number>> = {
  mysql: 3306, postgres: 5432, mssql: 1433,
  oracle: 1521, mongodb: 27017, redis: 6379,
};

const DB_CARDS: Array<{ type: DbType; label: string; abbr: string; color: string }> = [
  { type: 'mysql',    label: 'MySQL',      abbr: 'My',  color: 'linear-gradient(135deg,#c97000,#e8a000)' },
  { type: 'postgres', label: 'PostgreSQL', abbr: 'Pg',  color: 'linear-gradient(135deg,#1e5276,#336791)' },
  { type: 'mssql',    label: 'SQL Server', abbr: 'SS',  color: 'linear-gradient(135deg,#8b0000,#c0392b)' },
  { type: 'oracle',   label: 'Oracle',     abbr: 'Or',  color: 'linear-gradient(135deg,#a02010,#c74634)' },
  { type: 'mongodb',  label: 'MongoDB',    abbr: 'Mo',  color: 'linear-gradient(135deg,#1a6b3c,#13aa52)' },
  { type: 'redis',    label: 'Redis',      abbr: 'Re',  color: 'linear-gradient(135deg,#8b1a10,#d82c20)' },
  { type: 'sqlite',   label: 'SQLite',     abbr: 'SL',  color: 'linear-gradient(135deg,#0a5fa0,#1a8fe0)' },
  { type: 'graphql',  label: 'GraphQL',    abbr: 'GQL', color: 'linear-gradient(135deg,#9b006a,#e10098)' },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function validate(cfg: Partial<ConnectionConfig>, headersRaw: string): Errors {
  const e: Errors = {};
  if (!cfg.name?.trim()) e.name = 'Required';
  if (cfg.type === 'sqlite' && !cfg.filename?.trim()) e.filename = 'Required';
  if (cfg.type === 'graphql') {
    if (!cfg.url?.trim()) e.url = 'Required';
    if (headersRaw.trim()) {
      try { JSON.parse(headersRaw); } catch { e.headers = 'Must be valid JSON'; }
    }
  }
  return e;
}

function buildPreview(cfg: Partial<ConnectionConfig>): string {
  const { type, host = '127.0.0.1', port, user, database, serviceName, url, filename } = cfg;
  if (!type) return '';
  if (type === 'sqlite')  return filename || '';
  if (type === 'graphql') return url || '';
  const p = port || DEFAULT_PORTS[type] || 3306;
  const u = user ? `${encodeURIComponent(user)}@` : '';
  const db = database ? `/${database}` : '';
  if (type === 'oracle')  return `oracle://${u}${host}:${p}/${serviceName || 'XEPDB1'}`;
  if (type === 'redis')   return `redis://${host}:${p}`;
  return `${type}://${u}${host}:${p}${db}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Field({ label, error, children }: {
  label: JSX.Element | string;
  error?: string;
  children: JSX.Element;
}) {
  return (
    <div class="form-group">
      <label>{label}</label>
      {children}
      {error && <span class="field-error">{error}</span>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

function ConnectionForm() {
  const [cfg, setCfg] = useState<Partial<ConnectionConfig>>({
    type: 'mysql', host: '127.0.0.1', port: 3306, name: '',
  });
  const [headersRaw, setHeadersRaw] = useState('');
  const [status,  setStatus]        = useState<Status>(null);
  const [loading, setLoading]       = useState(false);
  const [errors,  setErrors]        = useState<Errors>({});
  const [touched, setTouched]       = useState(false);

  const isEdit = Boolean(cfg.id);

  // Re-validate live after first submit attempt
  useEffect(() => {
    if (touched) setErrors(validate(cfg, headersRaw));
  }, [cfg, headersRaw, touched]);

  // Host ↔ webview messages
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const msg = e.data as Record<string, unknown>;
      if (msg.type === 'loadConfig') {
        const c = msg.config as ConnectionConfig;
        setCfg(c);
        setHeadersRaw(c.headers ? JSON.stringify(c.headers, null, 2) : '');
        setStatus(null);
        setErrors({});
        setTouched(false);
      }
      if (msg.type === 'testResult') {
        setLoading(false);
        setStatus({ msg: msg.message as string, ok: msg.success as boolean });
      }
      if (msg.type === 'saveResult') {
        setLoading(false);
        setStatus({ msg: msg.message as string, ok: false });
      }
      if (msg.type === 'filePicked') {
        setCfg(c => ({ ...c, filename: msg.path as string }));
        setErrors(e => { const n = { ...e }; delete n.filename; return n; });
      }
    }
    window.addEventListener('message', onMsg);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMsg);
  }, []);

  function set<K extends keyof ConnectionConfig>(key: K, value: ConnectionConfig[K]) {
    setCfg(c => ({ ...c, [key]: value }));
    setStatus(null);
  }

  function selectType(type: DbType) {
    setCfg(c => ({ ...c, type, port: DEFAULT_PORTS[type] ?? c.port }));
    setStatus(null);
    setErrors({});
  }

  function getFullConfig(): ConnectionConfig | null {
    setTouched(true);
    const errs = validate(cfg, headersRaw);
    if (Object.keys(errs).length) { setErrors(errs); return null; }
    const full = { ...cfg } as ConnectionConfig;
    if (cfg.type === 'graphql' && headersRaw.trim()) {
      full.headers = JSON.parse(headersRaw) as Record<string, string>;
    }
    return full;
  }

  function handleTest() {
    const c = getFullConfig();
    if (!c) return;
    setLoading(true);
    setStatus({ msg: 'Testing connection…', ok: null });
    vscode.postMessage({ type: 'testConnection', config: c });
  }

  function handleSave(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    const c = getFullConfig();
    if (!c) return;
    setLoading(true);
    setStatus({ msg: isEdit ? 'Saving changes…' : 'Connecting and saving…', ok: null });
    vscode.postMessage({ type: 'saveConnection', config: c });
  }

  const type     = cfg.type ?? 'mysql';
  const isServer = type !== 'sqlite' && type !== 'graphql';
  const isOracle = type === 'oracle';
  const isMssql  = type === 'mssql';
  const isRedis  = type === 'redis';
  const preview  = buildPreview(cfg);

  return (
    <div class="container">
      <h2>{isEdit ? `Edit: ${cfg.name || ''}` : 'Add Connection'}</h2>

      <div class="db-types">
        {DB_CARDS.map(card => (
          <div
            key={card.type}
            class={`db-card${type === card.type ? ' selected' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => selectType(card.type)}
            onKeyDown={e => e.key === 'Enter' && selectType(card.type)}
          >
            <div class="db-logo" style={{ background: card.color }}>{card.abbr}</div>
            <span class="db-name">{card.label}</span>
          </div>
        ))}
      </div>

      <form onSubmit={handleSave} noValidate>
        <Field label="Connection Name" error={errors.name}>
          <input
            type="text" value={cfg.name ?? ''} placeholder="My Database"
            autocomplete="off" class={errors.name ? 'input-error' : ''}
            onInput={e => set('name', (e.target as HTMLInputElement).value)}
          />
        </Field>

        {isServer && <>
          <div class="row">
            <Field label="Host">
              <input type="text" value={cfg.host ?? '127.0.0.1'} autocomplete="off"
                onInput={e => set('host', (e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="Port">
              <input type="number" value={String(cfg.port ?? DEFAULT_PORTS[type] ?? 3306)}
                min={1} max={65535}
                onInput={e => set('port', parseInt((e.target as HTMLInputElement).value, 10))} />
            </Field>
          </div>

          {!isRedis && (
            <Field label="Username">
              <input type="text" value={cfg.user ?? ''} autocomplete="off"
                placeholder={isMssql ? 'sa' : 'root'}
                onInput={e => set('user', (e.target as HTMLInputElement).value)} />
            </Field>
          )}

          <Field label="Password">
            <input type="password" value={cfg.password ?? ''} autocomplete="new-password"
              placeholder="••••••••"
              onInput={e => set('password', (e.target as HTMLInputElement).value)} />
          </Field>

          {!isOracle && !isRedis && (
            <Field label={<>Database <span>(optional)</span></>}>
              <input type="text" value={cfg.database ?? ''} autocomplete="off"
                placeholder={isMssql ? 'master' : ''}
                onInput={e => set('database', (e.target as HTMLInputElement).value)} />
            </Field>
          )}

          {isOracle && (
            <Field label="Service Name">
              <input type="text" value={cfg.serviceName ?? 'XEPDB1'} placeholder="XEPDB1"
                autocomplete="off"
                onInput={e => set('serviceName', (e.target as HTMLInputElement).value)} />
            </Field>
          )}

          {isMssql && <>
            <label class="checkbox-row">
              <input type="checkbox" checked={cfg.encrypt ?? false}
                onChange={e => set('encrypt', (e.target as HTMLInputElement).checked)} />
              Encrypt connection (Azure SQL)
            </label>
            <label class="checkbox-row">
              <input type="checkbox" checked={cfg.trustServerCertificate ?? false}
                onChange={e => set('trustServerCertificate', (e.target as HTMLInputElement).checked)} />
              Trust server certificate{' '}
              <span style={{ opacity: '0.6' }}>(self-signed / dev only)</span>
            </label>
          </>}
        </>}

        {type === 'sqlite' && (
          <Field label="File Path" error={errors.filename}>
            <div class="input-row">
              <input type="text" value={cfg.filename ?? ''}
                placeholder="/path/to/database.db" autocomplete="off"
                class={errors.filename ? 'input-error' : ''}
                onInput={e => set('filename', (e.target as HTMLInputElement).value)} />
              <button type="button" class="btn btn-secondary"
                onClick={() => vscode.postMessage({ type: 'browse' })}>
                Browse…
              </button>
            </div>
          </Field>
        )}

        {type === 'graphql' && <>
          <Field label="Endpoint URL" error={errors.url}>
            <input type="text" value={cfg.url ?? ''}
              placeholder="https://api.example.com/graphql" autocomplete="off"
              class={errors.url ? 'input-error' : ''}
              onInput={e => set('url', (e.target as HTMLInputElement).value)} />
          </Field>
          <Field label={<>Headers <span>(optional JSON)</span></>} error={errors.headers}>
            <textarea
              value={headersRaw}
              placeholder={'{"Authorization": "Bearer token"}'}
              class={errors.headers ? 'input-error' : ''}
              onInput={e => setHeadersRaw((e.target as HTMLTextAreaElement).value)}
            />
          </Field>
        </>}

        {preview && (
          <div class="conn-preview">
            <span class="preview-label">Preview</span>
            <code class="preview-val">{preview}</code>
          </div>
        )}

        <div class="actions">
          {status && (
            <div class={`status${status.ok === true ? ' ok' : status.ok === false ? ' err' : ''}`}>
              {status.msg}
            </div>
          )}
          <div class="action-btns">
            <button type="button" class="btn btn-secondary" disabled={loading} onClick={handleTest}>
              Test Connection
            </button>
            <button type="submit" class="btn btn-primary" disabled={loading}>
              {isEdit ? 'Save Changes' : 'Save Connection'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

render(<ConnectionForm />, document.getElementById('root')!);
