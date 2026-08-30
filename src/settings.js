/* ST Telegram — the extension's own settings panel.
 *
 * This module ALWAYS loads, even when the theme is disabled. If it did not,
 * turning the theme off would remove the only control that can turn it back
 * on.
 *
 * State lives in localStorage, not extension_settings, because boot.js has to
 * read the variant at module-eval time to avoid a wrong-colour first paint,
 * and SillyTavern's settings are not loaded yet at that moment. This panel is
 * only a UI over those keys.
 */

import { TG_VERSION, TG_ACCENTS, tgRead, tgReadRaw, tgWrite, tgRoot, tgApplyVariant, tgResolveVariant } from './boot.js?v=0.1.8';

const PANEL_ID = 'st-telegram-settings';

function buildPanel() {
    const wrapper = document.createElement('div');
    wrapper.id = PANEL_ID;

    const accentOptions = Object.keys(TG_ACCENTS)
        .map((key) => `<option value="${key}">${key[0].toUpperCase()}${key.slice(1)}</option>`)
        .join('');

    /* Reuse SillyTavern's inline-drawer markup so its own delegated collapse
       handler works. We deliberately do not bind our own toggle -- two
       handlers on one click would collapse and expand in the same gesture. */
    wrapper.innerHTML = `
        <style>
            /* Scoped by id so it wins against the theme's own !important
               rules for panel controls. */
            #${PANEL_ID} .tg-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                padding: 7px 0;
                border-bottom: 1px solid var(--tg-divider, rgba(128,128,128,.2));
            }
            #${PANEL_ID} .tg-row:last-child { border-bottom: 0; }
            #${PANEL_ID} .tg-row > label {
                flex: 1 1 auto;
                min-width: 0;
                font-size: 14px;
                margin: 0;
            }
            #${PANEL_ID} .tg-row > label small {
                display: block;
                opacity: .65;
                font-size: 12px;
                line-height: 1.3;
            }
            #${PANEL_ID} .tg-row select,
            #${PANEL_ID} .tg-row input[type="time"] {
                flex: 0 0 auto;
                width: auto;
                min-width: 116px;
                font-size: 13px;
            }
            #${PANEL_ID} .tg-row input[type="checkbox"] {
                flex: 0 0 auto;
                margin: 0;
            }
            #${PANEL_ID} .tg-range-control {
                flex: 0 0 auto;
                display: flex;
                align-items: center;
                gap: 8px;
                min-width: 150px;
            }
            #${PANEL_ID} .tg-range-control input[type="range"] {
                width: 112px;
                margin: 0;
            }
            #${PANEL_ID} .tg-range-value {
                width: 32px;
                font-size: 13px;
                text-align: right;
                color: var(--tg-text-secondary, currentColor);
            }
            #${PANEL_ID} .tg-note {
                opacity: .65;
                font-size: 12px;
                line-height: 1.4;
                padding: 8px 0 2px;
            }
        </style>
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Telegram Mobile</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="tg-row">
                    <label for="tg-enabled">Enable theme
                        <small>Turning this off restores SillyTavern's own layout.</small>
                    </label>
                    <input type="checkbox" id="tg-enabled">
                </div>
                <div class="tg-row">
                    <label for="tg-theme-auto">Theme mode</label>
                    <select id="tg-theme-auto">
                        <option value="manual">Manual</option>
                        <option value="system">Follow system</option>
                        <option value="time">By time of day</option>
                    </select>
                </div>
                <div class="tg-row" data-tg-when="manual">
                    <label for="tg-variant">Theme</label>
                    <select id="tg-variant">
                        <option value="day">Day</option>
                        <option value="night">Night</option>
                    </select>
                </div>
                <div class="tg-row" data-tg-when="time">
                    <label for="tg-day-start">Day starts at</label>
                    <input type="time" id="tg-day-start">
                </div>
                <div class="tg-row" data-tg-when="time">
                    <label for="tg-night-start">Night starts at</label>
                    <input type="time" id="tg-night-start">
                </div>
                <div class="tg-row">
                    <label for="tg-accent">Accent colour</label>
                    <select id="tg-accent">${accentOptions}</select>
                </div>
                <div class="tg-row">
                    <label for="tg-message-font-size">Message text size
                        <small>Changes only the text inside message bubbles.</small>
                    </label>
                    <div class="tg-range-control">
                        <input type="range" id="tg-message-font-size" min="14" max="22" step="1">
                        <output class="tg-range-value" for="tg-message-font-size"></output>
                    </div>
                </div>
                <div class="tg-row">
                    <label for="tg-wallpaper">Chat wallpaper</label>
                    <input type="checkbox" id="tg-wallpaper">
                </div>
                <div class="tg-row">
                    <label for="tg-motion">Animations</label>
                    <input type="checkbox" id="tg-motion">
                </div>
                <div class="tg-note">Version ${TG_VERSION}. Enabling or disabling the theme reloads the page.</div>
            </div>
        </div>`;

    return wrapper;
}

