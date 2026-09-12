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

import { TG_VERSION, TG_ACCENTS, tgRead, tgReadRaw, tgWrite, tgRoot, tgApplyVariant, tgResolveVariant } from './boot.js?v=0.1.42';

const PANEL_ID = 'st-telegram-settings';

function buildPanel() {
    const wrapper = document.createElement('div');
    wrapper.id = PANEL_ID;

    /* Telegram's own colour picker is a row of filled circles with a check in
       the active one, not a dropdown, so that is what we build. The swatch
       colour is passed as an inline custom property rather than a background,
       so the CSS below can reuse it for the focus ring too.
     *
       Only the first swatch is tabbable; arrow keys move between them. That is
       the standard radiogroup pattern -- seven tab stops for one setting is
       what makes swatch strips unusable with a keyboard. */
    const accentSwatches = Object.entries(TG_ACCENTS)
        .map(([key, colours], index) => {
            const label = `${key[0].toUpperCase()}${key.slice(1)}`;
            return `<button type="button" class="tg-swatch" role="radio" aria-checked="false"`
                + ` tabindex="${index === 0 ? '0' : '-1'}" data-tg-scheme="${key}"`
                + ` style="--tg-swatch: ${colours.night}" title="${label}"`
                + ` aria-label="${label}"></button>`;
        })
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
            /* The swatch strip needs the full row width, so its label sits
               above it rather than beside it. */
            #${PANEL_ID} .tg-row-stacked {
                display: block;
            }
            #${PANEL_ID} .tg-row-stacked > label {
                display: block;
                margin-bottom: 8px;
            }
            #${PANEL_ID} .tg-swatches {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 12px;
                padding: 2px 0 4px;
            }
            /* The panel lives in the extensions drawer, so every rule the theme
               writes for #top-settings-holder .drawer-content button applies
               here too and outweighs a plain class selector. These are matched
               on html[data-tg-enabled] to win that fight -- a swatch whose
               background is overpainted is not a swatch. */
            html #${PANEL_ID} .tg-swatch,
            html[data-tg-enabled='on'] #${PANEL_ID} .tg-swatch {
                flex: 0 0 auto;
                position: relative;
                box-sizing: border-box;
                appearance: none !important;
                -webkit-appearance: none !important;
                width: 28px !important;
                min-width: 28px !important;
                height: 28px !important;
                min-height: 28px !important;
                margin: 0 !important;
                padding: 0 !important;
                border: 0 !important;
                border-radius: 50% !important;
                background: var(--tg-swatch) !important;
                background-color: var(--tg-swatch) !important;
                background-image: none !important;
                box-shadow: none !important;
                filter: none !important;
                cursor: pointer;
                /* The selected swatch is marked by a ring, not a tick. A tick
                   has to be drawn in one fixed colour and there is no single
                   colour that stays legible on all seven circles; a ring in the
                   swatch's own colour reads at a glance on every one of them.
                   The ring is an outline with an offset, so it is painted
                   outside the circle and never shrinks it. */
                transition: transform 150ms cubic-bezier(.4, 0, .2, 1),
                            outline-color 150ms cubic-bezier(.4, 0, .2, 1);
                outline: 2px solid transparent !important;
                outline-offset: 3px;
            }
            #${PANEL_ID} .tg-swatch:hover {
                transform: scale(1.08);
            }
            html #${PANEL_ID} .tg-swatch[aria-checked="true"],
            html[data-tg-enabled='on'] #${PANEL_ID} .tg-swatch[aria-checked="true"] {
                outline-color: var(--tg-swatch) !important;
            }
            /* Nothing is drawn inside the circle. Guard against the host and
               third-party themes that attach pseudo-element glyphs to buttons
               by class or by state. */
            #${PANEL_ID} .tg-swatch::before,
            #${PANEL_ID} .tg-swatch::after {
                content: none !important;
                display: none !important;
            }
            html #${PANEL_ID} .tg-swatch:focus-visible,
            html[data-tg-enabled='on'] #${PANEL_ID} .tg-swatch:focus-visible {
                outline-color: var(--tg-swatch) !important;
                box-shadow: 0 0 0 5px color-mix(in srgb, var(--tg-swatch) 30%, transparent) !important;
            }
            @media (prefers-reduced-motion: reduce) {
                #${PANEL_ID} .tg-swatch { transition: none; }
                #${PANEL_ID} .tg-swatch:hover { transform: none; }
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
                <div class="tg-row tg-row-stacked">
                    <label>Colour scheme
                        <small>Recolours the whole app, as Telegram's themes do.</small>
                    </label>
                    <div class="tg-swatches" id="tg-accent" role="radiogroup" aria-label="Colour scheme">${accentSwatches}</div>
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
    variant.value = tgRead('variant', ['day', 'night'], 'night');
    dayStart.value = tgReadRaw('theme-day-start', '07:00');
    nightStart.value = tgReadRaw('theme-night-start', '19:00');
    const swatches = [...accent.querySelectorAll('.tg-swatch')];
    const syncAccent = (scheme) => {
        for (const swatch of swatches) {
            const active = swatch.dataset.tgScheme === scheme;
            swatch.setAttribute('aria-checked', active ? 'true' : 'false');
            /* Keep exactly one tab stop, on the active swatch, so tabbing into
               the group lands on the current value and not always on blue. */
            swatch.tabIndex = active ? 0 : -1;
        }
    };
    syncAccent(tgRead('accent', Object.keys(TG_ACCENTS), 'blue'));
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
                const { restorePreviousTheme } = await import('./theme.js?v=0.1.42');
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

    const pickAccent = (scheme) => {
        tgWrite('accent', scheme);
        tgRoot.dataset.tgAccent = scheme;
        syncAccent(scheme);
    };

    accent.addEventListener('click', (event) => {
        const swatch = event.target.closest('.tg-swatch');
        if (swatch) pickAccent(swatch.dataset.tgScheme);
    });

    /* Arrow keys move the selection, wrapping at both ends, which is what a
       radiogroup is expected to do and the only way this control is usable
       without a mouse given it has a single tab stop. */
    accent.addEventListener('keydown', (event) => {
        const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
        if (!step) return;
        const from = swatches.indexOf(event.target.closest('.tg-swatch'));
        if (from < 0) return;
        event.preventDefault();
        const next = swatches[(from + step + swatches.length) % swatches.length];
        pickAccent(next.dataset.tgScheme);
        next.focus();
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
