/* ST Telegram — the chat screen runtime.
 *
 * Responsibilities:
 *   - inject the action bar, the drawer header, row labels, scrim, mic FAB
 *   - tag messages so CSS can draw Telegram's grouping and bubble tails
 *   - insert date pills between days
 *   - keep the header's name/avatar/status in sync
 *   - drive the drawer open/closed, and defuse SillyTavern's drawer bugs
 *
 * ═══ Rules this file obeys, each of them learned from a real failure ═══
 *
 * IDEMPOTENCY BY CLEAR-THEN-BUILD. Never decide "have I built this already?"
 * by remembering. SillyTavern rebuilds the chat wholesale at unpredictable
 * times and any remembered flag goes stale. Either the node is there and
 * correct, or we remove and rebuild it.
 *
 * NEVER SYNTHESISE CLICKS. Forwarding a click to another element makes
 * SillyTavern handle the same gesture twice, and the two toggles cancel out.
 * If a row needs a bigger hit area, solve it in CSS by stretching the real
 * target -- which drawer.css does.
 *
 * NEVER disconnect() the observer around our own writes. disconnect() drops
 * the pending record queue, so anything SillyTavern did while we were
 * detached is lost forever -- for instance the insertion of the message you
 * just sent, which then never gets tagged. Use takeRecords() instead.
 */

import { tgRead, tgWrite, tgRoot, tgApplyVariant } from './boot.js';

/* ── Context ────────────────────────────────────────────────────────────── */

function getContext() {
    const bridge = typeof SillyTavern !== 'undefined' ? SillyTavern : window.SillyTavern;
    if (typeof bridge?.getContext === 'function') return bridge.getContext();
    return bridge ?? null;
}

/* ── Small helpers ──────────────────────────────────────────────────────── */

function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
}

/* Telegram picks a sender-name colour by hashing the name. Same input always
   gives the same colour, which is the whole point. */
function nameColorIndex(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    }
    return hash % 7;
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

/* SillyTavern timestamps come in several shapes depending on version and
   locale. Parse defensively and fall back to "no date" rather than showing
   a wrong one. */
function parseMessageDate(mes) {
    const raw = mes?.send_date;
    if (!raw) return null;
    if (typeof raw === 'number') {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const direct = new Date(raw);
    if (!Number.isNaN(direct.getTime())) return direct;
    /* "June 7, 2026 3:04pm" -- the am/pm needs a space to parse. */
    const spaced = String(raw).replace(/(\d)(am|pm)/i, '$1 $2');
    const retry = new Date(spaced);
    return Number.isNaN(retry.getTime()) ? null : retry;
}

function dateKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dateLabel(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (dateKey(date) === dateKey(today)) return 'Today';
    if (dateKey(date) === dateKey(yesterday)) return 'Yesterday';

    const sameYear = date.getFullYear() === today.getFullYear();
    return date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        ...(sameYear ? {} : { year: 'numeric' }),
    });
}

/* ── Header ─────────────────────────────────────────────────────────────── */

let header = null;

function ensureHeader() {
    const sheld = document.getElementById('sheld');
    const chat = document.getElementById('chat');
    if (!sheld || !chat) return null;

    let node = sheld.querySelector(':scope > .tg-header');
    if (!node) {
        node = el('div', 'tg-header');
        node.innerHTML = `
            <button type="button" class="tg-header-btn tg-header-back" aria-label="Menu"></button>
            <div class="tg-header-avatar"><img alt=""></div>
            <div class="tg-header-titles">
                <div class="tg-header-name"></div>
                <div class="tg-header-status"></div>
            </div>
            <button type="button" class="tg-header-btn tg-header-search" aria-label="Search"></button>
            <button type="button" class="tg-header-btn tg-header-menu" aria-label="More"></button>`;
        /* Before #chat so flex order puts it on top. */
        sheld.insertBefore(node, chat);
        wireHeader(node);
    }
    header = node;
    return node;
}

