/* Static verification.
 *
 * Exists because v0.1.0 shipped with every stylesheet 404ing: boot.js lives
 * in src/, so `new URL('.', import.meta.url)` resolved to .../src/ and the
 * CSS was requested at src/styles/telegram.css. Nothing loaded, and the bug
 * was invisible without a browser.
 *
 * This resolves every asset reference the way a browser would, against a
 * simulated install path, and fails if the target is not on disk.
 *
 *   node tools/verify.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath, URL as NodeURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* Where SillyTavern actually mounts a third-party extension. */
const MOUNT = 'http://st/scripts/extensions/third-party/st-telegram/';

const problems = [];
const checked = [];

function fail(msg) {
    problems.push(msg);
}

/* Map a resolved http URL back to a path inside the repo. */
function toDisk(url) {
    if (!url.href.startsWith(MOUNT)) return null;
    return join(ROOT, decodeURIComponent(url.href.slice(MOUNT.length).split('?')[0]));
}

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        if (entry === '.git' || entry === 'node_modules') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else out.push(full);
    }
    return out;
}

const files = walk(ROOT);

/* ── 1. manifest points at a file that exists ───────────────────────────── */

const manifestPath = join(ROOT, 'manifest.json');
if (!existsSync(manifestPath)) {
    fail('manifest.json is missing');
} else {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = join(ROOT, manifest.js);
    checked.push(`manifest.js -> ${manifest.js}`);
    if (!existsSync(entry)) fail(`manifest.js points at "${manifest.js}" which does not exist`);

    /* The loader filename must carry the version, otherwise SillyTavern
       serves a cached copy of the previous release forever. */
    if (!manifest.js.includes(manifest.version)) {
        fail(`manifest.js "${manifest.js}" does not contain version "${manifest.version}"; `
            + 'a new loader filename per release is the only reliable cache bust');
    }
}

/* ── 2. every JS import resolves ────────────────────────────────────────── */

for (const file of files.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))) {
    if (file.includes(`${ROOT}/tools/`)) continue;
    const src = readFileSync(file, 'utf8');
    const moduleUrl = new NodeURL(relative(ROOT, file).split('\\').join('/'), MOUNT);

    /* static + dynamic imports of relative paths */
    const specs = [...src.matchAll(/\bimport\s*\(?\s*['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of specs) {
        const resolved = new NodeURL(spec, moduleUrl);
        const disk = toDisk(resolved);
        checked.push(`${relative(ROOT, file)} imports ${spec}`);
        if (!disk || !existsSync(disk)) {
            fail(`${relative(ROOT, file)}: import "${spec}" resolves to ${resolved.pathname} which does not exist`);
        }
    }

    /* new URL('...', import.meta.url) — the exact construct that broke */
    const urlCalls = [...src.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z_$][\w$]*|import\.meta\.url)/g)];
    for (const [, spec, baseExpr] of urlCalls) {
        /* Only import.meta.url can be resolved statically; a variable base
           is checked separately below via the exported constant. */
        if (baseExpr !== 'import.meta.url') continue;
        const resolved = new NodeURL(spec, moduleUrl);
        const disk = toDisk(resolved);
        checked.push(`${relative(ROOT, file)}: new URL(${spec}, import.meta.url)`);
        if (!disk || !existsSync(disk)) {
            fail(`${relative(ROOT, file)}: new URL("${spec}", import.meta.url) resolves to `
                + `${resolved.pathname} which does not exist`);
        }
    }
}

/* ── 3. the stylesheet base actually points at the styles folder ────────── */

/* boot.js computes one base URL and every asset hangs off it, so verify it
   explicitly rather than trusting the regex above to have caught it. */
const bootPath = join(ROOT, 'src/boot.js');
if (existsSync(bootPath)) {
    const boot = readFileSync(bootPath, 'utf8');
    const baseMatch = /const TG_BASE = new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/.exec(boot);
    if (!baseMatch) {
        fail('src/boot.js: could not find the TG_BASE definition to verify');
    } else {
        const bootUrl = new NodeURL('src/boot.js', MOUNT);
        const base = new NodeURL(baseMatch[1], bootUrl);
        const styleMatch = /new URL\(\s*['"]([^'"]+\.css)['"]\s*,\s*TG_BASE\s*\)/.exec(boot);
        const styleRel = styleMatch ? styleMatch[1] : 'styles/telegram.css';
        const styleUrl = new NodeURL(styleRel, base);
        const disk = toDisk(styleUrl);
        checked.push(`TG_BASE -> ${base.pathname}`);
        checked.push(`stylesheet -> ${styleUrl.pathname}`);
        if (!disk || !existsSync(disk)) {
            fail(`src/boot.js: stylesheet resolves to ${styleUrl.pathname} which does not exist on disk`);
        }
    }
}

