/* ST Telegram — SillyTavern turned into the Telegram Android app.
 *
 * ── Design decisions you should know before editing ─────────────────────────
 *
 * 1. ONE stylesheet, not four. The reference project (claude-web) ships
 *    day-pc / day-mobile / night-pc / night-mobile because its desktop and
 *    mobile layouts are genuinely different products. We only have one layout
 *    -- the phone -- which on desktop is simply centred inside a phone frame.
 *    Day/night is therefore a palette swap driven by [data-tg-variant] on
 *    <html>, which means switching is instant: no <link> swap, no reload, no
 *    multi-second stall on mobile that a full stylesheet re-parse costs.
 *
 * 2. Settings live in localStorage, NOT extension_settings. We must know the
 *    variant before the first paint, and at module-eval time SillyTavern has
 *    not loaded its settings yet. localStorage is synchronous and available
 *    immediately.
 *
 * 3. The layout is NEVER written into SillyTavern's custom_css. If it were,
 *    disabling the extension would leave the native top bar hidden by our
 *    mobile rules and you would be staring at an unnavigable blank page.
 *    Everything ships in a <link> we own and can remove.
 */

const TG_VERSION = '0.1.24';

/* Bump this whenever styles/*.css changes. It is the CSS cache-bust key.
 *
 * This is not theoretical bookkeeping: during development the drawer
 * appeared permanently stuck shut, and the cause was a corrected stylesheet
 * being served from cache under an unchanged key. The symptom is the worst
 * kind -- the fix is on disk, the code is right, and nothing happens. */
const TG_STYLE_BUILD = '0.1.24-wallpaper-blur';

/* Derive the EXTENSION ROOT from this module's URL. SillyTavern names the
   extension directory after the git repo, so a hardcoded path breaks the
   moment someone renames the repo or installs it manually.
 *
 * Note the '../': this file lives in src/, so '.' would resolve to
 * .../st-telegram/src/ and every asset would be requested one level too
 * deep. That shipped in 0.1.0 and 404'd every stylesheet -- the extension
 * loaded, injected its DOM, and had no CSS at all. tools/verify.mjs exists
 * to make that impossible to ship again; run it before every release. */
const TG_BASE = new URL('../', import.meta.url).href;

const TG_PREFIX = 'st-telegram:';

function tgRead(key, allowed, fallback) {
    try {
        const raw = window.localStorage.getItem(TG_PREFIX + key);
        return allowed.includes(raw) ? raw : fallback;
    } catch {
        /* Private mode or a host that blocks storage must not kill the theme. */
        return fallback;
    }
}

function tgReadRaw(key, fallback) {
    try {
        const raw = window.localStorage.getItem(TG_PREFIX + key);
        return raw === null ? fallback : raw;
    } catch {
        return fallback;
    }
}

function tgWrite(key, value) {
    try {
        window.localStorage.setItem(TG_PREFIX + key, value);
        return true;
    } catch {
        return false;
    }
}

/* Master switch. Only an explicit 'off' disables us -- if localStorage is
   unreadable we must stay ON, otherwise a storage failure silently kills the
   whole theme with no way to notice. */
const TG_ENABLED = tgRead('enabled', ['on', 'off'], 'on') !== 'off';

/* ── Variant resolution ──────────────────────────────────────────────────── */

function tgClockMinutes(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value || '');
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
}

function tgResolveVariant() {
    const mode = tgRead('theme-auto', ['manual', 'system', 'time'], 'manual');

    if (mode === 'system') {
        try {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
        } catch {
            return 'day';
        }
    }

    if (mode === 'time') {
        const dayStart = tgClockMinutes(tgReadRaw('theme-day-start', '07:00')) ?? 420;
        const nightStart = tgClockMinutes(tgReadRaw('theme-night-start', '19:00')) ?? 1140;
        const now = new Date();
        const minutes = now.getHours() * 60 + now.getMinutes();
        /* Handles both the normal case (day 07:00, night 19:00) and the
           inverted one (day 19:00, night 07:00) without branching on which
           is larger. */
        if (dayStart <= nightStart) {
            return minutes >= dayStart && minutes < nightStart ? 'day' : 'night';
        }
        return minutes >= dayStart || minutes < nightStart ? 'day' : 'night';
    }

    return tgRead('variant', ['day', 'night'], 'day');
}

const TG_VARIANT = tgResolveVariant();

