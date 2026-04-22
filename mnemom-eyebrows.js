/* Mintlify auto-loads any .js at the content-directory root on every page.
 * Used here to match Mintlify's `.eyebrow` label treatment to the frontend
 * limelight convention — uppercased + letter-spaced, semibold → medium —
 * that the docs.json schema doesn't expose.
 *
 * Mintlify default (from the bundled CSS):
 *   .eyebrow { height: 1.25rem; color: var(--primary); font-weight: 600; }
 * Frontend limelight eyebrow (mnemom-website/client/global.css):
 *   --tracking-eyebrow: 0.08em; text-transform: uppercase; font-weight: 500.
 *
 * Method pills (REST GET/POST indicators) are intentionally untouched —
 * they're a technical convention, not the "section label badge" the style
 * guide retired. :root --rounded-lg cascade from mnemom-radii.js already
 * applies the 4 px radius to them. */

(function () {
  if (document.getElementById("mnemom-limelight-eyebrows")) return;
  var style = document.createElement("style");
  style.id = "mnemom-limelight-eyebrows";
  style.textContent = [
    ".eyebrow {",
    "  text-transform: uppercase;",
    "  letter-spacing: 0.08em;",
    "  font-weight: 500;",
    "  font-size: 0.75rem;",
    "}",
  ].join("\n");
  document.head.appendChild(style);
})();
