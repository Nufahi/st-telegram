/* ST Telegram — SillyTavern theme integration.
 *
 * Our stylesheet does the looking; this module makes SillyTavern's own state
 * agree with it. Four things have to happen, and mutating power_user only
 * covers the first:
 *
 *   1. power_user gets our values, so they survive and so SillyTavern's own
 *      code branches correctly (avatar shape, bubble mode, timestamps...).
 *   2. The --SmartTheme* custom properties get written by hand. SillyTavern
 *      normally writes them in applyTheme(); mutating the settings object
 *      does not repaint anything on its own.
 *   3. The body classes get toggled by hand, for the same reason.
 *   4. Native controls are synchronized so the settings panel stays truthful.
 *
 * We deliberately do NOT dispatch input/change on ordinary controls in step
 * 4. Native events are reserved for importing/selecting the bundled preset,
 * restoring the old preset, and Zen/Lab modes whose handlers build extra DOM.
 */

import { TG_VARIANT, tgRoot } from './boot.js?v=0.1.19';

const THEME_NAME = 'Telegram Mobile (Extension)';
const RESTORE_KEY = 'st-telegram:restore-point:v1';
const BUNDLED_THEME_URL = new URL('../themes/Telegram-Mobile-Extension.json', import.meta.url);
const THEME_IMPORT_TIMEOUT = 15000;

/* The power_user values the layout depends on. Anything that would visibly
   fight the Telegram layout is pinned here; everything else is left alone so
   the user keeps their preferences. */
const THEME_VALUES = {
    blur_strength: 0,
    shadow_width: 0,
    shadow_color: 'rgba(0,0,0,0)',
    font_scale: 1,
    fast_ui_mode: true,
    noShadows: true,
    waifuMode: false,
    /* 0 = circle, matching Telegram and the bundled JSON preset. */
    avatar_style: 0,
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
    enableZenSliders: false,
    enableLabMode: false,
    hotswap_enabled: true,
    bogus_folders: true,
    zoomed_avatar_magnification: false,
    toastr_position: 'toast-bottom-center',
    reduced_motion: false,
    compact_input_area: true,
    show_swipe_num_all_messages: false,
    /* Preserve right-click/hold as the extension's sole message gesture. */
    click_to_edit: false,
    media_display: 'list',
    /* The extension supplies all layout rules from its removable stylesheet.
       Clearing a previous theme's custom CSS prevents specificity conflicts. */
    custom_css: '',
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
        quote_text_color: read('--tg-quote-text', '#287fbd'),
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
    const bridge = typeof SillyTavern !== 'undefined' ? SillyTavern : window.SillyTavern;
    if (typeof bridge?.getContext === 'function') return bridge.getContext();
    return bridge ?? null;
}

function hasThemeOption(select, name) {
    return [...select.options].some(option => option.value === name);
}

async function loadBundledTheme() {
    const response = await fetch(BUNDLED_THEME_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`bundled theme returned HTTP ${response.status}`);

    const theme = await response.json();
    if (!theme || typeof theme !== 'object' || theme.name !== THEME_NAME) {
        throw new Error(`bundled theme must be named "${THEME_NAME}"`);
    }
    return theme;
}

/* Use SillyTavern's importer instead of only assigning settings.theme. This
   registers the bundled preset in its private theme collection, persists the
   JSON through /api/themes/save and keeps the native theme picker truthful. */
