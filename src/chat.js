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

import { tgRead, tgWrite, tgRoot, tgApplyVariant } from './boot.js?v=0.1.29';

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

function timeLabel(date) {
    return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
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

/* Telegram's magnifier searches the conversation. SillyTavern's equivalent is
   the chat file browser: its search field posts to /api/chats/search, which
   matches MESSAGE TEXT across every chat with the current character, and
   clicking a result opens that chat. That is close enough to Telegram's
   in-chat search to be worth wiring, and it is entirely native -- we only
   open the view and focus its field.
 *
 * With no character selected there is nothing to search, so we fall back to
 * the character list's own search box. */
function openChatSearch() {
    const context = getContext();
    const hasPeer = Boolean(context?.groupId ?? context?.group_id)
        || (context?.characterId ?? context?.character_id) !== undefined;

    if (hasPeer) {
        toggleDrawer(false);
        /* #option_select_chat sits inside the closed #options popup. It is
           still in the DOM with a live delegated handler, so clicking it
           works without showing the menu -- but the click must be deferred
           for the same reason as openChatMenu: SillyTavern's document-level
           handlers would otherwise process our still-bubbling event. */
        window.setTimeout(() => {
            document.getElementById('option_select_chat')?.click();
            /* SillyTavern focuses this itself 200ms after the view opens;
               matching that avoids a race where we focus first and it takes
               the caret back. */
            window.setTimeout(() => {
                document.getElementById('select_chat_search')?.focus();
            }, 280);
        }, 0);
        return;
    }

    openCharacterPanel();
    whenPanelOpen('right-nav-panel', () => {
        document.getElementById('character_search_bar')?.focus();
    });
}

/* The three-dot menu. SillyTavern's #options popup is the real thing and it
   already carries the chat-level actions Telegram puts here, so we open that
   rather than inventing a parallel menu.
 *
 * Forwarding the click naively does NOT work, and this is why:
 * SillyTavern binds a close-on-outside-click handler to `document`. Our
 * button's own click keeps bubbling after we synthesise the one on
 * #options_button, reaches that handler in the same dispatch, and it closes
 * the menu again because the pointer is over our header rather than over the
 * button or the menu. The result is a menu that opens and shuts instantly --
 * indistinguishable from a dead button.
 *
 * Deferring to the next macrotask lets our click finish dispatching first, so
 * SillyTavern's document handler runs while the menu is still closed (it
 * returns early) and only then do we open it. */
function openChatMenu() {
    window.setTimeout(() => {
        document.getElementById('options_button')?.click();
    }, 0);
}

/* Open the Character Management panel, which is where every card, chat file
   and character control lives.
 *
 * The panel is a native drawer, so it must be opened through its own toggle:
 * clicking the icon is what keeps SillyTavern's open/closed bookkeeping (and
 * the .openDrawer class our CSS keys on) in step. */
function openCharacterPanel() {
    return openNativePanel('#rightNavHolder', 'right-nav-panel');
}

/* Where the currently open panel was opened from.
 *
 * 'drawer'  the user picked a section in the launcher, so Back belongs there
 * 'chat'    the user tapped the header avatar, a message avatar or search,
 *           and never saw the launcher -- popping it open on the way back is
 *           an extra screen they did not ask for
 *
 * Without this the drawer slid open every time you closed a character card
 * you had reached straight from the chat. */
let panelOrigin = 'drawer';

/* Set while openNativePanel drives a .drawer-toggle itself, so the launcher's
   own click listener can tell that tap apart from a real one. */
let openingPanelFromChat = false;

/* Run a callback once a panel has actually opened.
 *
 * requestAnimationFrame is NOT usable here: openNativePanel defers its click
 * by a macrotask, and a rAF callback runs before that, so the follow-up would
 * fire against a panel that is still closed. Poll for a few frames instead
 * and give up quietly rather than acting on the wrong state. */
function whenPanelOpen(panelId, run, attempts = 12) {
    const panel = document.getElementById(panelId);
    if (panel?.classList.contains('openDrawer')) {
        run(panel);
        return;
    }
    if (attempts <= 0) return;
    window.setTimeout(() => whenPanelOpen(panelId, run, attempts - 1), 25);
}

/* Open one of SillyTavern's drawer panels from outside the drawer.
 *
 * Two traps, both of which made these buttons look dead:
 *
 * 1. The handler is bound to .drawer-toggle, not to the .drawer-icon inside
 *    it. Clicking the icon works only because the event bubbles, so we click
 *    the toggle directly and do not depend on that.
 *
 * 2. SillyTavern also binds an auto-close to `html` on mousedown/touchstart
 *    which shuts every unpinned .openDrawer whose subtree was not clicked.
 *    Our header is outside that subtree, so the click that opens the panel is
 *    the same gesture that closes it. Deferring by a macrotask lets the
 *    originating event finish first, so the auto-close runs while nothing is
 *    open and the panel we then open survives.
 *
 * Returns immediately; the panel exists but opens on the next tick. */
function openNativePanel(drawerSelector, panelId) {
    const panel = document.getElementById(panelId);
    /* Every caller of this helper is a chat-side entry point: the header
       avatar, a message avatar or search. Record that so Back returns to the
       chat instead of opening a launcher the user never went through. */
    panelOrigin = 'chat';
    /* Close the launcher first so it is not left covering the panel. */
    toggleDrawer(false);

    window.setTimeout(() => {
        const current = document.getElementById(panelId);
        if (current?.classList.contains('openDrawer')) return;
        const toggle = document.querySelector(`${drawerSelector} > .drawer-toggle`)
            || document.querySelector(`${drawerSelector} .drawer-toggle`)
            || document.querySelector(`${drawerSelector} .drawer-icon`);
        if (!(toggle instanceof HTMLElement)) return;
        openingPanelFromChat = true;
        try {
            toggle.click();
        } finally {
            openingPanelFromChat = false;
        }
    }, 0);

    return panel;
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
        openChatSearch();
    });

    node.querySelector('.tg-header-menu')?.addEventListener('click', (event) => {
        event.stopPropagation();
        openChatMenu();
    });

    /* Telegram opens the peer's profile when you tap the avatar or the title.
       #rm_button_selected_ch is SillyTavern's equivalent: it selects the
       current character's card, and handles the group case by itself. */
    const openProfile = () => {
        if (!currentPeer()) return;
        openCharacterPanel();
        whenPanelOpen('right-nav-panel', () => {
            document.getElementById('rm_button_selected_ch')?.click();
        });
    };
    node.querySelector('.tg-header-avatar')?.addEventListener('click', openProfile);
    node.querySelector('.tg-header-titles')?.addEventListener('click', openProfile);
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

