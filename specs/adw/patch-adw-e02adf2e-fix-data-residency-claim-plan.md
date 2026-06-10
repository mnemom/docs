# Spec — Patch: Fix false "never leaves your infrastructure" data-residency claim

- **Status:** Draft
- **Branch:** bug-issue-226-adw-e02adf2e-fix-self-hosted-quickstart-docs
- **Location:** `quickstart/self-hosted.mdx`, `es/quickstart/self-hosted.mdx`, `fr/quickstart/self-hosted.mdx`
- **Related docs:** `app_docs/feature-e02adf2e-self-hosted-quickstart-fix.md`, `agents/e02adf2e/plan/issue-226-adw-e02adf2e-fix-self-hosted-quickstart-docs-plan.md`

## Problem / Objective
**Original Spec:** `app_docs/feature-e02adf2e-self-hosted-quickstart-fix.md`
**Issue:** The **Data residency** section opens (line 271 in all three locales) with "Prompt and response content never leaves your infrastructure." This is false and self-contradictory: the table immediately below lists "LLM provider calls | Anthropic / OpenAI / Gemini APIs (port 443)" as boundary-crossing traffic, and prompts are the payload of those calls. Issue #226 explicitly flagged "prompts go direct to provider APIs" as a residency-accuracy problem. Line 279 already scopes the claim correctly ("never sent to Mnemom's cloud"), but a reader who skims the section opener gets a materially wrong assurance.
**Solution:** Rewrite the opening sentence to scope the guarantee to Mnemom's cloud (matching line 279) and explicitly state that prompts are forwarded to the configured LLM providers, pointing to the table for exact boundaries. Apply the identical correction to the `es/` and `fr/` translations to keep locale parity.

## Approach & Changes
### Files to Modify
- `quickstart/self-hosted.mdx` — line 271 (English)
- `es/quickstart/self-hosted.mdx` — line 271 (Spanish)
- `fr/quickstart/self-hosted.mdx` — line 271 (French)

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fix the English opener
- In `quickstart/self-hosted.mdx`, replace line 271:
  - From: `Prompt and response content never leaves your infrastructure. The following traffic does cross network boundaries:`
  - To: `Prompt and response content is never sent to Mnemom's cloud. However, prompts are forwarded to your configured LLM providers — see the table below for exact traffic boundaries.`

### Step 2: Fix the Spanish opener
- In `es/quickstart/self-hosted.mdx`, replace line 271:
  - From: `El contenido de los prompts y respuestas nunca sale de tu infraestructura. El siguiente tráfico sí cruza los límites de la red:`
  - To: `El contenido de los prompts y respuestas nunca se envía a la nube de Mnemom. Sin embargo, los prompts se reenvían a los proveedores de LLM que configures — consulta la tabla siguiente para ver los límites exactos del tráfico.`

### Step 3: Fix the French opener
- In `fr/quickstart/self-hosted.mdx`, replace line 271:
  - From: `Le contenu des prompts et des réponses ne quitte jamais votre infrastructure. Le trafic suivant franchit les limites réseau :`
  - To: `Le contenu des prompts et des réponses n'est jamais envoyé au cloud Mnemom. Cependant, les prompts sont transmis aux fournisseurs LLM que vous configurez — consultez le tableau ci-dessous pour les limites exactes du trafic.`

### Step 4: Confirm consistency
- Verify each edited opener no longer contradicts the boundary-crossing table (rows for LLM provider calls / heartbeat / agent creation) and aligns with the closing paragraph at line 279 ("never sent to Mnemom's cloud").

## Key Decisions & Rationale
**Lines of code to change:** 3 (one prose line per locale)
**Risk level:** low — prose-only, no nav/link/schema changes, no env-var or contract changes
**Testing required:** doc-example + redirect validators must remain green; no human-in-the-loop or approval contract is touched. Per the capability manifest, `ux_path_globs` is `images/**` only, so this prose `.mdx` edit does not trigger the visual UX-validation phase.

## Verification
Execute every command from the repo/worktree root to validate the patch is complete with zero regressions.

- `npm run check:redirects` — **lint verb.** Redirect-table integrity (and `docs.json` parse).
- `echo "(no typecheck for MDX docs)"` — **typecheck verb** (no-op for MDX).
- `npm ci && npm run check:doc-examples` — **test verb.** Doc-as-spec validator confirms the prose edit introduced no malformed `api.mnemom.ai` example.
- `echo "(Mintlify-hosted build; validated by CI)"` — **build verb** (no-op; Mintlify-hosted).
- `grep -rn "never leaves your infrastructure" quickstart/ es/quickstart/ fr/quickstart/` — must print **nothing** (the false claim is gone from all three locales).
- `mintlify broken-links` — the required **"Validate Mintlify Docs"** check; must report zero broken internal links (run `npm i -g mintlify` once if the CLI is absent).

## Known Limitations / Follow-ups
- The intro paragraph (line 10 in each locale: "Prompt and response content stays within your infrastructure — see [Data residency](#data-residency)…") is softer because it links to the residency table in the same sentence, and is **out of scope** for this patch, which addresses only the `review_change_request` (the section-header sentence at line 271). If a reviewer wants the intro tightened for the same reason, that can be a follow-up.
