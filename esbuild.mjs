import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const baseConfig = {
  bundle: true,
  sourcemap: true,
  minify: !watch,
};

async function build() {
  // Extension bundle (Node.js / Electron)
  const extensionCtx = await esbuild.context({
    ...baseConfig,
    entryPoints: ['src/extension.ts'],
    outfile: 'out/extension.js',
    external: ['vscode', 'pg', 'mysql2', 'sql.js', 'mssql', 'oracledb', 'mongodb', 'redis'],
    format: 'cjs',
    platform: 'node',
    target: 'node20',
  });

  // Webview bundle (browser)
  const webviewCtx = await esbuild.context({
    ...baseConfig,
    entryPoints: ['media/webview/main.ts'],
    outfile: 'out/webview.js',
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
  });

  if (watch) {
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
    await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
    console.log('Build complete.');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