function wireHeader(node) {
    node.querySelector('.tg-header-back')?.addEventListener('click', () => {
        toggleDrawer(!document.body.classList.contains('tg-drawer-open'));
    });

    /* Reuse SillyTavern's own controls so their handlers keep working. We
       click the real element rather than reimplementing the action. This is
       not the "synthesised click" anti-pattern: our button is a node we own
       with no SillyTavern handler of its own, so nothing is handled twice. */
    node.querySelector('.tg-header-search')?.addEventListener('click', () => {
        document.querySelector('#rightNavHolder .drawer-icon')?.click();
    });

    node.querySelector('.tg-header-menu')?.addEventListener('click', (event) => {
        event.stopPropagation();
        document.getElementById('options_button')?.click();
    });

    node.querySelector('.tg-header-avatar')?.addEventListener('click', () => {
        document.querySelector('#rightNavHolder .drawer-icon')?.click();
    });
}

/* Where the header's identity comes from: the active character or group. */
function currentPeer() {
    const context = getContext();
    if (!context) return null;

    const groupId = context.groupId ?? context.group_id;
    if (groupId) {
        const group = context.groups?.find((g) => String(g.id) === String(groupId));
        if (group) {
            return {
                name: group.name || 'Group',
                avatar: null,
                status: `${group.members?.length ?? 0} members`,
            };
        }
    }

    const charId = context.characterId ?? context.character_id;
    if (charId !== undefined && charId !== null && context.characters?.[charId]) {
        const character = context.characters[charId];
        let avatar = null;
        try {
            avatar = context.getThumbnailUrl?.('avatar', character.avatar) ?? null;
        } catch {
            avatar = null;
        }
        return { name: character.name || 'Chat', avatar, status: 'online' };
    }

    return null;
}

let typingActive = false;

function refreshHeader() {
    const node = ensureHeader();
    if (!node) return;

    const peer = currentPeer();
    const context = getContext();
    const groupId = context?.groupId ?? context?.group_id;
    tgRoot.dataset.tgChatType = groupId ? 'group' : 'private';
    const nameEl = node.querySelector('.tg-header-name');
    const statusEl = node.querySelector('.tg-header-status');
    const avatarBox = node.querySelector('.tg-header-avatar');
    const avatarImg = avatarBox?.querySelector('img');

    const name = peer?.name ?? 'SillyTavern';
    if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;

    const status = typingActive ? 'typing…' : (peer?.status ?? 'no chat selected');
    if (statusEl && statusEl.textContent !== status) statusEl.textContent = status;
    statusEl?.setAttribute('data-tg-typing', typingActive ? 'on' : 'off');

    if (avatarImg) {
        if (peer?.avatar) {
            if (avatarImg.getAttribute('src') !== peer.avatar) avatarImg.src = peer.avatar;
            avatarImg.style.display = '';
            avatarBox?.removeAttribute('data-tg-fallback');
        } else {
            avatarImg.removeAttribute('src');
            avatarImg.style.display = 'none';
            avatarBox?.setAttribute('data-tg-fallback', (name[0] || '?').toUpperCase());
        }
    }
}

/* ── Message grouping, tails, date pills ────────────────────────────────── */

/* Telegram groups consecutive messages from the same sender: only the first
   carries the name, only the last carries the avatar and the tail. We tag
   rows with .tg-group-start / .tg-group-end and let CSS do the rest. */
function refreshMessages() {
    const chat = document.getElementById('chat');
    if (!chat) return;

    const rows = [...chat.querySelectorAll(':scope > .mes')];
    const context = getContext();
    const messages = context?.chat;

    /* Remove pills before measuring, so their presence never affects the
       grouping decisions. Clear-then-build. */
    for (const pill of chat.querySelectorAll(':scope > .tg-date-pill')) pill.remove();

    let previousKey = null;
    let lastDateKey = null;

    rows.forEach((row, index) => {
        const isUser = row.getAttribute('is_user') === 'true';
        const isSystem = row.getAttribute('is_system') === 'true';
        const name = row.getAttribute('ch_name') || '';
        const key = isSystem ? `sys:${index}` : `${isUser ? 'u' : 'c'}:${name}`;

        const next = rows[index + 1];
        const nextIsUser = next?.getAttribute('is_user') === 'true';
        const nextIsSystem = next?.getAttribute('is_system') === 'true';
        const nextName = next?.getAttribute('ch_name') || '';
        const nextKey = next
            ? (nextIsSystem ? `sys:${index + 1}` : `${nextIsUser ? 'u' : 'c'}:${nextName}`)
            : null;

        row.classList.toggle('tg-group-start', key !== previousKey);
        row.classList.toggle('tg-group-end', key !== nextKey);

        if (!isUser && !isSystem && name) {
            const idx = String(nameColorIndex(name));
            if (row.getAttribute('data-tg-name') !== idx) row.setAttribute('data-tg-name', idx);
        } else {
            row.removeAttribute('data-tg-name');
        }

        /* Date pill, from the message data rather than the rendered
           timestamp text -- the rendered form is locale-dependent and has
           bitten this kind of code before. */
        const mesId = Number(row.getAttribute('mesid'));
        const mes = Number.isNaN(mesId) ? null : messages?.[mesId];
        const date = parseMessageDate(mes);
        if (date) {
            const key2 = dateKey(date);
            if (key2 !== lastDateKey) {
                const pill = el('div', 'tg-date-pill');
                pill.textContent = dateLabel(date);
                chat.insertBefore(pill, row);
                lastDateKey = key2;
            }
        }

        previousKey = key;
    });
}