async function installAndSelectBundledTheme() {
    const select = document.querySelector('#themes');
    const input = document.querySelector('#ui_preset_import_file');
    if (!(select instanceof HTMLSelectElement) || !(input instanceof HTMLInputElement)) {
        return null;
    }

    const theme = await loadBundledTheme();
    if (!hasThemeOption(select, theme.name)) {
        const transfer = new DataTransfer();
        transfer.items.add(new File(
            [JSON.stringify(theme)],
            'Telegram-Mobile-Extension.json',
            { type: 'application/json' },
        ));

        let observer;
        let timeout;
        const imported = new Promise((resolve, reject) => {
            observer = new MutationObserver(() => {
                if (!hasThemeOption(select, theme.name)) return;
                resolve();
            });
            timeout = window.setTimeout(() => {
                reject(new Error(`timed out importing "${theme.name}"`));
            }, THEME_IMPORT_TIMEOUT);
            observer.observe(select, { childList: true });
        });

        try {
            input.files = transfer.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await imported;
        } finally {
            observer.disconnect();
            window.clearTimeout(timeout);
        }
    } else {
        /* The private in-memory copy cannot be replaced through SillyTavern's
           public API. Refresh the server file for the next load; applyTheme()
           below supplies the current session with the same values directly. */
        const context = getContext();
        const response = await fetch('/api/themes/save', {
            method: 'POST',
            headers: context?.getRequestHeaders?.() ?? { 'Content-Type': 'application/json' },
            body: JSON.stringify(theme),
        });
        if (!response.ok) throw new Error(`saving bundled theme returned HTTP ${response.status}`);
    }

    select.value = theme.name;
    if (select.value !== theme.name) throw new Error(`failed to register "${theme.name}"`);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
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

const COLOR_PICKERS = {
    main_text_color: '#main-text-color-picker',
    italics_text_color: '#italics-color-picker',
    underline_text_color: '#underline-color-picker',
    quote_text_color: '#quote-color-picker',
    blur_tint_color: '#blur-tint-color-picker',
    chat_tint_color: '#chat-tint-color-picker',
    user_mes_blur_tint_color: '#user-mes-blur-tint-color-picker',
    bot_mes_blur_tint_color: '#bot-mes-blur-tint-color-picker',
    shadow_color: '#shadow-color-picker',
    border_color: '#border-color-picker',
};

function colorChannels(value) {
    const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(value || '');
    if (hex) return hex.slice(1).map((channel) => Number.parseInt(channel, 16));

    const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value || '');
    return rgb ? rgb.slice(1).map(Number) : null;
}

function applyCssVariables(settings) {
    const style = tgRoot.style;
    for (const [key, variable] of Object.entries(CSS_VARIABLES)) {
        if (settings[key] !== undefined) style.setProperty(variable, settings[key]);
    }
    const checkboxChannels = colorChannels(settings.main_text_color);
    if (checkboxChannels) {
        style.setProperty('--SmartThemeCheckboxBgColorR', String(checkboxChannels[0]));
        style.setProperty('--SmartThemeCheckboxBgColorG', String(checkboxChannels[1]));
        style.setProperty('--SmartThemeCheckboxBgColorB', String(checkboxChannels[2]));
    }
    style.setProperty('--blurStrength', String(Number(settings.blur_strength) || 0));
    style.setProperty('--shadowWidth', String(Number(settings.shadow_width) || 0));
    style.setProperty('--fontScale', String(Number(settings.font_scale) || 1));
    const width = `${Number(settings.chat_width) || 100}vw`;
    style.setProperty('--chatWidth', width);
    style.setProperty('--sheldWidth', width);
}

function applyCustomCss(settings) {
    const customStyle = document.getElementById('custom-style');
    if (customStyle) customStyle.textContent = settings.custom_css || '';
}

/* Zen and Lab modes build additional DOM and alter input constraints, so a
   class toggle alone cannot deactivate a mode inherited from another theme. */
