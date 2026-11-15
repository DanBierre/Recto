// Bundle the renderer: one JS file, one CSS file (fonts copied next to it).
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const opts = {
  entryPoints: { app: 'src/app.js', styles: 'src/styles.css' },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome130',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  loader: { '.woff': 'file', '.woff2': 'file' },
  logLevel: 'warning',
};

if (watch) esbuild.context(opts).then(c => c.watch());
else esbuild.build(opts).catch(() => process.exit(1));
