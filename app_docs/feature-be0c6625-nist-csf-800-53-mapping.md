# NIST CSF / 800-53 Control Mapping Appendix

**ADW ID:** be0c6625
**Date:** 2026-06-18
**Plan-Spec:** agents/be0c6625/plan/issue-261-adw-be0c6625-nist-csf-800-53-control-mapping-appendix-plan.md

## Overview

Adds a new compliance appendix that maps Mnemom's shipped security controls to the **NIST Cybersecurity Framework 2.0** functions and to **NIST SP 800-53 Rev. 5** control families. The page gives enterprise and public-sector buyers a recognizable controls cross-reference alongside the existing AI-specific framework mappings, naming the concrete shipped mechanism behind every claim and stating gaps as gaps.

## What Was Built

- **New guide page** `guides/nist-csf-800-53-mapping.mdx` — a self-contained NIST control-mapping appendix.
- **Mapping by CSF 2.0 function** — six tables, one per function (GOVERN, IDENTIFY, PROTECT, DETECT, RESPOND, RECOVER), each row tying a CSF category to a named Mnemom mechanism and the relevant 800-53 control identifiers.
- **800-53 family index** — a reverse view across 16 control families (AC, AT, AU, CA, CM, CP, IA, IR, MA, MP, PE, PL, RA, SA, SC, SI), each labeled **Shipped**, **Partial**, or **Gap** with the backing mechanism.
- **Gaps and limits section** — explicit gap notes for PE, CA-2/CA-8, SA-12, CP-9, AT-1/AT-2, and MP, anchored so the mapping tables can deep-link to them.
- **Source pins** — CSF 2.0 and SP 800-53 Rev. 5 identifiers pinned to their authoritative NIST DOIs.
- **Navigation + cross-links** — registered in the docs nav and cross-linked from the compliance posture page.

## Technical Implementation

### Files Modified

- `guides/nist-csf-800-53-mapping.mdx`: new 180-line appendix page (frontmatter with `shield-check` icon, six CSF function tables, the 800-53 family index, the gaps section, and a "See also" block).
- `docs.json`: added `guides/nist-csf-800-53-mapping` to the navigation group, placed immediately after `guides/wef-governance`.
- `guides/compliance.mdx`: added a "See also" link pointing to the new mapping page.

### Key Changes

- **Mechanism-named, not aspirational.** Every CSF row cites a concrete shipped control (alignment cards, trust posture, CLPI Policy Engine, Safe House L1/L2/L3, AIP integrity checkpoints, AEGIS, MFA/SSO, RBAC, etc.) and the 800-53 controls it satisfies — mirroring the honesty discipline of the existing [OWASP Agentic Top 10 mapping](/guides/owasp-agentic-top-10).
- **Shipped / Partial / Gap labels** reuse the convention from the OWASP mapping so coverage status reads consistently across the compliance docs.
- **Gaps are first-class and anchored.** Partial/Gap families (PE, CA-2/CA-8, SA-12, CP-9, AT, MP) each have a dedicated, deep-linkable subsection rather than being hidden — e.g. the GV.SC row links to the in-page `#sa-12--supply-chain-protection-build-time` note.
- **Authoritative source pins.** CSF function/category codes are pinned to NIST CSWP 29 (CSF 2.0, Feb 2024); control IDs are pinned to NIST SP 800-53 Rev. 5 (Sept 2020 + Dec 2020 errata).
- **Pure prose/config change.** No application code, dependencies, or build steps — the page slots into the existing Mintlify nav and links bidirectionally with the compliance posture page.

## How to Use

1. From the docs site, open **Guides → NIST CSF / 800-53** (or navigate to `/guides/nist-csf-800-53-mapping`).
2. To answer "how does Mnemom satisfy a given CSF function?", read the **Mapping by CSF 2.0 function** tables top-to-bottom; each row names the mechanism and the 800-53 controls.
3. To answer "what covers control family X?", jump to the **NIST 800-53 family index** for the Shipped/Partial/Gap status and the backing mechanism.
4. For partial or absent coverage, follow the in-table link into the **Gaps and limits** section for the specific limitation and any customer-side responsibility.
5. The page is also reachable from the **Compliance posture** page's "See also" list.

## Configuration

No configuration, environment variables, or settings. `docs.json` remains the navigation/routing contract; the new page is registered there.

## Testing

Run from the worktree root — each gate must exit cleanly:

- `npm run check:redirects` — **lint verb.** Validates the redirect table and page-path invariants are intact after the nav addition.
- `echo "(no typecheck for MDX docs)"` — **typecheck verb** (no-op; MDX has no static type step).
- `npm ci && npm run check:doc-examples` — **test verb.** Doc-as-spec validator; confirms no malformed `api.mnemom.ai` example was introduced.
- `echo "(Mintlify-hosted build; validated by CI)"` — **build verb** (no-op; the site is Mintlify-hosted).
- `mintlify broken-links` — the required **"Validate Mintlify Docs"** check. Must report zero broken links, including the new page's many internal cross-links and the in-page gap anchors.

There is no application code or E2E harness in this repo; the "tests" are the deterministic doc gates above.

## Notes

- **Mapping reflects controls shipped as of this change.** As mechanisms evolve (e.g. SOC 2 Type II readiness, build-time provenance), the Shipped/Partial/Gap labels and gap notes will need to be revisited.
- **Gaps are intentionally explicit.** Several families (PE, MP, AT) are inherited from infrastructure vendors or are the customer's responsibility; the page states this rather than implying platform coverage.
- This is public-facing documentation under a supervised posture: the worker drives the deterministic doc gates green and stops; a human reviews and merges. The final decision is made by a human.
