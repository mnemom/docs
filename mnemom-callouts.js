/* Mintlify auto-loads any .js at the content-directory root on every page.
 * Note and Tip callouts render in default blue and green. This restyles them
 * to a hairline border, a neutral raised surface and a teal left rule. Teal is
 * used only as a rule (a fill), never as text. Warning and Danger callouts keep
 * their default colours because the colour carries meaning there. Logo, brand
 * colours and the dark background are untouched. */

(function () {
  if (document.getElementById("mnemom-callouts")) return;
  var style = document.createElement("style");
  style.id = "mnemom-callouts";
  style.textContent = [
    '.callout[data-callout-type="note"], .callout[data-callout-type="tip"] {',
    "  background-color: rgba(128, 128, 128, 0.08);",
    "  border: 1px solid rgba(128, 128, 128, 0.25);",
    "  border-left: 3px solid #0d9488;",
    "}",
  ].join("\n");
  document.head.appendChild(style);
})();
