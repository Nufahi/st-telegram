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

import { TG_ENABLED } from './src/boot.js';
import './src/settings.js';

if (TG_ENABLED) {
    await import('./src/theme.js');
    await import('./src/chat.js');
} else {
    console.info('[ST Telegram] Disabled in the extension panel; only the settings panel is active.');
}
