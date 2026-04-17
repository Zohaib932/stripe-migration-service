## Plan: Stripe Workbook Migrator

Build a greenfield Node/TypeScript CLI in `c:\Work\bloom\stripe-migration-service` that reads `mrr_combined_listing.xlsx`, restricts processing to the first 6 rows of the `Summary` sheet, lets the operator choose a single customer sheet to migrate, looks up Stripe customers by `metadata.old_id`, creates subscriptions using env-provided `price_...` IDs and optional coupon IDs, and writes per-row `status` / `error` results back into the same workbook. Demo mode is a live, approval-gated mode: process 10 customers, stop, summarize, and ask whether to continue.

**Steps**
1. Bootstrap the CLI project at the repo root with Node.js + TypeScript, a package manager lockfile, and scripts for build/run. Establish a modular source layout from the start so the CLI entrypoint, config, workbook parsing, Stripe access, mapping, migration orchestration, and shared types live in separate focused files rather than one large script. Add dependencies for Stripe, env loading, interactive prompts, and `.xlsx` read/write. At the same time, create baseline repo documentation: a quick-start `README`, a developer-facing requirements/PRD document describing the workbook rules and migration behavior, and an operator runbook for how to execute the CLI safely. This step blocks the rest.
2. Add configuration loading and startup validation in parallel with workbook parsing.
   Validate `STRIPE_SECRET_KEY`, required Stripe `price_...` env vars, optional coupon env vars, and any workbook path override. Fail fast before any API call if required config is missing.
3. Implement workbook ingestion around `c:\Work\bloom\stripe-migration-service\mrr_combined_listing.xlsx`.
   Read the `Summary` sheet, keep only the first 6 populated rows, and treat each row as the control record for one customer sheet: sheet name, subscription label, coupon label, and target start month.
   For the selected customer sheet, require `PS Old_ID`, `BILLABLE_USERS`, and `day charge is on`. If `status` and `error` columns do not exist, add them. `next 10` should mean the next 10 rows whose status is blank or retryable, not rows already marked successful/skipped.
4. Implement the interactive CLI flow. Depends on steps 2 and 3.
   At startup, ask whether to run in demo mode.
   Show only the eligible sheet names from the first 6 `Summary` rows and let the operator choose which one to process.
   Ask whether to process the whole sheet or only the next 10 customers.
   Before execution, display a preview: selected sheet, Stripe price mapping, coupon mapping (if any), batch size, and how many rows are still pending.
5. Implement Stripe mapping and customer lookup. Depends on steps 2, 3, and 4.
   Use the selected summary row to resolve the workbook subscription label to a Stripe `price_...` env value and the coupon label to an optional coupon env value. Recommendation: keep actual Stripe IDs in env and maintain a small explicit label-to-env mapping module in code for the first 6 summary rows, so workbook labels stay human-readable and the code can validate them deterministically.
   Look up customers with Stripe Customer Search using `metadata['old_id']:'<PS Old_ID>'`. Handle zero matches and multiple matches as row-level errors.
6. Implement migration rules and idempotent processing. Depends on step 5.
   For each pending row, fetch the customer, check whether the customer already has any non-canceled subscription, and if so mark the row as skipped rather than creating a new subscription.
   Create the subscription with the resolved Stripe price and `quantity = BILLABLE_USERS`.
   Apply the optional coupon if the summary row specifies one.
   Compute the first billing date from `target start month` (summary sheet) plus `day charge is on` (customer sheet), but do not backdate. If the computed date is already in the past, roll it forward to the next future billing date and avoid retroactive billing. Use Stripe parameters that preserve a future-first charge and disable unwanted proration.
   Include an idempotency key derived from workbook + sheet + row + old_id so retries cannot duplicate subscriptions after partial failures.
7. Implement workbook result writing and checkpointing. Depends on step 6.
   Update each processed row in-place with a normalized `status` and `error` value, then save frequently enough that interruption does not lose progress. Suggested statuses: `completed`, `skipped_existing_subscription`, `customer_not_found`, `duplicate_customer_match`, `invalid_quantity`, `config_error`, `stripe_error`.
   In demo mode, stop after 10 attempted rows, print a summary, and require approval before continuing with the next 10 or the remainder of the sheet.
8. Add verification coverage, operator safeguards, and shareable documentation. Depends on steps 4 through 7.
   Add focused tests around workbook parsing, row filtering, date computation, quantity handling, env validation, and status transitions.
   Add a safe operator summary before any live writes and a final run summary with counts by status.
   Document the implemented behavior in the repo: `README` for setup and command usage, a requirements/PRD document for scope and business rules, and an operator runbook for demo mode, approval checkpoints, reruns, and workbook status semantics.

