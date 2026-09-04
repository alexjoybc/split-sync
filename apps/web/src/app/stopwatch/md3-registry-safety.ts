/**
 * Makes `customElements.define()` idempotent for the stopwatch's
 * `@material/web` registrations.
 *
 * `stopwatch/layout.tsx` (a Server Component) and every stopwatch screen
 * that actually renders `<md-*>` elements both import `./md3-components`
 * for its side effect — but a Server Component's imports are never bundled
 * for the client (see the comment in `md3-components.ts`), so each
 * client-rendered screen (starting with `SoloSessionSwitcher.tsx`, #444)
 * must re-import `./md3-components` itself to get real browser-side
 * registration. That means, while Next server-renders a page's initial
 * HTML, the same `@material/web` leaf modules can end up evaluated more
 * than once across the layout's and the page's separate server chunks —
 * and `customElements.define()` throws on a duplicate tag name, crashing
 * the render. Patching `define()` here to silently skip an
 * already-registered tag makes every registration safe to run more than
 * once, in any order, during SSR or in the browser.
 *
 * This has to live in its own module (rather than as a plain statement at
 * the top of `md3-components.ts`) and be imported FIRST there: ES module
 * evaluation always fully runs a file's own static imports — in source
 * order — before any of that file's own top-level statements, so a plain
 * statement can never run before a sibling import in the same file. A
 * separate first import is the only way to guarantee this patch is in
 * place before the `@material/web` side-effect imports that follow it.
 */

if (typeof customElements !== "undefined") {
  const registry = customElements as CustomElementRegistry & {
    __splitsyncIdempotentDefine?: true;
  };
  if (!registry.__splitsyncIdempotentDefine) {
    const originalDefine = registry.define.bind(registry);
    registry.define = (
      name: string,
      constructor: CustomElementConstructor,
      options?: ElementDefinitionOptions
    ) => {
      if (registry.get(name)) return;
      originalDefine(name, constructor, options);
    };
    registry.__splitsyncIdempotentDefine = true;
  }
}

export {};
