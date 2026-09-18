#!/usr/bin/env node
/**
 * Rebuilds the Mix Nova design system's files from this repository.
 *
 *   node tools/design-system/build.mjs [--out DIR (default: tools/design-system/dist)] [--tokens FILE] [--full]
 *
 * Reads apps/web (globals.css, the ui components, the fonts, the brand SVGs) and
 * writes a `project/` tree the Design System artifact takes as its files:
 *
 *   project/tokens.json            token VALUES re-read from globals.css, merged onto
 *                                  --tokens (default content/tokens.json) so every usage
 *                                  note is kept; new variables are appended, vanished
 *                                  ones listed in report.json and left in place
 *   project/components/bundle.css  the mn-* kit rules, with the v2 flag mapped to the
 *                                  two v2 themes and the token blocks stripped
 *   project/components/bundle.js   apps/web/src/components/ui bundled as window.MixNova
 *   project/components/lib/*.js    React 18 (the previews' runtime)
 *   project/fonts/*, project/assets/Logos/*.svg   copied as they are
 *   --full also copies content/ (the brand book, guides, previews, types)
 *
 * report.json beside `project/` lists every file with its sha256 and the token changes,
 * so a publisher only sends what differs. Nothing here touches the repository or the
 * network beyond one `npm install` into tools/design-system/.deps (ignored by git).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const WEB = join(REPO, 'apps', 'web');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const OUT = resolve(opt('--out', join(HERE, 'dist')));
const TOKENS_IN = resolve(opt('--tokens', join(HERE, 'content', 'tokens.json')));
const FULL = args.includes('--full');
const PROJECT = join(OUT, 'project');

const ESBUILD = '0.24.2';
const REACT = '18.3.1';
const webPkg = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8'));
const LUCIDE = String(webPkg.dependencies['lucide-react']).replace(/^[\^~]/, '');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const put = (rel, data) => {
  const p = join(PROJECT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
};
const report = { ref: gitRef(), synced: new Date().toISOString(), tokens: { changed: [], added: [], missing: [], skipped: [] }, files: {} };

function gitRef() {
  try {
    const b = execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO }).toString().trim();
    const s = execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim();
    return `${b}@${s}`;
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------- 1. dependencies
function deps() {
  const dir = join(HERE, '.deps');
  const want = { esbuild: ESBUILD, 'lucide-react': LUCIDE, react: REACT, 'react-dom': REACT };
  const have = (name) => {
    const p = join(dir, 'node_modules', name, 'package.json');
    return existsSync(p) && JSON.parse(readFileSync(p, 'utf8')).version === want[name];
  };
  if (!Object.keys(want).every(have)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'design-system-deps', private: true }));
    const spec = Object.entries(want).map(([n, v]) => `${n}@${v}`).join(' ');
    console.log(`installing ${spec} into tools/design-system/.deps`);
    execSync(`npm install --no-audit --no-fund --no-package-lock ${spec}`, { cwd: dir, stdio: 'inherit' });
  }
  return createRequire(join(dir, 'node_modules', 'x.js'));
}

// ---------------------------------------------------------------- 2. tokens
const SCOPES = {
  ':root': 'root',
  ":root[data-theme='dark']": 'dark',
  ":root[data-ui='v2']": 'v2',
  ":root[data-ui='v2'][data-theme='dark']": 'v2dark',
};
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const norm = (v) => v.replace(/\s+/g, ' ').trim();

/** Every `--name: value` of the four theme scopes, last declaration winning, @media blocks excluded. */
function readVars(css) {
  const vars = { root: {}, dark: {}, v2: {}, v2dark: {} };
  const src = stripComments(css).replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = norm(m[1]).replace(/"/g, "'");
    const scope = SCOPES[sel];
    if (!scope) continue;
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[scope][d[1].slice(2)] = norm(d[2]);
  }
  return vars;
}
const isColor = (v) => /^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch|oklab|lab|lch|color)\([^()]*\))$/i.test(v);
const isVar = (v) => /^var\(--([\w-]+)(?:\s*,\s*.*)?\)$/.exec(v);
const family = (name) => {
  if (name.startsWith('mn-font-') || name === 'mn-gradient' || name === 'mn-rail') return 'skip';
  if (name.startsWith('mn-radius-')) return 'radius';
  if (name.startsWith('mn-space-')) return 'spacing';
  if (name.startsWith('mn-dur-')) return 'duration';
  if (name === 'mn-ease') return 'easing';
  if (/^mn-(shadow|glow|elev)-/.test(name)) return 'shadow';
  return 'color';
};
/** Per-theme value chain: what the app resolves under each theme (later scopes win on equal specificity). */
function themed(vars, name) {
  const r = vars.root[name], d = vars.dark[name], v = vars.v2[name], vd = vars.v2dark[name];
  return {
    light: r ?? v,
    dark: d ?? r ?? vd ?? v,
    'v2-light': v ?? r,
    'v2-dark': vd ?? v ?? d ?? r,
  };
}
function resolveShadow(vars, theme, value, depth = 0) {
  const m = isVar(value);
  if (!m || depth > 8) return value;
  const inner = themed(vars, m[1])[theme];
  return inner ? resolveShadow(vars, theme, inner, depth + 1) : value;
}
function buildTokens(css, base) {
  const vars = readVars(css);
  const names = new Set(Object.values(vars).flatMap((s) => Object.keys(s)));
  const tokens = structuredClone(base);
  const colorNames = new Set(tokens.color.tokens.map((t) => t.name));
  const byName = {};
  for (const fam of ['color', 'spacing', 'radius', 'shadow', 'duration', 'easing']) {
    tokens[fam] ??= { tokens: [] };
    for (const t of tokens[fam].tokens) byName[t.name] = { fam, t };
  }
  const seen = new Set();
  const setValue = (fam, name, value, usage) => {
    seen.add(name);
    const cur = byName[name];
    if (cur) {
      const before = JSON.stringify(cur.t.value);
      if (before !== JSON.stringify(value)) {
        cur.t.value = value;
        report.tokens.changed.push(name);
      }
    } else {
      const t = { name, value, usage: usage ?? `Added in code (${report.ref}); write a usage note.` };
      tokens[fam].tokens.push(t);
      byName[name] = { fam, t };
      report.tokens.added.push(name);
    }
  };
  for (const name of names) {
    const fam = family(name);
    if (fam === 'skip') continue;
    const tv = themed(vars, name);
    if (fam === 'radius') {
      const baseV = vars.root[name];
      const v2V = vars.v2[name] ?? vars.v2dark[name];
      if (baseV) setValue('radius', name, baseV);
      if (v2V && v2V !== baseV) setValue('radius', `${name}-v2`, v2V, `What ${name} becomes under the v2 finish.`);
      continue;
    }
    if (fam === 'spacing' || fam === 'duration' || fam === 'easing') {
      setValue(fam, name, tv['v2-light'] ?? tv.light);
      continue;
    }
    if (fam === 'shadow') {
      const value = {};
      for (const th of Object.keys(tv)) if (tv[th]) value[th] = resolveShadow(vars, th, tv[th]);
      setValue('shadow', name, value);
      continue;
    }
    // colour: hex/function literal, or an alias of another colour variable
    const value = {};
    let unsupported = false;
    for (const th of Object.keys(tv)) {
      const raw = tv[th];
      if (!raw) continue;
      const m = isVar(raw);
      if (m && (colorNames.has(m[1]) || names.has(m[1]))) value[th] = `{${m[1]}}`;
      else if (isColor(raw)) value[th] = raw.toLowerCase();
      else unsupported = true;
    }
    if (Object.keys(value).length === 0) {
      report.tokens.skipped.push(`${name} (no literal colour: ${tv.light ?? tv['v2-light']})`);
      continue;
    }
    if (unsupported && byName[name]) {
      // keep the existing values where the code uses color-mix()/gradients the format cannot hold
      const cur = byName[name].t.value;
      for (const th of Object.keys(tv)) if (!value[th] && typeof cur === 'object' && cur[th]) value[th] = cur[th];
      report.tokens.skipped.push(`${name} (kept existing value where the code uses color-mix/gradient)`);
    }
    // a token the code sets identically everywhere is written once, unless it already has per-theme values
    const allSame = new Set(Object.values(value)).size === 1 && Object.keys(value).length === 4;
    const perTheme = byName[name] && typeof byName[name].t.value === 'object';
    setValue('color', name, allSame && !perTheme ? value.light : value);
    colorNames.add(name);
  }
  for (const [name, { fam }] of Object.entries(byName)) {
    if (!seen.has(name) && !name.endsWith('-v2') && fam !== 'color') report.tokens.missing.push(name);
    if (!seen.has(name) && fam === 'color' && !['bg', 'panel', 'text', 'muted', 'brand', 'brand-contrast'].includes(name) && !name.endsWith('-v2')) report.tokens.missing.push(name);
  }
  tokens.meta = { ...(tokens.meta ?? {}), source: 'github', ref: report.ref, package: 'apps/web', synced: report.synced.slice(0, 10), producer: 'tools/design-system/build.mjs' };
  return tokens;
}