/* ── Composer ───────────────────────────────────────────────────────────── */

/* Telegram's composer is [emoji][text][attach][send]. SillyTavern's is
   [hamburger + wand][text][send].
 *
 * The mapping we use:
 *   #options_button        -> emoji, left, where SillyTavern already puts it
 *   #extensionsMenuButton  -> paperclip, right, next to Send
 *
 * An earlier release moved the attach control by hiding #leftSendForm, which
 * also hid the working emoji button. Nothing is hidden here: the wand is
 * MOVED, so both controls survive.
 *
 * The wand is relocated rather than imitated because SillyTavern anchors
 * #extensionsMenu to it with Popper. A lookalike button that forwarded the
 * click would open the real menu positioned over the real (now hidden)
 * node -- the popup would appear detached from the icon that opened it. */
function ensureComposer() {
    const items = document.getElementById('nonQRFormItems');
    const right = document.getElementById('rightSendForm');
    if (!items || !right) return;

    /* Extensions register their wand entries asynchronously, and SillyTavern
       only appends the button itself during initExtensions(), so this can be
       a no-op for the first few passes. The refresh loop retries. */
    const wand = document.getElementById('extensionsMenuButton');
    if (wand && wand.parentElement !== items) {
        items.insertBefore(wand, right);
    }

    /* Remove the imitation wand shipped by the previous release. Users who
       already loaded it have the node in a cached DOM, not on disk. */
    for (const stale of items.querySelectorAll(':scope > .tg-wand')) stale.remove();

    /* Resting-state mic, so the FAB is never absent. Inert by design: this
       is a layout placeholder, not a fake feature. */
    if (!right.querySelector(':scope > .tg-mic')) {
        const mic = el('div', 'tg-mic');
        mic.setAttribute('aria-hidden', 'true');
        right.append(mic);
    }
}

/* Which FAB shows: stop while generating, send when there is text, mic when
   empty. Driven off <html> so CSS does the switching. */
function refreshFab() {
    const textarea = document.getElementById('send_textarea');
    const stop = document.getElementById('mes_stop');

    const generating = typingActive
        || (stop && !stop.classList.contains('displayNone') && getComputedStyle(stop).display !== 'none');

    const mode = generating ? 'stop' : ((textarea?.value ?? '').trim() ? 'send' : 'mic');
    if (tgRoot.dataset.tgFab !== mode) tgRoot.dataset.tgFab = mode;
}

/* ── Telegram message action sheet ─────────────────────────────────────── */

let actionSheet = null;
let actionTarget = null;

function actionLabel(button) {
    if (!(button instanceof Element)) return '';
    const explicit = button.getAttribute('aria-label')
        || button.getAttribute('title')
        || button.getAttribute('data-tooltip')
        || button.textContent?.trim();
    if (explicit) return explicit.trim();
    if (button.matches('.swipe_left')) return 'Previous response';
    if (button.matches('.swipe_right')) return 'Next response';
    return 'Action';
}

function actionKind(button) {
    if (button.matches('.mes_copy')) return 'copy';
    if (button.matches('.mes_edit')) return 'edit';
    if (button.matches('.mes_edit_delete')) return 'delete';
    if (button.matches('.swipe_left')) return 'previous';
    if (button.matches('.swipe_right')) return 'next';
    if (button.matches('#option_regenerate')) return 'regenerate';
    return 'more';
}

