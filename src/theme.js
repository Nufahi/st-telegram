/* ST Telegram — SillyTavern theme integration.
 *
 * Our stylesheet does the looking; this module makes SillyTavern's own state
 * agree with it. Three things have to happen, and mutating power_user only
 * covers the first:
 *
 *   1. power_user gets our values, so they survive and so SillyTavern's own
 *      code branches correctly (avatar shape, bubble mode, timestamps...).
 *   2. The --SmartTheme* custom properties get written by hand. SillyTavern
 *      normally writes them in applyTheme(); mutating the settings object
 *      does not repaint anything on its own.
 *   3. The body classes get toggled by hand, for the same reason.
 *
 * We deliberately do NOT dispatch input/change on the controls we sync in
 * step 4 -- that would re-enter SillyTavern's handlers and apply everything
 * twice. The only place a change event is fired is when restoring the user's
 * previous theme on teardown, where we want SillyTavern to do the work.
 */

import { TG_VARIANT, tgRoot } from './boot.js';

const THEME_NAME = 'Telegram Mobile';
const RESTORE_KEY = 'st-telegram:restore-point:v1';

/* The power_user values the layout depends on. Anything that would visibly
   fight the Telegram layout is pinned here; everything else is left alone so
   the user keeps their preferences. */
const THEME_VALUES = {
    blur_strength: 0,
    shadow_width: 0,
    shadow_color: 'rgba(0,0,0,0)',
    fast_ui_mode: true,
    noShadows: true,
    waifuMode: false,
    /* 3 = rounded. Telegram avatars are circles. */
    avatar_style: 3,
    /* 0 = flat list. We draw our own bubbles; SillyTavern's bubblechat mode
       would nest a second set inside ours. */
    chat_display: 0,
    chat_width: 100,
    timestamps_enabled: true,
    timestamp_model_icon: false,
    /* Keep SillyTavern's native message diagnostics populated. chat.js moves
       the existing nodes into a compact metadata row inside each bubble. */
    timer_enabled: true,
    mesIDDisplay_enabled: true,
    message_token_count_enabled: true,
    hideChatAvatars_enabled: false,
    expand_message_actions: false,
    hotswap_enabled: false,
    toastr_position: 'toast-bottom-center',
    reduced_motion: false,
};

/* Colours handed to SillyTavern so anything we have not styled still lands
   in the right palette. Read from the live stylesheet rather than duplicated
   here, so tokens.css stays the single source of truth. */
function paletteFor() {
    const css = getComputedStyle(tgRoot);
    const read = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
    return {
        main_text_color: read('--tg-text', '#000000'),
        italics_text_color: read('--tg-text-secondary', '#707579'),
        underline_text_color: read('--tg-accent', '#3390ec'),
        quote_text_color: read('--tg-text', '#000000'),
        blur_tint_color: read('--tg-panel', '#ffffff'),
        chat_tint_color: read('--tg-chat-bg', '#d5dbdf'),
        user_mes_blur_tint_color: read('--tg-out-bubble', '#effdde'),
        bot_mes_blur_tint_color: read('--tg-in-bubble', '#ffffff'),
        border_color: read('--tg-divider', 'rgba(0,0,0,.08)'),
    };
}

/* SillyTavern is not a module we import. It publishes itself as a global, and
   at module-eval time that global may not exist yet, hence the null return
   and the retry in start(). */
function getContext() {
    if (typeof SillyTavern !== 'undefined') return SillyTavern;
    return window.SillyTavern ?? null;
}

/* ── Step 2: the CSS custom properties SillyTavern's own rules read ─────── */

const CSS_VARIABLES = {
    main_text_color: '--SmartThemeBodyColor',
    italics_text_color: '--SmartThemeEmColor',
    underline_text_color: '--SmartThemeUnderlineColor',
    quote_text_color: '--SmartThemeQuoteColor',
    blur_tint_color: '--SmartThemeBlurTintColor',
    chat_tint_color: '--SmartThemeChatTintColor',
    user_mes_blur_tint_color: '--SmartThemeUserMesBlurTintColor',
    bot_mes_blur_tint_color: '--SmartThemeBotMesBlurTintColor',
    shadow_color: '--SmartThemeShadowColor',
    border_color: '--SmartThemeBorderColor',
};

function applyCssVariables(settings) {
    const style = tgRoot.style;
    for (const [key, variable] of Object.entries(CSS_VARIABLES)) {
        if (settings[key] !== undefined) style.setProperty(variable, settings[key]);
    }
    style.setProperty('--blurStrength', `${Number(settings.blur_strength) || 0}px`);
    style.setProperty('--shadowWidth', `${Number(settings.shadow_width) || 0}px`);
    style.setProperty('--fontScale', String(Number(settings.font_scale) || 1));
    const width = `${Number(settings.chat_width) || 100}vw`;
    style.setProperty('--chatWidth', width);
    style.setProperty('--sheldWidth', width);
}

/* ── Step 3: the body classes SillyTavern's own rules key off ───────────── */

