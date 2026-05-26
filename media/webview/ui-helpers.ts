export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function show(id: string): void {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}

export function hide(id: string): void {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}

export function showToast(msg: string): void {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('toast-visible');
  setTimeout(() => toast!.classList.remove('toast-visible'), 2000);
}

export function copyText(text: string, btn: HTMLElement): void {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent!;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = original; }, 1200);
  }).catch(() => {});
}

export function download(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

export function csvCell(val: string): string {
  return val.includes(',') || val.includes('"') || val.includes('\n')
    ? `"${val.replace(/"/g, '""')}"` : val;
}

export function closeCtxMenu(): void {
  document.getElementById('ctx-menu')?.remove();
}

export function quoteIdentifier(name: string, dbType: string): string {
  return dbType === 'mysql' ? `\`${name}\`` : `"${name}"`;
}