function typingLabel() {
    const locale = getContext()?.getCurrentLocale?.()
        || document.documentElement.lang
        || navigator.language
        || '';
    return String(locale).toLowerCase().startsWith('ru') ? 'печатает…' : 'typing…';
}

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
    const empty = !peer;
    node.setAttribute('data-tg-empty', empty ? 'on' : 'off');

    const name = peer?.name ?? 'SillyTelegram';
    if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;

    const status = empty ? '' : (typingActive ? typingLabel() : peer.status);
    if (statusEl && statusEl.textContent !== status) statusEl.textContent = status;
    statusEl?.setAttribute('data-tg-typing', !empty && typingActive ? 'on' : 'off');

    if (avatarImg) {
        if (peer?.avatar) {
            if (avatarImg.getAttribute('src') !== peer.avatar) avatarImg.src = peer.avatar;
            avatarImg.style.display = '';
            avatarBox?.removeAttribute('data-tg-fallback');
        } else if (peer) {
            avatarImg.removeAttribute('src');
            avatarImg.style.display = 'none';
            avatarBox?.setAttribute('data-tg-fallback', (name[0] || '?').toUpperCase());
        } else {
            avatarImg.removeAttribute('src');
            avatarImg.style.display = 'none';
            avatarBox?.removeAttribute('data-tg-fallback');
        }
    }
}