function nativeActionAvailable(button) {
    return button instanceof HTMLElement
        && button.isConnected
        && !button.matches('[disabled], [aria-disabled="true"], .disabled');
}

function runNativeAction(button) {
    if (!nativeActionAvailable(button)) return;
    if (button.matches('.mes_copy')) {
        try {
            button.dispatchEvent(new PointerEvent('pointerup', {
                bubbles: true,
                cancelable: true,
                pointerType: 'mouse',
                isPrimary: true,
            }));
        } catch {
            button.dispatchEvent(new Event('pointerup', { bubbles: true, cancelable: true }));
        }
        return;
    }
    HTMLElement.prototype.click.call(button);
}

function closeActionSheet() {
    actionSheet?.remove();
    actionSheet = null;
    actionTarget?.classList.remove('tg-action-target');
    actionTarget = null;
    document.body.classList.remove('tg-action-sheet-open');
}

function collectMessageActions(row) {
    const primary = [];
    const more = [];
    const seen = new Set();
    const add = (button, forceMore = false) => {
        if (!nativeActionAvailable(button) || seen.has(button)) return;
        seen.add(button);
        const action = { button, label: actionLabel(button), kind: actionKind(button) };
        if (!forceMore && ['copy', 'edit', 'delete', 'previous', 'next', 'regenerate'].includes(action.kind)) primary.push(action);
        else more.push(action);
    };

    const editButton = row.querySelector('.mes_buttons > .mes_edit');
    add(editButton);
    add(row.querySelector('.extraMesButtons > .mes_copy'));
    if (nativeActionAvailable(editButton)) {
        primary.push({
            button: editButton,
            label: 'Delete',
            kind: 'delete',
            run: () => {
                runNativeAction(editButton);
                window.requestAnimationFrame(() => {
                    runNativeAction(row.querySelector('.mes_edit_buttons > .mes_edit_delete'));
                });
            },
        });
    }
    if (row.matches('.last_mes')) {
        add(row.querySelector('.swipe_left'));
        add(row.querySelector('.swipe_right'));
        add(document.getElementById('option_regenerate'));
    }
    for (const button of row.querySelectorAll('.extraMesButtons > .mes_button')) add(button, !button.matches('.mes_copy'));

    return { primary, more };
}

function makeActionButton(action) {
    const button = el('button', `tg-message-action tg-action-${action.kind}`);
    button.type = 'button';
    button.innerHTML = `<span class="tg-action-icon" aria-hidden="true"></span><span class="tg-action-label"></span>`;
    button.querySelector('.tg-action-label').textContent = action.label;
    button.addEventListener('click', () => {
        closeActionSheet();
        if (typeof action.run === 'function') action.run();
        else runNativeAction(action.button);
    });
    return button;
}

function openActionSheet(row) {
    if (!(row instanceof HTMLElement) || row.getAttribute('is_system') === 'true') return;
    const actions = collectMessageActions(row);
    if (!actions.primary.length && !actions.more.length) return;

    closeActionSheet();
    actionTarget = row;
    row.classList.add('tg-action-target');

    const sheet = el('div', 'tg-message-action-layer');
    sheet.innerHTML = '<button type="button" class="tg-message-action-scrim" aria-label="Close message actions"></button><div class="tg-message-action-sheet" role="menu"></div>';
    const panel = sheet.querySelector('.tg-message-action-sheet');
    for (const action of actions.primary) panel.append(makeActionButton(action));

    if (actions.more.length) {
        const moreButton = el('button', 'tg-message-action tg-action-more');
        moreButton.type = 'button';
        moreButton.innerHTML = '<span class="tg-action-icon" aria-hidden="true"></span><span class="tg-action-label">More</span>';
        moreButton.addEventListener('click', () => {
            panel.replaceChildren(...actions.more.map(makeActionButton));
            const back = el('button', 'tg-message-action tg-action-back');
            back.type = 'button';
            back.innerHTML = '<span class="tg-action-icon" aria-hidden="true"></span><span class="tg-action-label">Back</span>';
            back.addEventListener('click', () => openActionSheet(row));
            panel.prepend(back);
        });
        panel.append(moreButton);
    }

    sheet.querySelector('.tg-message-action-scrim').addEventListener('click', closeActionSheet);
    document.body.append(sheet);
    actionSheet = sheet;
    document.body.classList.add('tg-action-sheet-open');
}

