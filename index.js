/* ST Telegram — entry point.
 *
 * Kept deliberately thin. Everything real lives in src/, one module per
 * concern, because the thing this project is modelled on grew into a single
 * 8000-line generated file and that is not a mistake worth repeating.
 *
 * Load order matters:
 *   boot     must be first -- it writes the pre-paint attributes and mounts
 *            the stylesheet before anything can render an unstyled frame.
 *   theme    pushes our values into SillyTavern's power_user.
 *   chat     the message list, header and composer runtime.
 *   settings the extension's own panel; always loads, even when disabled,
 *            otherwise there is no way to switch it back on.
 */

import { TG_ENABLED } from './src/boot.js?v=0.1.8';
import './src/settings.js?v=0.1.8';

/* No top-level await here. Some WebViews -- TauriTavern among them -- never
   finish initialising a dynamically imported module that awaits at the top
   level, and the extension fails silently with no console error. Chaining
   the promise has the same effect and loads everywhere. */
if (TG_ENABLED) {
    Promise.all([
        import('./src/theme.js?v=0.1.8'),
        import('./src/chat.js?v=0.1.8'),
    ]).catch((error) => {
        console.error('[ST Telegram] failed to load:', error);
    });
} else {
    console.info('[ST Telegram] Disabled in the extension panel; only the settings panel is active.');
}