**Relevant files**
- `c:\Work\bloom\stripe-migration-service\mrr_combined_listing.xlsx` — primary workbook input and in-place status/error output
- `c:\Work\bloom\stripe-migration-service\package.json` — scripts and dependencies
- `c:\Work\bloom\stripe-migration-service\tsconfig.json` — TypeScript compiler setup
- `c:\Work\bloom\stripe-migration-service\.env.example` — required Stripe/config env variables and mapping documentation
- `c:\Work\bloom\stripe-migration-service\src\cli.ts` — interactive console entrypoint
- `c:\Work\bloom\stripe-migration-service\src\config.ts` — env loading and validation
- `c:\Work\bloom\stripe-migration-service\src\workbook.ts` — summary/customer sheet parsing and workbook write-back
- `c:\Work\bloom\stripe-migration-service\src\stripe.ts` — Stripe client, customer lookup, existing-subscription checks, subscription creation
- `c:\Work\bloom\stripe-migration-service\src\mapping.ts` — summary label to env-key resolution for price/coupon IDs
- `c:\Work\bloom\stripe-migration-service\src\migrateSheet.ts` — row processing orchestration, batching, status transitions, demo gating
- `c:\Work\bloom\stripe-migration-service\src\types.ts` — workbook row and summary row types
- `c:\Work\bloom\stripe-migration-service\README.md` — quick-start setup, env configuration, and CLI usage
- `c:\Work\bloom\stripe-migration-service\docs\requirements.md` — migration requirements/PRD, scope boundaries, and acceptance criteria
- `c:\Work\bloom\stripe-migration-service\docs\runbook.md` — operator workflow, demo mode behavior, checkpoint approvals, and rerun guidance

**Verification**
1. Run startup validation with a partial `.env` to confirm the CLI exits before any workbook or Stripe mutation when required config is missing.
2. Run the CLI against `mrr_combined_listing.xlsx` with demo mode enabled and a selected sheet; confirm it processes at most 10 pending rows, writes `status` / `error`, stops, and asks for approval.
3. Verify a row whose `PS Old_ID` does not match any Stripe customer is marked with an error and does not stop the rest of the batch.
4. Verify a customer that already has a non-canceled subscription is marked skipped and is not duplicated.
5. Verify the first billing date logic on rows where the charge day is earlier than today, later than today, and invalid.
6. Verify rerunning the CLI skips rows already marked `completed` and does not duplicate a Stripe subscription after a partial failure.
7. Confirm no sheets beyond the first 6 `Summary` entries are offered in the CLI.
8. Review the checked-in `README`, requirements/PRD document, and runbook to confirm another developer can understand the setup, migration rules, and operational workflow without relying on chat context.

**Decisions**
- Runtime: Node.js + TypeScript.
- Stripe identifiers in env: use Stripe `price_...` IDs for subscription items; do not create subscriptions from `prod_...` IDs.
- Workbook mutation: update the same `mrr_combined_listing.xlsx` file in place.
- Demo mode: live execution limited to 10 rows at a time with an approval checkpoint after each 10.
- Quantity rule: send raw `BILLABLE_USERS` as Stripe subscription quantity.
- Date rule: future-only billing anchor; no retroactive billing/backdating.
- Scope limit: only the first 6 rows of the `Summary` sheet are in scope for this implementation.
- Processing model: one selected sheet per run for operator safety.
- Documentation scope: check in repo-visible developer documentation consisting of a concise requirements/PRD document plus an operator runbook, not just inline code comments or chat context.
- Code organization: keep logic split into small, responsibility-based files with clear names and minimal cross-coupling; avoid a single large migration script.
- Commenting style: add succinct comments where the workbook parsing, date anchoring, Stripe subscription creation, or retry/idempotency logic would not be obvious from the code alone, but do not clutter straightforward code with line-by-line narration.

**Further Considerations**
1. Add a separate non-live `dry-run` flag later if you want a preview mode that makes zero Stripe changes; this is useful but not required for the current scope because your requested demo mode is still live.
2. If workbook labels for subscription/coupon values are unstable, move the label-to-env mapping into a dedicated JSON/YAML config file later; for the first 6 rows, a code mapping module is simpler and safer.
3. If preserving workbook formatting proves important, choose the `.xlsx` library during implementation based on write-back fidelity first, not just parsing convenience.