function wire(panel) {
    const $ = (sel) => panel.querySelector(sel);

    const enabled = $('#tg-enabled');
    const themeAuto = $('#tg-theme-auto');
    const variant = $('#tg-variant');
    const dayStart = $('#tg-day-start');
    const nightStart = $('#tg-night-start');
    const accent = $('#tg-accent');
    const messageFontSize = $('#tg-message-font-size');
    const messageFontSizeValue = panel.querySelector('.tg-range-value');
    const wallpaper = $('#tg-wallpaper');
    const motion = $('#tg-motion');

    /* Load current state. */
    enabled.checked = tgRead('enabled', ['on', 'off'], 'on') !== 'off';
    themeAuto.value = tgRead('theme-auto', ['manual', 'system', 'time'], 'manual');
    variant.value = tgRead('variant', ['day', 'night'], 'day');
    dayStart.value = tgReadRaw('theme-day-start', '07:00');
    nightStart.value = tgReadRaw('theme-night-start', '19:00');
    accent.value = tgRead('accent', Object.keys(TG_ACCENTS), 'blue');
    messageFontSize.value = String(Math.min(22, Math.max(14, Number(tgReadRaw('message-font-size', '16')) || 16)));
    wallpaper.checked = tgRead('wallpaper', ['on', 'off'], 'on') === 'on';
    motion.checked = tgRead('motion', ['on', 'off'], 'on') === 'on';

    const syncVisibility = () => {
        const mode = themeAuto.value;
        for (const row of panel.querySelectorAll('[data-tg-when]')) {
            row.style.display = row.getAttribute('data-tg-when') === mode ? '' : 'none';
        }
    };
    syncVisibility();

    /* Enabling or disabling changes what boot.js does at module-eval time,
       so it genuinely needs a reload -- there is no way to retrofit the
       pre-paint attributes onto a page that already rendered. */
    enabled.addEventListener('change', async () => {
        const next = enabled.checked ? 'on' : 'off';

        /* Disabling must restore the SillyTavern preferences that theme.js
           changed. Otherwise deleting the extension can leave chat width,
           avatars and message controls in the Telegram configuration. */
        if (next === 'off') {
            enabled.disabled = true;
            try {
                const { restorePreviousTheme } = await import('./theme.js?v=0.1.8');
                restorePreviousTheme();
            } catch (error) {
                console.warn('[ST Telegram] failed to restore the previous theme:', error);
            }
        }

        tgWrite('enabled', next);
        /* Give SillyTavern's debounced settings save time to persist the
           restored values before this extension stops loading. */
        window.setTimeout(() => window.location.reload(), next === 'off' ? 600 : 150);
    });

    /* Everything below is live: the palette is a data attribute, so there is
       no stylesheet to reload and no reason to make the user wait. */
    themeAuto.addEventListener('change', () => {
        tgWrite('theme-auto', themeAuto.value);
        syncVisibility();
        tgApplyVariant(tgResolveVariant());
    });

    variant.addEventListener('change', () => {
        tgWrite('variant', variant.value);
        tgWrite('theme-auto', 'manual');
        themeAuto.value = 'manual';
        syncVisibility();
        tgApplyVariant(variant.value);
    });

    dayStart.addEventListener('change', () => {
        tgWrite('theme-day-start', dayStart.value || '07:00');
        tgApplyVariant(tgResolveVariant());
    });

    nightStart.addEventListener('change', () => {
        tgWrite('theme-night-start', nightStart.value || '19:00');
        tgApplyVariant(tgResolveVariant());
    });

    accent.addEventListener('change', () => {
        tgWrite('accent', accent.value);
        tgRoot.dataset.tgAccent = accent.value;
    });

    const applyMessageFontSize = () => {
        const size = Math.min(22, Math.max(14, Number(messageFontSize.value) || 16));
        messageFontSize.value = String(size);
        messageFontSizeValue.value = `${size}px`;
        tgRoot.style.setProperty('--tg-font-body-size', `${size}px`);
        tgWrite('message-font-size', String(size));
    };
    messageFontSize.addEventListener('input', applyMessageFontSize);
    applyMessageFontSize();

    wallpaper.addEventListener('change', () => {
        tgWrite('wallpaper', wallpaper.checked ? 'on' : 'off');
        tgRoot.dataset.tgWallpaper = wallpaper.checked ? 'on' : 'off';
    });

    motion.addEventListener('change', () => {
        tgWrite('motion', motion.checked ? 'on' : 'off');
        tgRoot.dataset.tgMotion = motion.checked ? 'on' : 'off';
    });

    /* Keep the dropdown honest when the variant changes from elsewhere --
       the drawer's moon button, or the auto scheduler. */
    window.addEventListener('tg-variant-changed', (event) => {
        const next = event.detail?.variant;
        if (next && variant.value !== next) variant.value = next;
    });
}

/* SillyTavern's extension settings containers do not exist at load time and
   there is no event for them, so poll. Prefer the second column, which is
   where third-party extensions conventionally live. */
function mount() {
    const deadline = Date.now() + 60000;
    const timer = window.setInterval(() => {
        const host = document.getElementById('extensions_settings2')
            || document.getElementById('extensions_settings');

        if (host) {
            window.clearInterval(timer);
            if (document.getElementById(PANEL_ID)) return;
            try {
                const panel = buildPanel();
                host.append(panel);
                wire(panel);
            } catch (error) {
                console.warn('[ST Telegram] settings panel failed to mount:', error);
            }
            return;
        }

        if (Date.now() > deadline) {
            window.clearInterval(timer);
            console.warn('[ST Telegram] extension settings container never appeared.');
        }
    }, 500);
}

mount();