function onMessageActionRequest(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('a, button, input, textarea, select, .mes_buttons, .mes_edit_buttons, .swipe_left, .swipeRightBlock')) return;
    const bubble = target.closest('#chat > .mes .mes_block');
    if (!bubble) return;
    const row = bubble.closest('#chat > .mes');
    if (row) openActionSheet(row);
}

/* ── Drawer ─────────────────────────────────────────────────────────────── */

function toggleDrawer(open) {
    document.body.classList.toggle('tg-drawer-open', open);
}

/* Close a native SillyTavern settings panel through its real toggle, then
   reveal our section launcher. Keeping this in one helper prevents the two
   drawer state machines from drifting apart on desktop. */
function returnToDrawer(content = document.querySelector('#top-settings-holder .drawer-content.openDrawer')) {
    if (!(content instanceof Element)) {
        toggleDrawer(true);
        return;
    }

    const icon = content.parentElement?.querySelector(':scope > .drawer-toggle > .drawer-icon');
    if (icon instanceof HTMLElement) icon.click();
    window.requestAnimationFrame(() => toggleDrawer(true));
}

function ensureScrim() {
    let scrim = document.body.querySelector(':scope > .tg-scrim');
    if (!scrim) {
        scrim = el('div', 'tg-scrim');
        scrim.addEventListener('click', () => toggleDrawer(false));
        document.body.append(scrim);
    }
}

/* Short labels for the drawer rows. Keyed on the Font Awesome class, not on
   the title text: the class is stable across SillyTavern versions and across
   UI languages, the title is neither. */
const DRAWER_LABELS = {
    'fa-sliders': 'AI Response',
    'fa-sliders-h': 'AI Response',
    'fa-plug': 'API Connections',
    'fa-font': 'Formatting',
    'fa-globe': 'World Info',
    'fa-book-atlas': 'World Info',
    'fa-user-cog': 'User Settings',
    'fa-user-gear': 'User Settings',
    'fa-panorama': 'Backgrounds',
    'fa-image': 'Backgrounds',
    'fa-images': 'Backgrounds',
    'fa-cubes': 'Extensions',
    'fa-face-smile': 'Persona',
    'fa-user-tie': 'Persona',
    'fa-address-card': 'Characters',
    'fa-users': 'Characters',
};

function ensureDrawerChrome() {
    const holder = document.getElementById('top-settings-holder');
    if (!holder) return;

    /* Header block with avatar + name + theme toggle. */
    if (!holder.querySelector(':scope > .tg-drawer-head')) {
        const head = el('div', 'tg-drawer-head');
        head.innerHTML = `
            <div class="tg-drawer-head-top">
                <div class="tg-drawer-avatar"><img alt=""></div>
                <div class="tg-drawer-actions">
                    <button type="button" class="tg-drawer-theme" aria-label="Toggle theme"></button>
                    <button type="button" class="tg-drawer-disable" aria-label="Disable Telegram theme" title="Disable Telegram theme"></button>
                </div>
            </div>
            <div class="tg-drawer-name"></div>
            <div class="tg-drawer-sub"></div>`;
        head.querySelector('.tg-drawer-theme')?.addEventListener('click', () => {
            const next = tgRoot.dataset.tgVariant === 'night' ? 'day' : 'night';
            tgWrite('variant', next);
            /* Switching manually implies manual mode; otherwise the auto
               scheduler would immediately undo the user's choice. */
            tgWrite('theme-auto', 'manual');
            tgApplyVariant(next);
        });
        head.querySelector('.tg-drawer-disable')?.addEventListener('click', async () => {
            const button = head.querySelector('.tg-drawer-disable');
            if (button) button.disabled = true;
            try {
                const { restorePreviousTheme } = await import('./theme.js');
                restorePreviousTheme();
            } catch (error) {
                console.warn('[ST Telegram] emergency disable could not restore settings:', error);
            }
            tgWrite('enabled', 'off');
            window.setTimeout(() => window.location.reload(), 600);
        });
        holder.prepend(head);
    }

    /* Row labels. */
    for (const drawer of holder.querySelectorAll(':scope > .drawer')) {
        const toggle = drawer.querySelector(':scope > .drawer-toggle');
        const icon = toggle?.querySelector(':scope > .drawer-icon');
        const content = drawer.querySelector(':scope > .drawer-content');
        if (!toggle || !icon) continue;

        let label = toggle.querySelector(':scope > .tg-drawer-label');
        if (!label) {
            label = el('span', 'tg-drawer-label');
            toggle.append(label);
        }

        const cls = [...icon.classList].find((c) => DRAWER_LABELS[c]);
        const text = DRAWER_LABELS[cls] || icon.getAttribute('title') || '';
        if (label.textContent !== text) label.textContent = text;

        /* The native tooltip duplicates the label we just drew. */
        if (icon.hasAttribute('title')) {
            icon.setAttribute('data-tg-title', icon.getAttribute('title') || '');
            icon.removeAttribute('title');
        }

        /* Native settings panels cover the launcher on desktop and mobile.
           Give every panel an explicit way back to the Telegram drawer so a
           user can switch sections without reloading the whole application. */
        if (content && !content.querySelector(':scope > .tg-panel-back')) {
            const back = el('button', 'tg-panel-back');
            back.type = 'button';
            back.setAttribute('aria-label', 'Back to menu');
            back.innerHTML = '<span aria-hidden="true"></span><b>Back</b>';
            back.addEventListener('click', () => returnToDrawer(content));
            content.prepend(back);
        }
    }
}

