/* Versioned entry point.
 *
 * SillyTavern loads manifest.js as a plain module URL with no cache-busting
 * query. Browsers -- and especially native shells like TauriTavern -- will
 * happily serve a stale copy across reloads. The only reliable bust is a new
 * FILE NAME per release, so every release adds a new loader-X.Y.Z.js here and
 * points manifest.json at it. Keep the old ones; they cost nothing.
 */
import './index.js?v=0.1.0';