/* Accent colour. Telegram ships a set of named accents; the user picks one
   and every bubble/button/link follows it. */
const TG_ACCENTS = {
    blue: { day: '#3390ec', night: '#3390ec' },
    green: { day: '#4fae4e', night: '#4fae4e' },
    teal: { day: '#3aa2a0', night: '#3aa2a0' },
    orange: { day: '#e8734a', night: '#e8734a' },
    pink: { day: '#e0559b', night: '#e0559b' },
    violet: { day: '#8a56ac', night: '#8774e1' },
};
const TG_ACCENT = tgRead('accent', Object.keys(TG_ACCENTS), 'blue');

/* ── Pre-paint flags ─────────────────────────────────────────────────────── */

/* Everything below runs synchronously at module-eval time, before the first
   paint, so the page never flashes an unstyled or wrong-variant frame. */
const tgRoot = document.documentElement;
tgRoot.dataset.tgVariant = TG_VARIANT;
tgRoot.dataset.tgAccent = TG_ACCENT;
tgRoot.dataset.tgEnabled = TG_ENABLED ? 'on' : 'off';
tgRoot.dataset.tgFab = 'mic';
tgRoot.dataset.tgMotion = tgRead('motion', ['on', 'off'], 'on');
tgRoot.dataset.tgBlur = tgRead('blur', ['on', 'off'], 'off');
tgRoot.dataset.tgMessageLayout = tgRead('message-layout', ['bubbles', 'flat'], 'bubbles');
/* This is an application theme, not a phone mockup. Keep the old data flag
   pinned off so existing frame.css rules remain harmless during migration. */
tgRoot.dataset.tgFrame = 'off';
/* Telegram's tiled doodle wallpaper behind the chat. */
tgRoot.dataset.tgWallpaper = tgRead('wallpaper', ['on', 'off'], 'on');
/* Telegram exposes message text size independently from the rest of the UI.
   Clamp stored values so a malformed localStorage entry cannot break chat. */
const tgMessageFontSize = Math.min(22, Math.max(14, Number(tgReadRaw('message-font-size', '16')) || 16));
tgRoot.style.setProperty('--tg-font-body-size', `${tgMessageFontSize}px`);

/* ── Stylesheet ──────────────────────────────────────────────────────────── */

const TG_STYLE_ID = 'st-telegram-style';

function tgInstallStyle() {
    const url = new URL('styles/telegram.css', TG_BASE);
    url.searchParams.set('v', TG_STYLE_BUILD);

    let link = document.getElementById(TG_STYLE_ID);
    if (!link) {
        link = document.createElement('link');
        link.id = TG_STYLE_ID;
        link.rel = 'stylesheet';
        document.head.append(link);
    }
    if (link.getAttribute('href') !== url.href) {
        link.setAttribute('href', url.href);
    }
}

if (TG_ENABLED) {
    tgInstallStyle();
}

/* ── Live variant switching ──────────────────────────────────────────────── */

/* Because the palette is a data attribute rather than a separate file, this
   is a single attribute write. No network, no re-parse, no reload. */
function tgApplyVariant(variant) {
    tgRoot.dataset.tgVariant = variant;
    window.dispatchEvent(new CustomEvent('tg-variant-changed', { detail: { variant } }));
}

/* Follow the OS in 'system' mode without a reload. */
if (TG_ENABLED && tgRead('theme-auto', ['manual', 'system', 'time'], 'manual') === 'system') {
    try {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => tgApplyVariant(media.matches ? 'night' : 'day');
        if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
        else if (typeof media.addListener === 'function') media.addListener(onChange);
    } catch {
        /* matchMedia missing: stay on the resolved variant. */
    }
}

/* In 'time' mode, re-check on the minute. Cheap: one attribute compare. */
if (TG_ENABLED && tgRead('theme-auto', ['manual', 'system', 'time'], 'manual') === 'time') {
    window.setInterval(() => {
        const next = tgResolveVariant();
        if (next !== tgRoot.dataset.tgVariant) tgApplyVariant(next);
    }, 60000);
}

export { TG_VERSION, TG_BASE, TG_PREFIX, TG_VARIANT, TG_ACCENT, TG_ENABLED, TG_ACCENTS };
export { tgRead, tgReadRaw, tgWrite, tgApplyVariant, tgResolveVariant, tgRoot };