function refreshDrawerIdentity() {
    const holder = document.getElementById('top-settings-holder');
    const head = holder?.querySelector(':scope > .tg-drawer-head');
    if (!head) return;

    const context = getContext();
    const personaAvatar = context?.userAvatar || context?.user_avatar || null;
    const personas = context?.powerUserSettings?.personas
        || context?.power_user?.personas
        || context?.personas
        || {};
    const personaName = personaAvatar ? personas?.[personaAvatar] : null;
    const name = personaName || context?.name1 || 'You';
    const nameEl = head.querySelector('.tg-drawer-name');
    if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;

    const sub = head.querySelector('.tg-drawer-sub');
    const count = context?.characters?.length ?? 0;
    const text = `${count} character${count === 1 ? '' : 's'}`;
    if (sub && sub.textContent !== text) sub.textContent = text;

    const avatarBox = head.querySelector('.tg-drawer-avatar');
    const img = avatarBox?.querySelector('img');
    if (img && avatarBox) {
        let avatar = null;
        if (personaAvatar) {
            try {
                avatar = context.getThumbnailUrl?.('persona', personaAvatar)
                    || `/User Avatars/${encodeURIComponent(personaAvatar)}`;
            } catch {
                avatar = `/User Avatars/${encodeURIComponent(personaAvatar)}`;
            }
        }

        if (avatar) {
            if (img.getAttribute('src') !== avatar) img.src = avatar;
            img.style.display = '';
            avatarBox.removeAttribute('data-tg-fallback');
        } else {
            img.removeAttribute('src');
            img.style.display = 'none';
            avatarBox.setAttribute('data-tg-fallback', (name[0] || '?').toUpperCase());
        }
    }
}

/* ── SillyTavern's drawer toggle bug ────────────────────────────────────────
 *
 * Opening a drawer in SillyTavern is three steps: mark the currently open one
 * closed; if that actually closed something, wait out the animation (125ms);
 * then toggleClass the target. The trap is that step three FLIPS rather than
 * SETS. SillyTavern also binds an auto-close to mousedown on <html>, which
 * fires before click. The two paths interleave so that one tap opens the
 * drawer synchronously and then closes it again asynchronously.
 *
 * Fix without patching SillyTavern: swallow the mousedown auto-close for our
 * rows in the capture phase. The click handler already closes other drawers,
 * so the auto-close is redundant there anyway.
 */
function blockDrawerAutoClose(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('#top-settings-holder .drawer-toggle')) {
        event.stopPropagation();
    }
}

/* Nested inline-drawers inside a popup are mounted on <body>, outside the
   owning drawer's subtree, so SillyTavern's "clicked outside" listener closes
   the whole panel when you expand one. */
