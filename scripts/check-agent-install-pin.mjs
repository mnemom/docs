// Gate (MNE-7957): Mnemom Agent install steps must pin the `next` dist-tag.
// A plain `npm install -g @mnemom/mnemom` resolves `latest`, which lacks the
// Mnemom Agent savings counter. Scope: the Mnemom Agent page(s)
// (`**/gateway/agent.mdx`, every locale) and any line that pairs an install
// command with `mnemom agent`. Generic-CLI pages are intentionally NOT in scope.
// Run: npm run check:agent-install-pin   (self-test: add --self-test)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL = /npm\s+(?:i|install|add)\s+(?:-g|--global)\s+@mnemom\/mnemom(?!@next\b)(?![\w-])/;
const AGENT_PAGE = /(^|\/)gateway\/agent\.mdx$/;

export function findViolations(path, text) {
  const onAgentPage = AGENT_PAGE.test(path);
  const out = [];
  text.split("\n").forEach((line, i) => {
    if (!INSTALL.test(line)) return;
    if (onAgentPage || /mnemom agent/.test(line)) out.push(`${path}:${i + 1}: ${line.trim()}`);
  });
  return out;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (name.endsWith(".mdx")) acc.push(full);
  }
  return acc;
}

function selfTest() {
  const bad = findViolations("gateway/agent.mdx", "npm install -g @mnemom/mnemom\n");
  const badLoc = findViolations("fr/gateway/agent.mdx", "npm i -g @mnemom/mnemom\n");
  const badLine = findViolations("x.mdx", "npm install -g @mnemom/mnemom && mnemom agent\n");
  const ok = findViolations("gateway/agent.mdx", "npm install -g @mnemom/mnemom@next\n");
  const generic = findViolations("gateway/cli.mdx", "npm install -g @mnemom/mnemom\n");
  if (bad.length !== 1 || badLoc.length !== 1 || badLine.length !== 1 || ok.length || generic.length) {
    console.error("self-test FAILED", { bad, badLoc, badLine, ok, generic });
    process.exit(1);
  }
  console.log("self-test ok");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = walk(ROOT).flatMap((f) =>
    findViolations(relative(ROOT, f), readFileSync(f, "utf8")),
  );
  if (violations.length) {
    console.error("Mnemom Agent install must use @mnemom/mnemom@next:\n" + violations.join("\n"));
    process.exit(1);
  }
  console.log("check-agent-install-pin: ok");
}