function syncAdvancedModes(settings) {
    const modes = [
        ['#enableZenSliders', 'enableZenSliders', 'enableZenSliders'],
        ['#enableLabMode', 'enableLabMode', 'enableLabMode'],
    ];
    for (const [selector, key, className] of modes) {
        const control = document.querySelector(selector);
        const desired = Boolean(settings[key]);
        if (!(control instanceof HTMLInputElement)) continue;
        if (control.checked === desired && document.body.classList.contains(className) === desired) continue;
        control.checked = desired;
        control.dispatchEvent(new Event('input', { bubbles: true }));
    }
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
        swipeAllMessages: settings.show_swipe_num_all_messages,
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

    document.getElementById('send_form')?.classList.toggle('compact', Boolean(settings.compact_input_area));
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
    setValue('#media_display', settings.media_display);

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
    setChecked('#enableZenSliders', settings.enableZenSliders);
    setChecked('#enableLabMode', settings.enableLabMode);
    setChecked('#hotswapEnabled', settings.hotswap_enabled);
    setChecked('#bogus_folders', settings.bogus_folders);
    setChecked('#zoomed_avatar_magnification', settings.zoomed_avatar_magnification);
    setChecked('#reduced_motion', settings.reduced_motion);
    setChecked('#compact_input_area', settings.compact_input_area);
    setChecked('#show_swipe_num_all_messages', settings.show_swipe_num_all_messages);
    setChecked('#click_to_edit', settings.click_to_edit);

    /* toolcool-color-picker paints its swatch from the host's color attribute
       inside Shadow DOM. Updating only --SmartTheme* leaves the old Tavern
       preset visible there and lets later adaptive UI copy stale colours. */
    for (const [key, selector] of Object.entries(COLOR_PICKERS)) {
        const picker = document.querySelector(selector);
        const value = settings[key];
        if (picker && value && picker.getAttribute('color') !== value) {
            picker.setAttribute('color', value);
        }
    }
}

/* ── Restore point ──────────────────────────────────────────────────────── */

/* Snapshot the user's values once, before we ever overwrite them, so
   disabling the extension can put things back. */
function rememberRestorePoint(settings) {
    try {
        const stored = JSON.parse(window.localStorage.getItem(RESTORE_KEY) || 'null');
        const snapshot = stored && typeof stored === 'object'
            ? stored
            : { theme: settings.theme };
        for (const key of [...Object.keys(THEME_VALUES), ...Object.keys(CSS_VARIABLES)]) {
            /* v0.1.4 already created v1 snapshots. Preserve their original
               values and only add fields this release manages for the first
               time; those fields have not previously been overwritten. */
            if (!Object.prototype.hasOwnProperty.call(snapshot, key)) snapshot[key] = settings[key];
        }
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
    syncAdvancedModes(settings);
    applyCssVariables(settings);
    applyCustomCss(settings);
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

    const values = {
        ...THEME_VALUES,
        ...paletteFor(),
        fast_ui_mode: tgRoot.dataset.tgGlass !== 'on',
    };
    Object.assign(settings, values);
    settings.theme = THEME_NAME;

    syncAdvancedModes(settings);
    applyCssVariables(settings);
    applyCustomCss(settings);
    applyUiState(settings);
    syncControls(settings);

    context.saveSettingsDebounced?.();
    return true;
}

/* ── Startup ────────────────────────────────────────────────────────────── */

async function start(attempt = 0) {
    const context = getContext();
    const settings = context?.powerUserSettings;
    const controlsReady = document.querySelector('#themes') instanceof HTMLSelectElement
        && document.querySelector('#ui_preset_import_file') instanceof HTMLInputElement;
    if ((!settings || !controlsReady) && attempt < 12) {
        /* SillyTavern's settings load asynchronously and there is no event
            that reliably fires after powerUserSettings exists. Back off and
            retry for three seconds. */
        window.setTimeout(() => start(attempt + 1), 250);
        return;
    }

    if (!settings) return;
    rememberRestorePoint(settings);
    try {
        await installAndSelectBundledTheme();
    } catch (error) {
        /* Keep the extension usable if a browser blocks DataTransfer or the
           server cannot persist themes; direct state application still works. */
        console.warn('[ST Telegram] failed to install bundled theme:', error);
    }

    applyTheme();
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

window.addEventListener('tg-glass-changed', () => applyTheme());

export { applyTheme, THEME_NAME, TG_VARIANT };