function blockInlineDrawerAutoClose(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.inline-drawer-toggle, .inline-drawer-header')) {
        event.stopPropagation();
    }
}

/* ── Status bar clock ───────────────────────────────────────────────────── */

function refreshClock() {
    const sheld = document.getElementById('sheld');
    if (!sheld) return;
    const now = new Date();
    const text = `${now.getHours()}:${pad2(now.getMinutes())}`;
    if (sheld.getAttribute('data-tg-clock') !== text) {
        sheld.setAttribute('data-tg-clock', text);
    }
}

/* ── Generation state ───────────────────────────────────────────────────── */

let generationSubscribed = false;

function watchGeneration() {
    if (generationSubscribed) return;
    const context = getContext();
    const source = context?.eventSource;
    if (!source) return;

    const types = context.eventTypes || context.event_types || {};
    const on = (key, fallback, active) => {
        const type = types[key] || fallback;
        source.on(type, (...args) => {
            /* SillyTavern emits a dry-run generation while it is only
               assembling a prompt. It must not flip the UI into "typing". */
            if (active && args[2] === true) return;
            typingActive = active;
            refreshHeader();
            refreshFab();
        });
    };

    on('GENERATION_STARTED', 'generation_started', true);
    on('GENERATION_ENDED', 'generation_ended', false);
    on('GENERATION_STOPPED', 'generation_stopped', false);

    const chatChanged = types.CHAT_CHANGED || 'chatLoaded';
    source.on(chatChanged, () => {
        typingActive = false;
        scheduleRefresh();
    });

    generationSubscribed = true;
}

/* ── Refresh loop ───────────────────────────────────────────────────────── */

let observer = null;
let frameId = 0;
let throttleTimer = 0;
let lastRefreshAt = 0;
let refreshing = false;
let dirtyWhileRefreshing = false;

const REFRESH_MIN_GAP = 60;

/* Our own nodes. Mutations inside them must never schedule a refresh or we
   feed ourselves forever. */
const OWNED = '.tg-header, .tg-date-pill, .tg-drawer-head, .tg-drawer-label, .tg-panel-back, .tg-message-action-layer, .tg-scrim, .tg-mic';

/* Classes we set on SillyTavern's own nodes. Seeing one of these change is
   never a reason to refresh -- we are the ones who changed it. */
const OWNED_CLASSES = ['tg-group-start', 'tg-group-end', 'tg-drawer-open', 'tg-group-top'];

/* Is this node one we created? Used to recognise our own writes coming back
   at us through the observer. */
function isOwned(node) {
    if (!(node instanceof Element)) return false;
    return node.matches(OWNED) || Boolean(node.closest(OWNED));
}

function mutationMatters(record) {
    const target = record.target;
    if (!(target instanceof Element)) return false;

    if (target.closest(OWNED)) return false;

    /* childList records whose added and removed nodes are ALL ours.
       This is the one that matters most: refreshMessages() clears and
       rebuilds the date pills on every pass, and those are children of
       #chat -- a node we do not own. Without this check every refresh
       schedules the next one and the loop never stops. */
    if (record.type === 'childList') {
        const touched = [...record.addedNodes, ...record.removedNodes];
        if (touched.length && touched.every(isOwned)) return false;
    }

    /* The prompt manager rewrites the class of ~87 list items on every
       prompt assembly, even while its drawer is closed. It is by far the
       largest source of mutation noise in the app and none of it concerns
       us. */
    if (target.closest('#completion_prompt_manager')) return false;

    /* The composer is driven by its own input listener -- with one exception.
       SillyTavern appends #extensionsMenuButton during initExtensions(), long
       after our startup passes, and ensureComposer() has to move it into the
       Telegram layout. Without this the wand would only be relocated if some
       unrelated event happened to schedule a refresh afterwards.
     *
     * The test is "needs moving", not "is the wand", so our own relocation --
     * which fires this same record -- does not schedule a second pass. */
    if (record.type === 'childList' && [...record.addedNodes].some((node) => {
        if (!(node instanceof Element)) return false;
        const found = node.id === 'extensionsMenuButton' ? node : node.querySelector?.('#extensionsMenuButton');
        return Boolean(found) && found.parentElement?.id !== 'nonQRFormItems';
    })) {
        return true;
    }
    if (target.closest('#send_form, #form_sheld')) return false;

    if (record.type === 'attributes') {
        /* A class attribute rewritten to the same value still fires a
           record. Treating an empty diff as "changed" produces a
           self-sustaining refresh loop that burns CPU with the app idle. */
        if (record.attributeName === 'class') {
            const before = new Set((record.oldValue || '').split(/\s+/).filter(Boolean));
            const after = new Set([...target.classList]);
            const diff = new Set();
            for (const c of after) if (!before.has(c)) diff.add(c);
            for (const c of before) if (!after.has(c)) diff.add(c);

            /* Drop the classes we write ourselves, then judge what is left.
               Checking them individually would wrongly ignore a record in
               which SillyTavern also changed something real. */
            for (const own of OWNED_CLASSES) diff.delete(own);

            /* An attribute rewritten to the same value still fires a record.
               If the remaining diff is empty there is nothing to react to,
               and treating it as a change is a self-sustaining loop that
               burns CPU with the app completely idle. */
            if (diff.size === 0) return false;
        }
        return true;
    }

    return true;
}

