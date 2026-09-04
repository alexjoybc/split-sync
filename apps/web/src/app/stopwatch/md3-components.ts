/**
 * Side-effect registration of `@material/web` custom elements used by the
 * web stopwatch surface.
 *
 * `@material/web` components register themselves as custom elements when
 * their module is imported (e.g. `<md-filled-button>` becomes usable after
 * importing `@material/web/button/filled-button.js`). Import this module
 * once from `stopwatch/layout.tsx` so every stopwatch route can use these
 * elements without each page re-importing the same registrations.
 *
 * Foundation only (#435): no screen renders any of these elements yet.
 * The set below covers the component families ADR 0026 calls out as
 * "chrome around the instrument" (buttons, dialogs, text fields, cards,
 * lists, menus) so follow-up per-screen issues can start using them
 * immediately.
 */

import "@material/web/button/filled-button.js";
import "@material/web/button/filled-tonal-button.js";
import "@material/web/button/outlined-button.js";
import "@material/web/button/text-button.js";
import "@material/web/iconbutton/icon-button.js";
import "@material/web/iconbutton/filled-icon-button.js";
import "@material/web/dialog/dialog.js";
import "@material/web/field/filled-field.js";
import "@material/web/field/outlined-field.js";
import "@material/web/labs/card/elevated-card.js";
import "@material/web/labs/card/filled-card.js";
import "@material/web/labs/card/outlined-card.js";
import "@material/web/list/list.js";
import "@material/web/list/list-item.js";
import "@material/web/menu/menu.js";
import "@material/web/menu/menu-item.js";
import "@material/web/divider/divider.js";
import "@material/web/progress/circular-progress.js";
import "@material/web/progress/linear-progress.js";
