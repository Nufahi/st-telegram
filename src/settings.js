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

import { TG_VERSION, TG_ACCENTS, tgRead, tgReadRaw, tgWrite, tgRoot, tgApplyVariant, tgResolveVariant } from './boot.js?v=0.1.28';

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
            #${PANEL_ID} .tg-row > label.tg-settings-switch {
                position: relative;
                display: inline-block;
                flex: 0 0 42px !important;
                width: 42px !important;
                min-width: 42px !important;
                max-width: 42px !important;
                height: 24px !important;
                min-height: 24px !important;
                max-height: 24px !important;
                margin: 0 !important;
                padding: 0 !important;
                cursor: pointer;
            }
            #${PANEL_ID} .tg-settings-switch > input {
                -webkit-appearance: none !important;
                appearance: none !important;
                position: absolute !important;
                z-index: 2 !important;
                inset: 0 !important;
                width: 42px !important;
                min-width: 42px !important;
                max-width: 42px !important;
                height: 24px !important;
                min-height: 24px !important;
                max-height: 24px !important;
                margin: 0 !important;
                padding: 0 !important;
                border: 0 !important;
                outline: 0 !important;
                background: transparent !important;
                box-shadow: none !important;
                filter: none !important;
                opacity: 0 !important;
                cursor: pointer !important;
            }
            #${PANEL_ID} .tg-settings-switch-track {
                position: absolute;
                inset: 0;
                overflow: hidden;
                border: 1px solid rgba(255, 255, 255, .34);
                border-radius: 999px;
                background: rgba(86, 97, 109, .72);
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, .28), inset 0 -1px 1px rgba(0, 0, 0, .12);
                pointer-events: none;
                transition: background-color 150ms cubic-bezier(.4, 0, .2, 1), box-shadow 150ms cubic-bezier(.4, 0, .2, 1);
                -webkit-backdrop-filter: blur(8px) saturate(140%);
                backdrop-filter: blur(8px) saturate(140%);
            }
            #${PANEL_ID} .tg-settings-switch-track::after {
                content: '';
                position: absolute;
                top: 1px;
                left: 1px;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: rgba(255, 255, 255, .96);
                box-shadow: 0 1px 3px rgba(0, 0, 0, .28), inset 0 1px 0 #fff;
                transition: transform 150ms cubic-bezier(.4, 0, .2, 1);
            }
            #${PANEL_ID} .tg-settings-switch > input:checked + .tg-settings-switch-track {
                background: var(--tg-accent, #3390ec);
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, .38), 0 2px 8px var(--tg-accent-soft, rgba(51, 144, 236, .18));
            }
            #${PANEL_ID} .tg-settings-switch > input:checked + .tg-settings-switch-track::after {
                transform: translateX(18px);
            }
            #${PANEL_ID} .tg-settings-switch > input:focus-visible + .tg-settings-switch-track {
                outline: 2px solid var(--tg-accent, #3390ec);
                outline-offset: 3px;
                box-shadow: 0 0 0 4px var(--tg-accent-soft, rgba(51, 144, 236, .18));
            }
            @media (prefers-reduced-motion: reduce) {
                #${PANEL_ID} .tg-settings-switch-track,
                #${PANEL_ID} .tg-settings-switch-track::after { transition: none; }
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
                    <label for="tg-blur">Blur wallpaper
                        <small>Softens the chat wallpaper behind messages. Needs the wallpaper on.</small>
                    </label>
                    <label class="tg-settings-switch" aria-label="Blur wallpaper">
                        <input type="checkbox" id="tg-blur">
                        <span class="tg-settings-switch-track" aria-hidden="true"></span>
                    </label>
                </div>
                <div class="tg-row">
                    <label for="tg-flat-messages">Full-width messages
                        <small>Monochrome Discord-style chat without bubbles.</small>
                    </label>
                    <label class="tg-settings-switch" aria-label="Full-width messages">
                        <input type="checkbox" id="tg-flat-messages">
                        <span class="tg-settings-switch-track" aria-hidden="true"></span>
                    </label>
                </div>
                <div class="tg-row">
                    <label for="tg-message-font-size">Message text size
                        <small>Changes only the text inside messages.</small>
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
    const blur = $('#tg-blur');
    const flatMessages = $('#tg-flat-messages');
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
    blur.checked = tgRead('blur', ['on', 'off'], 'off') === 'on';
    flatMessages.checked = tgRead('message-layout', ['bubbles', 'flat'], 'bubbles') === 'flat';
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
                const { restorePreviousTheme } = await import('./theme.js?v=0.1.28');
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

    blur.addEventListener('change', () => {
        tgWrite('blur', blur.checked ? 'on' : 'off');
        tgRoot.dataset.tgBlur = blur.checked ? 'on' : 'off';
        window.dispatchEvent(new CustomEvent('tg-blur-changed'));
    });

    flatMessages.addEventListener('change', () => {
        const layout = flatMessages.checked ? 'flat' : 'bubbles';
        tgWrite('message-layout', layout);
        tgRoot.dataset.tgMessageLayout = layout;
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