// ---------------------------------------------------------------- 3. bundle.css
const SHIM = `
/* ---- Static-preview shim: base-theme equivalents of the inline styles Card, StatCard,
   Table, Field and States render from React when the v2 flag is off. The v2 rules
   below out-specify these under the v2 themes exactly as they out-specify the inline
   styles in the app. ---- */
.mn-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--mn-border); }
.mn-card-title { margin: 0; font-size: 15px; font-family: var(--mn-font-display); font-weight: 600; letter-spacing: -0.01em; }
.mn-card-actions { display: flex; gap: 8px; }
.mn-card-body { padding: 18px; }
.mn-card-body--flush { padding: 0; }
.mn-stat { padding: 16px; min-width: 168px; height: 100%; display: grid; gap: 10px; }
.mn-stat-link { text-decoration: none; }
.mn-stat-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mn-stat-label { font-size: 11px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: var(--mn-muted); }
.mn-stat-chip { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; flex: 0 0 auto; background: var(--mn-purple-50); color: var(--mn-primary); }
.mn-stat-value { font-family: var(--mn-font-display); font-weight: 700; font-size: 26px; line-height: 1.05; color: var(--mn-text); }
.mn-stat[data-tone='success'] .mn-stat-value { color: var(--mn-success); }
.mn-stat[data-tone='warning'] .mn-stat-value { color: var(--mn-warning); }
.mn-stat[data-tone='danger'] .mn-stat-value { color: var(--mn-danger); }
.mn-stat[data-tone='info'] .mn-stat-value, .mn-stat[data-tone='processing'] .mn-stat-value { color: var(--mn-info); }
.mn-card.mn-stat--grad { background: var(--mn-gradient); border: none; color: #fff; }
.mn-card.mn-stat--grad .mn-stat-label { color: rgba(255, 255, 255, 0.85); }
.mn-card.mn-stat--grad .mn-stat-chip { background: rgba(255, 255, 255, 0.18); color: #fff; }
.mn-card.mn-stat--grad .mn-stat-value { color: #fff; }
`;
function buildCss(css) {
  const start = css.indexOf('* {\n  box-sizing');
  if (start < 0) throw new Error('globals.css: the component layer (`* { box-sizing`) was not found');
  let body = stripComments(css.slice(start))
    .replace(/:root\[data-ui='v2'\]\[data-theme='dark'\]/g, ":root[data-theme='v2-dark']")
    .replace(/:root\[data-ui='v2'\]/g, ":root[data-theme^='v2-']");
  // token blocks: keep only what tokens.css cannot carry (gradients, color-mix)
  const clean = (sel, decls) => {
    if (!/^\s*:root(\[[^\]]*\])*\s*$/.test(sel)) return `${sel}{${decls}}`;
    const kept = [...decls.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
      .filter((d) => /gradient\(|color-mix\(/.test(d[2]))
      .map((d) => `  ${d[1]}: ${norm(d[2])};`);
    return kept.length ? `${sel.trim()} {\n${kept.join('\n')}\n}` : '';
  };
  body = body.replace(/(@media[^{]*)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g, (_, at, inner) => `${at}{${inner.replace(/([^{}]*)\{([^{}]*)\}/g, (__, s, d) => clean(s, d))}}`);
  body = body.replace(/([^{}]*)\{([^{}]*)\}/g, (_, s, d) => clean(s, d));
  body = body.replace(/\n\s*\n(\s*\n)+/g, '\n\n').trim() + '\n';
  const head = `/* Mix Nova — component stylesheet.
   Generated by tools/design-system/build.mjs from apps/web/src/app/globals.css (the mn-* kit).
   Token values live in tokens.json → tokens.css; this file holds only the component rules plus
   the few custom properties tokens cannot express (gradients, color-mix). The source gates its
   "Deep Violet Matte" finish behind <html data-ui="v2">; here that finish follows the two v2
   themes (data-theme="v2-light" / "v2-dark") instead. */
:root {
  --mn-font-display: var(--font-display);
  --mn-font-body: var(--font-body);
  --mn-gradient: linear-gradient(135deg, #6c2bd9 0%, #8a4fff 100%);
}
:root[data-theme^='v2-'] {
  --mn-font-display: var(--font-display-v2);
  --mn-radius-sm: var(--mn-radius-sm-v2);
  --mn-radius-md: var(--mn-radius-md-v2);
  --mn-radius-lg: var(--mn-radius-lg-v2);
}
/* Reduced motion collapses the motion tokens (source: :root[data-ui='v2'] block). */
@media (prefers-reduced-motion: reduce) {
  :root {
    --mn-dur-micro: 0.01ms;
    --mn-dur-std: 0.01ms;
    --mn-dur-drawer: 0.01ms;
  }
}
${SHIM}
`;
  const out = head + body;
  if (/<\/style/i.test(out)) throw new Error('bundle.css would contain </style');
  return out;
}

// ---------------------------------------------------------------- 4. bundle.js
async function buildJs(req) {
  const src = join(OUT, '.src');
  rmSync(src, { recursive: true, force: true });
  mkdirSync(join(src, 'src', 'ui'), { recursive: true });
  mkdirSync(join(src, 'src', 'lib'), { recursive: true });
  const uiDir = join(WEB, 'src', 'components', 'ui');
  for (const f of readdirSync(uiDir)) if (f.endsWith('.tsx')) copyFileSync(join(uiDir, f), join(src, 'src', 'ui', f));
  copyFileSync(join(WEB, 'src', 'components', 'OfflineBanner.tsx'), join(src, 'src', 'OfflineBanner.tsx'));
  for (const f of ['use-focus-trap.ts', 'use-online.ts']) copyFileSync(join(WEB, 'src', 'lib', f), join(src, 'src', 'lib', f));
  copyFileSync(join(HERE, 'shims', 'ui-flag.js'), join(src, 'src', 'lib', 'ui-flag.js'));
  copyFileSync(join(HERE, 'entry.tsx'), join(src, 'entry.tsx'));
  // the copies import the app's lib one level shallower than in the app
  for (const f of readdirSync(join(src, 'src', 'ui'))) {
    const p = join(src, 'src', 'ui', f);
    writeFileSync(p, readFileSync(p, 'utf8').replace(/'\.\.\/\.\.\/lib\//g, "'../lib/"));
  }
  const ob = join(src, 'src', 'OfflineBanner.tsx');
  writeFileSync(ob, readFileSync(ob, 'utf8').replace(/'\.\.\/lib\//g, "'./lib/"));
  // Logo: let a page hand the lockup files in (data: URIs) instead of probing /brand/ over the network
  const logo = join(src, 'src', 'ui', 'Logo.tsx');
  let ls = readFileSync(logo, 'utf8');
  const before = ls;
  ls = ls
    .replace(
      /const LIGHT = (\[[^\]]*\]);\nconst DARK = (\[[^\]]*\]);/,
      (_, l, d) =>
        `type BrandSrc = { light?: string[]; dark?: string[] };\n` +
        `const brand = (): BrandSrc => (typeof window !== 'undefined' && (window as unknown as { MixNovaBrand?: BrandSrc }).MixNovaBrand) || {};\n` +
        `const lightSrc = () => brand().light ?? ${l};\n` +
        `const darkSrc = () => brand().dark ?? ${d.replace('...LIGHT', '...lightSrc()')};`,
    )
    .replace('const candidates = onDark ? DARK : LIGHT;', 'const candidates = onDark ? darkSrc() : lightSrc();');
  if (ls === before || /\bLIGHT\b/.test(ls)) throw new Error('Logo.tsx changed shape: the MixNovaBrand hook could not be applied; update build.mjs');
  writeFileSync(logo, ls);

  const esbuild = req('esbuild');
  const r = await esbuild.build({
    entryPoints: [join(src, 'entry.tsx')],
    bundle: true,
    format: 'iife',
    globalName: 'MixNova',
    minify: true,
    platform: 'browser',
    target: 'es2019',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    inject: [join(HERE, 'shims', 'inject.js')],
    alias: { react: join(HERE, 'shims', 'react.js'), 'react-dom': join(HERE, 'shims', 'react-dom.js'), 'next/link': join(HERE, 'shims', 'next-link.js') },
    nodePaths: [join(HERE, '.deps', 'node_modules')],
    define: { 'process.env.NODE_ENV': '"production"' },
    write: false,
    logLevel: 'warning',
  });
  let js = r.outputFiles[0].text;
  if (/<\/script/i.test(js) || js.includes('<!--')) throw new Error('bundle.js would contain </script or <!--');
  const names = ['Logo', 'Button', 'Card', 'Badge', 'StatusBadge', 'Field', 'Input', 'Select', 'StatCard', 'Table', 'Th', 'Td', 'Loading', 'Skeleton', 'TableSkeleton', 'EmptyState', 'ErrorState', 'PermissionDenied', 'ThemeToggle', 'Surface', 'CommandBar', 'Toolbar', 'FilterBar', 'SearchInput', 'SummaryStrip', 'AlertSurface', 'Drawer', 'Dialog', 'ConfirmProvider', 'Form', 'OfflineBanner'];
  js = `/* @ds-bundle: ${JSON.stringify({ format: 4, namespace: 'MixNova', components: names.map((name) => ({ name })) })} */\n` + js;
  rmSync(src, { recursive: true, force: true });
  return js;
}

// ---------------------------------------------------------------- 5. run
async function main() {
  rmSync(PROJECT, { recursive: true, force: true });
  mkdirSync(PROJECT, { recursive: true });
  const req = deps();
  const css = readFileSync(join(WEB, 'src', 'app', 'globals.css'), 'utf8');
  const base = JSON.parse(readFileSync(TOKENS_IN, 'utf8'));

  put('tokens.json', JSON.stringify(buildTokens(css, base), null, 1) + '\n');
  put('components/bundle.css', buildCss(css));
  put('components/bundle.js', await buildJs(req));
  for (const lib of ['react', 'react-dom']) {
    put(`components/lib/${lib}.production.min.js`, readFileSync(join(HERE, '.deps', 'node_modules', lib, 'umd', `${lib}.production.min.js`)));
  }
  const fonts = join(WEB, 'src', 'app', 'fonts');
  for (const f of readdirSync(fonts)) if (/\.(woff2?|ttf|otf)$/.test(f)) put(`fonts/${f}`, readFileSync(join(fonts, f)));
  const brand = join(WEB, 'public', 'brand');
  for (const f of readdirSync(brand)) if (/\.(svg|png)$/.test(f)) put(`assets/Logos/${f}`, readFileSync(join(brand, f)));
  if (FULL) copyTree(join(HERE, 'content'), PROJECT);

  walk(PROJECT, (p) => (report.files[relative(OUT, p).split('\\').join('/')] = sha(readFileSync(p))));
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
  const t = report.tokens;
  console.log(`built ${Object.keys(report.files).length} files into ${relative(process.cwd(), OUT) || '.'} at ${report.ref}`);
  console.log(`tokens: ${t.changed.length} changed, ${t.added.length} added, ${t.missing.length} no longer in code, ${t.skipped.length} skipped`);
  for (const k of ['changed', 'added', 'missing', 'skipped']) if (t[k].length) console.log(`  ${k}: ${t[k].join(', ')}`);
}
function walk(dir, fn) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, fn);
    else fn(p);
  }
}
function copyTree(from, to) {
  if (!existsSync(from)) return;
  walk(from, (p) => {
    const rel = relative(from, p);
    mkdirSync(dirname(join(to, rel)), { recursive: true });
    copyFileSync(p, join(to, rel));
  });
}
main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