function scheduleRefresh() {
    if (frameId || throttleTimer) return;
    const wait = REFRESH_MIN_GAP - (Date.now() - lastRefreshAt);
    if (wait > 0) {
        throttleTimer = window.setTimeout(() => {
            throttleTimer = 0;
            scheduleRefresh();
        }, wait);
        return;
    }
    frameId = window.requestAnimationFrame(runRefresh);
}

function runRefresh() {
    frameId = 0;
    refreshing = true;
    try {
        ensureHeader();
        ensureScrim();
        ensureComposer();
        ensureDrawerChrome();
        refreshHeader();
        refreshDrawerIdentity();
        refreshMessages();
        refreshFab();
        refreshClock();
        watchGeneration();
    } catch (error) {
        console.warn('[ST Telegram] refresh failed:', error);
    } finally {
        refreshing = false;
        lastRefreshAt = Date.now();
    }

    /* Drain the records our own writes just produced. Do NOT disconnect
       around the refresh: that would discard SillyTavern's changes too. */
    const pending = observer?.takeRecords?.() ?? [];
    if (pending.some(mutationMatters)) dirtyWhileRefreshing = true;

    if (dirtyWhileRefreshing) {
        dirtyWhileRefreshing = false;
        scheduleRefresh();
    }
}

/* ── Start ──────────────────────────────────────────────────────────────── */

function start() {
    tgRoot.dataset.tgMessageActions = 'on';
    observer = new MutationObserver((records) => {
        if (!records.some(mutationMatters)) return;
        if (refreshing) {
            dirtyWhileRefreshing = true;
            return;
        }
        scheduleRefresh();
    });

    observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeOldValue: true,
        /* Deliberately no characterData: streaming a reply would fire a
           record per token and trigger a full refresh for each one. */
        attributeFilter: ['class', 'style', 'is_user', 'is_system', 'ch_name', 'mesid'],
    });

    document.addEventListener('mousedown', blockDrawerAutoClose, true);
    document.addEventListener('touchstart', blockDrawerAutoClose, true);
    document.addEventListener('mousedown', blockInlineDrawerAutoClose, true);
    document.addEventListener('touchstart', blockInlineDrawerAutoClose, true);
    document.getElementById('send_textarea')?.addEventListener('input', refreshFab);
    document.getElementById('chat')?.addEventListener('click', onMessageActionRequest);

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (actionSheet) {
            closeActionSheet();
            return;
        }
        const openPanel = document.querySelector('#top-settings-holder .drawer-content.openDrawer');
        if (openPanel) returnToDrawer(openPanel);
        else toggleDrawer(false);
    });

    window.setInterval(refreshClock, 20000);

    runRefresh();
    /* SillyTavern finishes its own startup after ours; catch what it adds. */
    window.setTimeout(runRefresh, 600);
    window.setTimeout(runRefresh, 1800);
}

if (typeof jQuery === 'function') {
    jQuery(() => start());
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
    start();
}

export { toggleDrawer, returnToDrawer, refreshHeader, refreshMessages };