/* ── Message grouping, tails, date pills ────────────────────────────────── */

/* Telegram groups consecutive messages from the same sender on the same day:
   only the first carries the name, only the last carries the avatar and tail.
   We tag rows with .tg-group-start / .tg-group-end and let CSS do the rest. */
function messagesShareGroup(current, adjacent) {
    if (!current || !adjacent || current.key !== adjacent.key) return false;
    if (!current.date && !adjacent.date) return true;
    if (!current.date || !adjacent.date) return false;
    return dateKey(current.date) === dateKey(adjacent.date);
}

function refreshMessages() {
    const chat = document.getElementById('chat');
    if (!chat) return;

    const rows = [...chat.querySelectorAll(':scope > .mes')];
    const context = getContext();
    const messages = context?.chat;
    const entries = rows.map((row, index) => {
        const isUser = row.getAttribute('is_user') === 'true';
        const isSystem = row.getAttribute('is_system') === 'true';
        const name = row.getAttribute('ch_name') || '';
        const mesId = Number(row.getAttribute('mesid'));
        const mes = Number.isNaN(mesId) ? null : messages?.[mesId];
        return {
            row,
            isUser,
            isSystem,
            name,
            key: isSystem ? `sys:${index}` : `${isUser ? 'u' : 'c'}:${name}`,
            date: parseMessageDate(mes),
        };
    });

    /* Remove pills before measuring, so their presence never affects the
       grouping decisions. Clear-then-build. */
    for (const pill of chat.querySelectorAll(':scope > .tg-date-pill')) pill.remove();

    let lastDateKey = null;

    entries.forEach((entry, index) => {
        const { row, isUser, isSystem, name, date } = entry;
        row.classList.toggle('tg-group-start', !messagesShareGroup(entry, entries[index - 1]));
        row.classList.toggle('tg-group-end', !messagesShareGroup(entry, entries[index + 1]));
        row.classList.toggle('tg-has-swipes', !isUser && !isSystem
            && Boolean(row.querySelector('.swipes-counter.swipe-picker-enabled.interactable')));

        if (!isUser && !isSystem && name) {
            const idx = String(nameColorIndex(name));
            if (row.getAttribute('data-tg-name') !== idx) row.setAttribute('data-tg-name', idx);
        } else {
            row.removeAttribute('data-tg-name');
        }

        /* Date pill, from the message data rather than the rendered
           timestamp text -- the rendered form is locale-dependent and has
           bitten this kind of code before. */
        /* ST renders a full locale date in every bubble. Telegram keeps the
           date in separators and shows only the local time beside the ticks. */
        const timestamp = row.querySelector('.ch_name .timestamp');
        if (timestamp && date) timestamp.textContent = timeLabel(date);

        /* Preserve the native nodes so ST can keep updating their values, but
           move them out of the narrow avatar column into the message bubble. */
        const block = row.querySelector(':scope > .mes_block');
        if (block && !isSystem) {
            let meta = block.querySelector(':scope > .tg-message-meta');
            if (!meta) {
                meta = el('div', 'tg-message-meta');
                block.append(meta);
            }
            for (const selector of ['.mesIDDisplay', '.tokenCounterDisplay', '.mes_timer']) {
                const badge = row.querySelector(selector);
                if (badge && badge.parentElement !== meta) meta.append(badge);
            }
        }

        if (date) {
            const key2 = dateKey(date);
            if (key2 !== lastDateKey) {
                const pill = el('div', 'tg-date-pill');
                pill.textContent = dateLabel(date);
                chat.insertBefore(pill, row);
                lastDateKey = key2;
            }
        }
    });
}

