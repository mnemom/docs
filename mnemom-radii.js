/* Mintlify auto-loads any .js at the content-directory root on every page.
 * Used here to apply a radius token the docs.json schema doesn't expose.
 *
 * Mintlify's Tailwind compiles .rounded-* utilities as
 *   border-radius: var(--rounded-*, fallback)
 * so overriding the custom properties at :root cascades to every callout,
 * card, code block, accordion, etc. without per-selector matching.
 *
 * Target values match `--radius: 0.25rem` in mnemom-website/client/global.css
 * (the frontend limelight token). */

(function () {
  if (document.getElementById("mnemom-limelight-radii")) return;
  var style = document.createElement("style");
  style.id = "mnemom-limelight-radii";
  style.textContent = [
    ":root {",
    "  --rounded-2xl: 0.25rem;",
    "  --rounded-xl: 0.25rem;",
    "  --rounded-lg: 0.25rem;",
    "  --rounded-md: 0.25rem;",
    "  --rounded-sm: 0.125rem;",
    "  --rounded: 0.25rem;",
    "  --rounded-search: 0.25rem;",
    "}",
  ].join("\n");
  document.head.appendChild(style);
})();
