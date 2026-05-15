/**
 * doc-examples-extract.mjs — Shared extraction primitives for the
 * doc-as-spec walker (`check-doc-examples.mjs`, T5-1.1 + T5-1.2) and the
 * live executor (`run-doc-examples.mjs`, T5-1.3).
 *
 * Pure functions, no side effects, no global state. Both consumers wrap
 * these with their own validation / execution logic.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ── MDX file walking ──────────────────────────────────────────────────
export function walkMdx(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walkMdx(full, acc);
    else if (entry.endsWith(".mdx") || entry.endsWith(".md")) acc.push(full);
  }
  return acc;
}

export function resolveScope(scopeStr) {
  const items = scopeStr.split(",").map((s) => s.trim()).filter(Boolean);
  return items.flatMap((d) => {
    try {
      const s = statSync(d);
      if (s.isFile()) return d.endsWith(".mdx") || d.endsWith(".md") ? [d] : [];
      if (s.isDirectory()) return walkMdx(d);
    } catch {
      return [];
    }
    return [];
  });
}

// ── Fenced bash-block extraction ──────────────────────────────────────
export function extractBashBlocks(source) {
  const blocks = [];
  const lines = source.split("\n");
  let inFence = false;
  let isBash = false;
  let buf = [];
  let openLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (!inFence) {
        const tag = line.slice(3).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
        inFence = true;
        isBash = ["bash", "sh", "shell", "curl", "console"].includes(tag);
        buf = [];
        openLine = i + 1;
      } else {
        if (isBash) blocks.push({ line: openLine, body: buf.join("\n") });
        inFence = false;
        isBash = false;
      }
    } else if (inFence && isBash) {
      buf.push(line);
    }
  }
  return blocks;
}

// ── Curl extraction (multi-line bodies survive) ───────────────────────
export function extractCurls(blockBody) {
  // Rejoin backslash-line-continuations into single logical units. Inside
  // single-quoted bodies (`-d '{...multi-line JSON...}'`) the JSON spans
  // multiple physical lines WITHOUT `\` markers — those newlines must
  // survive the tokenizer. After rejoin, walk the block as one stream,
  // splitting only on top-level (unquoted) `;` / `&&` / `||` / newlines.
  const text = blockBody.replace(/\\\n\s*/g, " ");

  const curls = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length) {
      const c = text[i];
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (c === "#") {
        while (i < text.length && text[i] !== "\n") i++;
        continue;
      }
      break;
    }
    if (i >= text.length) break;

    const start = i;
    let sq = false;
    let dq = false;
    while (i < text.length) {
      const c = text[i];
      if (c === "\\" && !sq && i + 1 < text.length) {
        i += 2;
        continue;
      }
      if (c === "'" && !dq) sq = !sq;
      else if (c === '"' && !sq) dq = !dq;
      else if (!sq && !dq) {
        if (c === ";") break;
        if (c === "&" && text[i + 1] === "&") break;
        if (c === "|" && text[i + 1] === "|") break;
        if (c === "\n") break;
      }
      i++;
    }
    const cmd = text.slice(start, i).trim();
    if (cmd.startsWith("curl ") || cmd === "curl") curls.push(cmd);
    if (text[i] === ";" || text[i] === "\n") i++;
    else if (text[i] === "&" || text[i] === "|") i += 2;
  }
  return curls;
}

// ── Shell tokenizer (respects quote state, handles backslash escapes) ─
export function shellTokenize(line) {
  const out = [];
  let buf = "";
  let sq = false;
  let dq = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !dq) {
      sq = !sq;
      continue;
    }
    if (c === '"' && !sq) {
      dq = !dq;
      continue;
    }
    if (c === "\\" && (i + 1) < line.length && !sq) {
      buf += line[++i];
      continue;
    }
    if (/\s/.test(c) && !sq && !dq) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
    } else {
      buf += c;
    }
  }
  if (buf) out.push(buf);
  return out;
}

// ── Parse a single curl invocation ────────────────────────────────────
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
export function parseCurl(invocation) {
  const tokens = shellTokenize(invocation);
  if (tokens[0] !== "curl") return null;

  let method = "GET";
  let url = null;
  let body = null;
  const headers = [];
  let explicitMethod = false;

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "-X" || t === "--request") {
      const m = (tokens[++i] ?? "").toUpperCase();
      if (HTTP_METHODS.has(m)) {
        method = m;
        explicitMethod = true;
      }
    } else if (t.startsWith("-X")) {
      const m = t.slice(2).toUpperCase();
      if (HTTP_METHODS.has(m)) {
        method = m;
        explicitMethod = true;
      }
    } else if (t === "-H" || t === "--header") {
      const h = tokens[++i];
      if (h) headers.push(h);
    } else if (t === "-d" || t === "--data" || t === "--data-raw" || t === "--data-binary") {
      body = tokens[++i] ?? null;
      if (!explicitMethod) method = "POST";
    } else if (t === "-u" || t === "--user" || t === "-A" || t === "--user-agent") {
      i++;
    } else if (t === "-o" || t === "--output" || t === "--cookie" || t === "-b") {
      i++;
    } else if (t.startsWith("--")) {
      if (t.includes("=") === false && (t === "--silent" || t === "--fail" || t === "--location" || t === "--include" || t === "--verbose")) {
        // boolean flag
      } else if (!t.includes("=")) {
        i++;
      }
    } else if (t.startsWith("-")) {
      // short combined flags — boolean
    } else if (!url && (t.startsWith("http://") || t.startsWith("https://"))) {
      url = t;
    }
  }
  return url ? { method, url, body, headers } : null;
}

// ── Spec path matching ────────────────────────────────────────────────
export function pathSegmentsFromUrl(url, expectedHost = "api.mnemom.ai") {
  let path;
  try {
    const u = new URL(url);
    if (u.hostname !== expectedHost) return { skip: true, reason: `host=${u.hostname}` };
    path = u.pathname;
  } catch {
    return { skip: true, reason: "unparseable" };
  }

  if (path.startsWith("/v1/")) path = path.slice(3);
  else if (path === "/v1") path = "/";
  else return { skip: true, reason: "not /v1/*" };

  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  const segs = path
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  return { skip: false, segments: segs };
}

export function buildSpecIndex(spec) {
  const specPaths = Object.keys(spec.paths ?? {});
  return specPaths.map((raw) => {
    const segments = raw.split("/").filter(Boolean);
    const methods = Object.keys(spec.paths[raw]).filter((k) =>
      ["get", "post", "put", "patch", "delete", "head", "options"].includes(k),
    );
    return { raw, segments, methods };
  });
}

export function matchSpecPath(segments, specIndex) {
  const candidates = [];
  for (const entry of specIndex) {
    if (entry.segments.length !== segments.length) continue;
    let ok = true;
    let paramCount = 0;
    for (let i = 0; i < segments.length; i++) {
      const specSeg = entry.segments[i];
      if (specSeg.startsWith("{") && specSeg.endsWith("}")) {
        paramCount++;
        continue;
      }
      if (specSeg !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) candidates.push({ entry, paramCount });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.paramCount - b.paramCount);
  return candidates[0].entry;
}

export function templatePathMatchesSegments(templatePath, segments) {
  const tSegs = templatePath.split("/").filter(Boolean);
  if (tSegs.length !== segments.length) return false;
  for (let i = 0; i < tSegs.length; i++) {
    const t = tSegs[i];
    if (t.startsWith("{") && t.endsWith("}")) continue;
    if (t !== segments[i]) return false;
  }
  return true;
}