/* ── Composer ───────────────────────────────────────────────────────────── */

/* Telegram's composer is [emoji][text][attach][send]. SillyTavern's is
   [hamburger + wand][text][send].
 *
 * The mapping:
 *   #options_button        -> emoji, left
 *   #extensionsMenuButton  -> paperclip, right, beside Send
 *
 * Both are placed entirely by CSS grid. composer.css sets #leftSendForm to
 * display: contents, which dissolves the wrapper so its two buttons become
 * grid items of #nonQRFormItems and can sit in different columns.
 *
 * Nothing here moves them. Two earlier attempts did, and both went wrong:
 * hiding the container took the working emoji button with it, and relocating
 * the wand node fought SillyTavern for ownership of its own DOM. Leaving the
 * tree alone keeps every native handler, Popper anchor and visibility poll
 * working, and makes the layout a pure stylesheet concern. */
function ensureComposer() {
    const items = document.getElementById('nonQRFormItems');
    const right = document.getElementById('rightSendForm');
    if (!items || !right) return;

    /* Remove the imitation wand shipped by an earlier release. Users who
       already loaded it have the node in a live DOM, not on disk. */
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

    /* ST exposes generation by writing display:flex/none directly on the stop
       button. Do not inspect computed display here: our own FAB CSS makes the
       selected control visible and would keep Stop selected forever. */
    const generating = typingActive
        || Boolean(stop?.style.display && stop.style.display !== 'none');

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
    if (button.matches('.mes_unhide')) return 'unhide';
    if (button.matches('.swipe_left')) return 'previous';
    if (button.matches('.swipe_right')) return 'next';
    if (button.matches('#option_regenerate')) return 'regenerate';
    return 'more';
}

function nativeActionAvailable(button) {
    if (!(button instanceof HTMLElement)
        || !button.isConnected
        || button.matches('[disabled], [aria-disabled="true"], .disabled')) return false;

    const style = getComputedStyle(button);
    return style.display !== 'none'
        && style.visibility !== 'hidden';
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
        if (!forceMore && ['copy', 'edit', 'delete', 'unhide', 'previous', 'next', 'regenerate'].includes(action.kind)) primary.push(action);
        else more.push(action);
    };

    /* SillyTavern marks excluded messages as system messages. Until the
       native unhide action restores them, expose only that safe operation. */
    if (row.getAttribute('is_system') === 'true') {
        add(row.querySelector('.extraMesButtons > .mes_unhide, .mes_buttons .mes_unhide'));
        return { primary, more };
    }

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
    button.setAttribute('aria-label', action.label);
    button.title = action.label;
    if (action.kind === 'more' && action.button instanceof Element) {
        const icon = button.querySelector('.tg-action-icon');
        const nativeIcon = action.button.matches('.fa, .fas, .far, .fab, [class*="fa-"]')
            ? action.button
            : action.button.querySelector('.fa, .fas, .far, .fab, [class*="fa-"]');
        const nativeIconClasses = nativeIcon
            ? [...nativeIcon.classList].filter(name => name === 'fa' || name.startsWith('fa-'))
            : [];
        if (nativeIconClasses.length) {
            icon.classList.add('tg-action-native-icon', ...nativeIconClasses);
        }
    }
    button.querySelector('.tg-action-label').textContent = action.label;
    button.addEventListener('click', () => {
        closeActionSheet();
        if (typeof action.run === 'function') action.run();
        else runNativeAction(action.button);
    });
    return button;
}

function openActionSheet(row) {
    if (!(row instanceof HTMLElement)) return false;
    const actions = collectMessageActions(row);
    if (!actions.primary.length && !actions.more.length) return false;

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
            panel.dataset.tgActionPage = 'more';
            panel.replaceChildren(...actions.more.map(makeActionButton));
            const back = el('button', 'tg-message-action tg-action-back');
            back.type = 'button';
            back.setAttribute('aria-label', 'Back');
            back.title = 'Back';
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
    return true;
}

