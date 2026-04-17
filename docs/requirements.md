# Stripe Migration Requirements

## Goal

Assign Stripe subscriptions to existing Stripe customers based on the migration workbook in `mrr_combined_listing.xlsx`.

## In Scope

- Only the first 6 data rows of the `Summary` sheet.
- One selected cohort sheet per run.
- Stripe customer lookup by `metadata.old_id`, matched against `PS Old_ID`.
- Monthly subscription creation using env-configured Stripe price IDs.
- Optional coupon assignment based on the Summary sheet.
- Workbook write-back with `status` and `error` columns.

## Out of Scope

- Summary rows after the first 6.
- Backdating or retroactive billing.
- Non-live dry-run behavior.
- Multi-sheet processing in a single unattended run.

## Workbook Rules

- Summary columns used:
  - `Tab`
  - `Stripe Product SKU`
  - `Logic / Coupon`
  - `Target Start Month`
- Customer sheet columns used:
  - `PS Old_ID`
  - `ORG_ID`
  - `BILLABLE_USERS`
  - `Day charge is on`
- `status` and `error` are created if missing.

## Stripe Rules

- Use Stripe `price_...` IDs for subscription items.
- Keep Stripe product IDs in env as well and validate that the configured price belongs to the configured product.
- Treat any non-canceled, non-`incomplete_expired` subscription as an existing subscription and skip creation.
- Copy workbook `ORG_ID` into Stripe customer `metadata.org_id` before creating the subscription schedule.
- Use raw `BILLABLE_USERS` as the Stripe subscription quantity.
- Use `Day charge is on - 1`, clamped to the 1st of the month, when computing the first billing date.
- If the computed first billing date is in the past, roll it forward to the next valid future month.

## Acceptance Criteria

- Operator can choose demo mode and a target cohort from the in-scope summary rows.
- Operator can process the whole sheet or the next 10 pending rows.
- Demo mode pauses after every 10 live migrations and asks for approval before continuing.
- Successful migrations stamp Stripe customer `metadata.org_id` from the workbook `ORG_ID` column.
- Successful, skipped, and failed rows are written back into the workbook with clear status/error values.
- Reruns do not reprocess rows already marked `completed` or `skipped_existing_subscription`.