/* ── 4. every CSS @import and url() resolves ────────────────────────────── */

for (const file of files.filter((f) => f.endsWith('.css'))) {
    const src = readFileSync(file, 'utf8');
    const cssUrl = new NodeURL(relative(ROOT, file).split('\\').join('/'), MOUNT);

    const imports = [...src.matchAll(/@import\s+url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
    for (const spec of imports) {
        if (/^(https?:)?\/\//.test(spec)) continue;
        const resolved = new NodeURL(spec, cssUrl);
        const disk = toDisk(resolved);
        checked.push(`${relative(ROOT, file)} @imports ${spec}`);
        if (!disk || !existsSync(disk)) {
            fail(`${relative(ROOT, file)}: @import "${spec}" resolves to ${resolved.pathname} which does not exist`);
        }
    }

    /* url() references to local assets: icons, fonts, images. data: URIs and
       remote URLs are skipped. */
    const urls = [...src.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
    for (const spec of urls) {
        if (spec.startsWith('data:') || /^(https?:)?\/\//.test(spec)) continue;
        if (imports.includes(spec)) continue;
        const resolved = new NodeURL(spec, cssUrl);
        const disk = toDisk(resolved);
        checked.push(`${relative(ROOT, file)} url(${spec})`);
        if (!disk || !existsSync(disk)) {
            fail(`${relative(ROOT, file)}: url("${spec}") resolves to ${resolved.pathname} which does not exist`);
        }
    }
}

/* ── 5. no top-level await in the entry graph ───────────────────────────── */

/* TauriTavern and older WebViews choke on top-level await in a dynamically
   imported module; the extension silently never initialises.

   The first version of this check matched /^\s*await\s/m, which flags EVERY
   await in the file -- including the ones inside async functions, where they
   are perfectly legal. It reported a false failure for years. The real
   question is whether an await sits at module scope, so strip comments and
   strings, then walk the source tracking brace/paren/bracket depth and only
   flag an await found at depth 0. Awaits inside a top-level `if`/`for` block
   would slip through, but nothing in this codebase writes one and the check
   is meant to catch the accidental `const x = await init()` at the bottom of
   a module, which is always at depth 0. */
function stripLiterals(src) {
    let out = '';
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        const next = src[i + 1];
        if (c === '/' && next === '/') {
            while (i < src.length && src[i] !== '\n') i += 1;
            continue;
        }
        if (c === '/' && next === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
            i += 2;
            continue;
        }
        if (c === '"' || c === '\'' || c === '`') {
            i += 1;
            while (i < src.length && src[i] !== c) {
                if (src[i] === '\\') i += 1;
                i += 1;
            }
            i += 1;
            out += '""';
            continue;
        }
        out += c;
        i += 1;
    }
    return out;
}

for (const name of ['index.js', 'src/boot.js', 'src/theme.js', 'src/chat.js', 'src/settings.js']) {
    const path = join(ROOT, name);
    if (!existsSync(path)) continue;
    const src = stripLiterals(readFileSync(path, 'utf8'));

    let depth = 0;
    for (let i = 0; i < src.length; i += 1) {
        const c = src[i];
        if (c === '{' || c === '(' || c === '[') depth += 1;
        else if (c === '}' || c === ')' || c === ']') depth -= 1;
        else if (depth === 0 && c === 'a' && src.startsWith('await', i)) {
            const before = src[i - 1] ?? ' ';
            const after = src[i + 5] ?? ' ';
            if (!/[\w$.]/.test(before) && !/[\w$]/.test(after)) {
                fail(`${name}: top-level await found; some WebViews never initialise the extension`);
                break;
            }
        }
    }
}

/* ── Report ─────────────────────────────────────────────────────────────── */

console.log(`checked ${checked.length} references:`);
for (const line of checked) console.log(`  · ${line}`);

if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
}

console.log('\nall references resolve.');