/* Tapping a message avatar opens that sender's card, as it does in Telegram.
 *
 * The sender is resolved per message rather than assumed to be the current
 * peer: in a group each row can be a different character, and the user's own
 * avatar must open the persona settings instead of a character card.
 *
 * This cannot collide with the action sheet, which only fires for targets
 * inside .mes_block; avatars live in .mesAvatarWrapper, a sibling of it. */
function onMessageAvatarClick(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const avatar = target.closest('#chat > .mes .mesAvatarWrapper .avatar');
    if (!avatar) return;
    const row = avatar.closest('#chat > .mes');
    if (!row) return;

    event.preventDefault();
    /* stopImmediatePropagation, not stopPropagation: the action sheet handler
       is bound to this same #chat node, and stopPropagation does not stop
       other listeners on the element the event is currently at. */
    event.stopImmediatePropagation();

    if (row.getAttribute('is_user') === 'true') {
        openPersonaPanel();
        return;
    }

    openSenderCard(row.getAttribute('ch_name') || '');
}

/* Open the persona settings, which is the user's own "profile". */
function openPersonaPanel() {
    openNativePanel('#persona-management-button', 'PersonaManagement');
}

/* Open a character card by NAME, because that is all a message row carries.
 *
 * In a group the sender is usually not the selected character, so clicking
 * .character_select for that name is the only way to reach the right card.
 * We look the name up in the context rather than guessing from the DOM. */
function openSenderCard(name) {
    const context = getContext();
    const characters = context?.characters;

    if (name && Array.isArray(characters)) {
        const index = characters.findIndex((c) => c?.name === name);
        if (index >= 0) {
            openCharacterPanel();
            whenPanelOpen('right-nav-panel', () => {
                /* Prefer SillyTavern's own list entry: it carries the click
                   handler that selects and renders the card. SillyTavern
                   stamps both an id and data-chid onto each row when it
                   builds the list. */
                const entry = document.getElementById(`CharID${index}`)
                    || document.querySelector(`.character_select[data-chid="${index}"]`);
                if (entry instanceof HTMLElement) {
                    entry.click();
                    return;
                }
                /* Not rendered (list paginated or filtered): fall back to the
                   context API, which does the same thing without the DOM. */
                try {
                    context.selectCharacterById?.(index);
                } catch (error) {
                    console.warn('[ST Telegram] could not open character card:', error);
                }
            });
            return;
        }
    }

    /* Unknown sender -- the current peer's own card is the best we can do. */
    openCharacterPanel();
    whenPanelOpen('right-nav-panel', () => {
        document.getElementById('rm_button_selected_ch')?.click();
    });
}

const ACTION_HOLD_MS = 480;
const ACTION_MOVE_PX = 10;
const ACTION_EXCLUSION = [
    'a', 'button', 'input', 'textarea', 'select', 'option', 'label',
    'summary', '[contenteditable]:not([contenteditable="false"])',
    'img', 'picture', 'video', 'audio', 'iframe',
    '.mes_button', '.menu_button', '.mes_buttons', '.mes_edit_buttons',
    '.swipe_left', '.swipeRightBlock',
].join(', ');

let actionPress = null;
let suppressedActionClick = null;

function messageActionRow(target) {
    if (!(target instanceof Element) || target.closest(ACTION_EXCLUSION)) return null;
    const bubble = target.closest('#chat > .mes .mes_block');
    if (!bubble) return null;
    const row = bubble.closest('#chat > .mes');
    if (!(row instanceof HTMLElement)) return null;
    if (row.getAttribute('is_system') === 'true'
        && !nativeActionAvailable(row.querySelector('.extraMesButtons > .mes_unhide, .mes_buttons .mes_unhide'))) return null;
    return { row, bubble };
}

function selectionTouches(node) {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed) return false;
    return node.contains(selection.anchorNode) || node.contains(selection.focusNode);
}

