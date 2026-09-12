/* ST Telegram — user-visible strings.
 *
 * WHY NOT SillyTavern's i18n: its dictionary is a flat map keyed by the English
 * source text, shared by every extension, and `addLocaleData` refuses to
 * override a key that core already defines. Our strings are short and generic
 * ("Search", "Back", "Persona"), so half of them would silently resolve to
 * whatever core meant by the same words in a different context. A private
 * table has no such collisions and needs no load-order coordination.
 *
 * WHY WE STILL FOLLOW SillyTavern's language: the locale is stored in plain
 * localStorage under the literal key 'language' (scripts/i18n.js:4), falling
 * back to navigator.language. Reading it directly is synchronous and works
 * before getContext() exists, which matters because boot.js runs at
 * module-eval time. getCurrentLocale() from the context returns exactly the
 * same value, so there is nothing to gain by waiting for it.
 *
 * MATCHING IS BY PREFIX, not exact. SillyTavern only ships 'ru-ru', but a
 * browser can report a bare 'ru' or a 'ru-by', and a user who set those means
 * Russian either way.
 *
 * ADDING A LANGUAGE: add a table below and a prefix to LOCALES. Any key you
 * omit falls through to the English source string, so a partial table is safe.
 */

const RU = {
    /* Header */
    'Menu': 'Меню',
    'Search': 'Поиск',
    'Extensions': 'Расширения',

    /* Message action sheet */
    'Close message actions': 'Закрыть действия',
    'Back': 'Назад',
    'More': 'Ещё',
    'Action': 'Действие',
    'Previous response': 'Предыдущий ответ',
    'Next response': 'Следующий ответ',
    'Delete': 'Удалить',

    /* Drawer header */
    'Persona settings': 'Настройки персоны',
    'Toggle theme': 'Сменить тему',
    'Disable Telegram theme': 'Отключить тему Telegram',
    'Set persona status': 'Задать статус персоны',
    'Change persona status': 'Изменить статус персоны',
    'Set a status': 'Задать статус',
    'Persona status': 'Статус персоны',
    'Shown under your name in the menu.': 'Показывается под вашим именем в меню.',
    'No connected characters': 'Нет привязанных персонажей',
    'Back to menu': 'Назад в меню',
    'You': 'Вы',

    /* Drawer rows */
    'AI Response': 'Ответ ИИ',
    'API Connections': 'Подключения API',
    'Formatting': 'Форматирование',
    'World Info': 'Информация о мире',
    'User Settings': 'Настройки пользователя',
    'Backgrounds': 'Фоны',
    'Persona': 'Персона',
    'Characters': 'Персонажи',

    /* Settings panel */
    'Enable theme': 'Включить тему',
    "Turning this off restores SillyTavern's own layout.": 'Выключение вернёт стандартный вид SillyTavern.',
    'Theme mode': 'Режим темы',
    'Manual': 'Вручную',
    'Follow system': 'Как в системе',
    'By time of day': 'По времени суток',
    'Theme': 'Тема',
    'Day': 'День',
    'Night': 'Ночь',
    'Day starts at': 'День начинается в',
    'Night starts at': 'Ночь начинается в',
    'Colour scheme': 'Цветовая схема',
    "Recolours the whole app, as Telegram's themes do.": 'Перекрашивает всё приложение, как темы в Telegram.',
    'Blur wallpaper': 'Размыть обои',
    'Softens the chat wallpaper behind messages. Needs the wallpaper on.': 'Смягчает обои чата за сообщениями. Нужны включённые обои.',
    'Full-width messages': 'Сообщения на всю ширину',
    'Monochrome Discord-style chat without bubbles.': 'Однотонный чат без пузырей, как в Discord.',
    'Message text size': 'Размер текста сообщений',
    'Changes only the text inside messages.': 'Меняет только текст внутри сообщений.',
    'Chat wallpaper': 'Обои чата',
    'Animations': 'Анимации',
    'Telegram Mobile': 'Telegram Mobile',
    'Version': 'Версия',
    'Enabling or disabling the theme reloads the page.': 'Включение и отключение темы перезагружает страницу.',

    /* Colour scheme names */
    'Blue': 'Синяя',
    'Teal': 'Бирюзовая',
    'Green': 'Зелёная',
    'Yellow': 'Жёлтая',
    'Orange': 'Оранжевая',
    'Pink': 'Розовая',
    'Violet': 'Фиолетовая',
};

const LOCALES = [
    { prefixes: ['ru', 'be'], table: RU },
];

/* The locale can only change through a full page reload (SillyTavern's own
   language <select> calls location.reload for the same reason), so resolving
   once at module load is correct and saves a localStorage read per string. */
const TABLE = resolveTable();

function resolveTable() {
    let locale = '';
    try {
        locale = String(window.localStorage.getItem('language') || '');
    } catch {
        /* Private-mode browsers throw on localStorage. Fall through to the
           navigator, which never throws. */
    }
    if (!locale) locale = String(navigator.language || navigator.userLanguage || 'en');
    locale = locale.toLowerCase();

    for (const entry of LOCALES) {
        if (entry.prefixes.some((prefix) => locale === prefix || locale.startsWith(`${prefix}-`))) return entry.table;
    }
    return null;
}

/** Translate one string. Unknown keys return unchanged, so English is the source of truth. */
export function t(text) {
    if (!TABLE || typeof text !== 'string') return text;
    return TABLE[text] ?? text;
}

/* Russian needs three forms where English needs two, and the rule is on the
   last two digits: 1 but not 11 -> one; 2-4 but not 12-14 -> few; else many. */
const PLURALS = {
    ru: {
        character: (n) => pickRu(n, 'персонаж', 'персонажа', 'персонажей'),
        connected: (n) => pickRu(n, 'привязанный персонаж', 'привязанных персонажа', 'привязанных персонажей'),
    },
};

function pickRu(n, one, few, many) {
    const mod100 = n % 100;
    const mod10 = n % 10;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

/**
 * "3 characters" / "3 персонажа".
 * @param {number} n
 * @param {'character'|'connected'} noun
 */
export function tCount(n, noun) {
    const count = Number(n) || 0;
    if (TABLE === RU) return `${count} ${PLURALS.ru[noun](count)}`;
    const english = noun === 'connected' ? 'connected character' : 'character';
    return `${count} ${english}${count === 1 ? '' : 's'}`;
}

/** True when the UI is not running in English. Useful for layout that needs more room. */
export function tIsTranslated() {
    return TABLE !== null;
}