function applyUiState(settings) {
    const body = document.body;
    if (!body) return;

    const classes = {
        'no-blur': settings.fast_ui_mode,
        waifuMode: settings.waifuMode,
        noShadows: settings.noShadows,
        'no-timer': !settings.timer_enabled,
        'no-timestamps': !settings.timestamps_enabled,
        'no-modelIcons': !settings.timestamp_model_icon,
        'no-mesIDDisplay': !settings.mesIDDisplay_enabled,
        hideChatAvatars: settings.hideChatAvatars_enabled,
        'no-tokenCount': !settings.message_token_count_enabled,
        expandMessageActions: settings.expand_message_actions,
        'no-hotswap': !settings.hotswap_enabled,
        'reduced-motion': settings.reduced_motion,
    };
    for (const [name, on] of Object.entries(classes)) {
        body.classList.toggle(name, Boolean(on));
    }

    body.classList.toggle('big-avatars', Number(settings.avatar_style) === 1);
    body.classList.toggle('square-avatars', Number(settings.avatar_style) === 2);
    body.classList.toggle('rounded-avatars', Number(settings.avatar_style) === 3);

    body.classList.remove('bubblechat', 'documentstyle');
    if (Number(settings.chat_display) === 1) body.classList.add('bubblechat');
    if (Number(settings.chat_display) === 2) body.classList.add('documentstyle');
}

/* ── Step 4: make the User Settings panel show the truth ────────────────── */

function syncControls(settings) {
    const setValue = (selector, value) => {
        const el = document.querySelector(selector);
        if (el && value !== undefined) el.value = String(value);
    };
    const setChecked = (selector, value) => {
        const el = document.querySelector(selector);
        if (el) el.checked = Boolean(value);
    };

    setValue('#blur_strength', settings.blur_strength);
    setValue('#shadow_width', settings.shadow_width);
    setValue('#chat_width', settings.chat_width);
    setValue('#avatar_style', settings.avatar_style);
    setValue('#chat_display', settings.chat_display);
    setValue('#toastr_position', settings.toastr_position);

    setChecked('#fast_ui_mode', settings.fast_ui_mode);
    setChecked('#waifuMode', settings.waifuMode);
    setChecked('#noShadows', settings.noShadows);
    setChecked('#messageTimerEnabled', settings.timer_enabled);
    setChecked('#messageTimestampsEnabled', settings.timestamps_enabled);
    setChecked('#messageModelIconEnabled', settings.timestamp_model_icon);
    setChecked('#mesIDDisplayEnabled', settings.mesIDDisplay_enabled);
    setChecked('#hideChatAvatarsEnabled', settings.hideChatAvatars_enabled);
    setChecked('#messageTokensEnabled', settings.message_token_count_enabled);
    setChecked('#expandMessageActions', settings.expand_message_actions);
    setChecked('#hotswapEnabled', settings.hotswap_enabled);
    setChecked('#reduced_motion', settings.reduced_motion);
}

/* ── Restore point ──────────────────────────────────────────────────────── */

/* Snapshot the user's values once, before we ever overwrite them, so
   disabling the extension can put things back. */
function rememberRestorePoint(settings) {
    try {
        if (window.localStorage.getItem(RESTORE_KEY)) return;
        const snapshot = { theme: settings.theme };
        for (const key of Object.keys(THEME_VALUES)) snapshot[key] = settings[key];
        for (const key of Object.keys(CSS_VARIABLES)) snapshot[key] = settings[key];
        window.localStorage.setItem(RESTORE_KEY, JSON.stringify(snapshot));
    } catch {
        /* No storage: we simply cannot offer a restore. Not fatal. */
    }
}

export function restorePreviousTheme() {
    const context = getContext();
    const settings = context?.powerUserSettings;
    if (!settings) return false;

    let snapshot;
    try {
        snapshot = JSON.parse(window.localStorage.getItem(RESTORE_KEY) || 'null');
    } catch {
        snapshot = null;
    }
    if (!snapshot) return false;

    Object.assign(settings, snapshot);
    applyCssVariables(settings);
    applyUiState(settings);
    syncControls(settings);

    /* Here we DO want SillyTavern to re-run its own applyTheme, so fire the
       change event on the theme select. */
    const select = document.querySelector('#themes');
    if (select instanceof HTMLSelectElement && snapshot.theme) {
        select.value = snapshot.theme;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    try {
        window.localStorage.removeItem(RESTORE_KEY);
    } catch { /* ignore */ }

    context.saveSettingsDebounced?.();
    return true;
}

/* ── Apply ──────────────────────────────────────────────────────────────── */

/* Returns null when SillyTavern is not ready yet, so the caller knows to
   retry rather than treating it as "nothing changed". */
function applyTheme() {
    const context = getContext();
    const settings = context?.powerUserSettings;
    if (!settings) return null;

    rememberRestorePoint(settings);

    const values = { ...THEME_VALUES, ...paletteFor() };
    Object.assign(settings, values);
    settings.theme = THEME_NAME;

    applyCssVariables(settings);
    applyUiState(settings);
    syncControls(settings);

    context.saveSettingsDebounced?.();
    return true;
}

/* ── Startup ────────────────────────────────────────────────────────────── */

function start(attempt = 0) {
    const applied = applyTheme();
    if (applied === null && attempt < 12) {
        /* SillyTavern's settings load asynchronously and there is no event
           that reliably fires after powerUserSettings exists. Back off and
           retry for three seconds. */
        window.setTimeout(() => start(attempt + 1), 250);
        return;
    }
    /* One late re-apply: SillyTavern finishes its own init after ours and
       can overwrite some of these. */
    window.setTimeout(applyTheme, 800);
}

if (typeof jQuery === 'function') {
    jQuery(() => start());
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => start(), { once: true });
} else {
    start();
}

/* Re-apply the palette when the variant changes: the --SmartTheme* values
   are copies of our tokens and would otherwise keep the old variant's
   colours. */
window.addEventListener('tg-variant-changed', () => {
    /* Wait a frame so the new [data-tg-variant] has been resolved by the
       style engine before we read the computed tokens back out. */
    requestAnimationFrame(() => applyTheme());
});

export { applyTheme, THEME_NAME, TG_VARIANT };