function cancelMessageActionPress() {
    if (!actionPress) return;
    window.clearTimeout(actionPress.timer);
    actionPress.row.classList.remove('tg-action-pressing');
    actionPress = null;
}

function onMessageActionPointerDown(event) {
    if (!event.isPrimary || event.button !== 0 || !['touch', 'pen'].includes(event.pointerType)) return;
    const match = messageActionRow(event.target);
    if (!match) return;

    cancelMessageActionPress();
    match.row.classList.add('tg-action-pressing');
    const press = {
        ...match,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        timer: 0,
    };
    press.timer = window.setTimeout(() => {
        if (actionPress !== press || selectionTouches(press.bubble)) {
            cancelMessageActionPress();
            return;
        }
        cancelMessageActionPress();
        if (openActionSheet(press.row)) {
            suppressedActionClick = { row: press.row, until: performance.now() + 700 };
        }
    }, ACTION_HOLD_MS);
    actionPress = press;
}

function onMessageActionPointerMove(event) {
    if (!actionPress || event.pointerId !== actionPress.pointerId) return;
    if (Math.hypot(event.clientX - actionPress.startX, event.clientY - actionPress.startY) > ACTION_MOVE_PX) {
        cancelMessageActionPress();
    }
}

function onMessageActionPointerEnd(event) {
    if (!actionPress || event.pointerId !== actionPress.pointerId) return;
    cancelMessageActionPress();
}

function onMessageActionContextMenu(event) {
    const match = messageActionRow(event.target);
    if (!match || selectionTouches(match.bubble)) return;
    if (actionSheet && actionTarget === match.row) {
        event.preventDefault();
        return;
    }
    if (openActionSheet(match.row)) event.preventDefault();
}

function suppressClickAfterLongPress(event) {
    if (!suppressedActionClick) return;
    const current = suppressedActionClick;
    suppressedActionClick = null;
    if (performance.now() > current.until || !(event.target instanceof Node) || !current.row.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
}

/* ── Drawer ─────────────────────────────────────────────────────────────── */

function toggleDrawer(open) {
    document.body.classList.toggle('tg-drawer-open', open);
}

/* Close a native SillyTavern settings panel through its real toggle, then
   return to wherever the user actually came from. Keeping this in one helper
   prevents the two drawer state machines from drifting apart on desktop. */
function returnToDrawer(content = document.querySelector('#top-settings-holder .drawer-content.openDrawer')) {
    const backToChat = panelOrigin === 'chat';
    /* Consume it: the next panel is 'drawer' again unless someone says so. */
    panelOrigin = 'drawer';

    if (!(content instanceof Element)) {
        toggleDrawer(!backToChat);
        return;
    }

    const icon = content.parentElement?.querySelector(':scope > .drawer-toggle > .drawer-icon');
    if (icon instanceof HTMLElement) icon.click();
    if (backToChat) return;
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
                const { restorePreviousTheme } = await import('./theme.js?v=0.1.29');
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
            /* Picking a section IN the launcher means Back belongs in the
               launcher. Bound once, alongside the label we just created, so
               it is not re-registered on every refresh pass.
             *
             * openNativePanel drives this same toggle programmatically, and
             * without the guard that click would immediately overwrite the
             * 'chat' origin it had just set. An explicit flag is used rather
             * than event.isTrusted because it states the intent directly and
             * can be exercised by a test, which synthetic clicks cannot do
             * for isTrusted. */
            toggle.addEventListener('click', () => {
                if (!openingPanelFromChat) panelOrigin = 'drawer';
            });
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

/* Which persona is active.
 *
 * getContext() does NOT expose it. The live value is the user_avatar module
 * binding in scripts/personas.js, which the context bridge never re-exports.
 * The previous code read context.userAvatar and context.user_avatar -- both
 * permanently undefined, which is why the drawer showed a fallback letter
 * instead of the persona's picture.
 *
 * SillyTavern does publish the value in the DOM, so we read it from there:
 *   1. the persona list marks the active entry with .selected
 *   2. failing that, any user message carries the same avatar in its <img>
 * Both are what SillyTavern itself renders, so we cannot drift out of sync. */
function currentPersonaAvatar() {
    const selected = document.querySelector('#user_avatar_block .avatar-container.selected');
    const id = selected?.getAttribute('data-avatar-id');
    if (id) return id;
    return null;
}

/* The persona picture as a URL. Preferred over the raw id because the message
   list already holds a resolved, cache-correct src. */
function currentPersonaAvatarUrl() {
    const id = currentPersonaAvatar();
    if (id) {
        const context = getContext();
        try {
            const url = context?.getThumbnailUrl?.('persona', id);
            if (url) return url;
        } catch {
            /* fall through to the DOM copy */
        }
        /* SillyTavern serves persona files from a path WITHOUT a leading
           slash. The old code hardcoded '/User Avatars/...', which 404s when
           SillyTavern is mounted under a sub-path. */
        return `User Avatars/${encodeURIComponent(id)}`;
    }

    /* No persona panel rendered yet: reuse whatever the chat is showing for
       the user's own messages. */
    const fromChat = document.querySelector('#chat > .mes[is_user="true"] .avatar img');
    const src = fromChat?.getAttribute('src');
    return src || null;
}

function refreshDrawerIdentity() {
    const holder = document.getElementById('top-settings-holder');
    const head = holder?.querySelector(':scope > .tg-drawer-head');
    if (!head) return;

    /* #bg1 is SillyTavern's authoritative live wallpaper layer. Copy the
       complete computed CSS value so chat-specific and generated backgrounds
       work without parsing URLs. The main observer already refreshes us when
       SillyTavern changes #bg1's inline style. */
    const wallpaper = document.getElementById('bg1');
    const wallpaperImage = wallpaper ? getComputedStyle(wallpaper).backgroundImage : 'none';
    head.style.setProperty('--tg-drawer-wallpaper', wallpaperImage || 'none');
    head.classList.toggle('tg-has-wallpaper', Boolean(wallpaperImage && wallpaperImage !== 'none'));

    const context = getContext();
    const personaAvatar = currentPersonaAvatar();
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
        const avatar = currentPersonaAvatarUrl();

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
const OWNED = '.tg-header, .tg-date-pill, .tg-message-meta, .tg-drawer-head, .tg-drawer-label, .tg-panel-back, .tg-message-action-layer, .tg-scrim, .tg-mic';

/* Classes we set on SillyTavern's own nodes. Seeing one of these change is
   never a reason to refresh -- we are the ones who changed it. */
const OWNED_CLASSES = [
    'tg-group-start', 'tg-group-end', 'tg-drawer-open', 'tg-group-top',
    'tg-action-target', 'tg-action-pressing', 'tg-has-swipes',
];

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

    /* The composer is driven by its own input listener, and its layout is
       pure CSS -- including the late-arriving #extensionsMenuButton, which
       the grid picks up on its own. Nothing here needs a refresh. */
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
    document.getElementById('chat')?.addEventListener('click', onMessageAvatarClick);
    document.addEventListener('pointerdown', onMessageActionPointerDown);
    document.addEventListener('pointermove', onMessageActionPointerMove);
    document.addEventListener('pointerup', onMessageActionPointerEnd);
    document.addEventListener('pointercancel', onMessageActionPointerEnd);
    document.addEventListener('contextmenu', onMessageActionContextMenu);
    document.addEventListener('click', suppressClickAfterLongPress, true);
    document.addEventListener('scroll', cancelMessageActionPress, { passive: true, capture: true });
    document.addEventListener('selectionchange', () => {
        if (actionPress && selectionTouches(actionPress.bubble)) cancelMessageActionPress();
    });

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
