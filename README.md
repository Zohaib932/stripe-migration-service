# Stripe Migration Service

This repository contains a TypeScript CLI for assigning Stripe subscriptions to customers based on the workbook in `mrr_combined_listing.xlsx`.

## What it does

- Reads the `Summary` sheet and only exposes the first 6 in-scope migration cohorts.
- Lets an operator choose one cohort at a time.
- Looks up Stripe customers by `metadata.old_id` using the `PS Old_ID` column.
- Copies `ORG_ID` from the workbook onto Stripe customer `metadata.org_id` before creating the subscription schedule.
- Skips customers that already have a non-canceled Stripe subscription.
- Creates a Stripe subscription with the configured monthly price, raw `BILLABLE_USERS` quantity, and optional coupon.
- Uses `target start month` plus `Day charge is on - 1` to schedule the first billing date without backdating.
- Writes `status` and `error` columns back into the same workbook for resumable reruns.

## Setup

1. Install dependencies.

```powershell
npm install
```

2. Create a `.env` file from `.env.example` and fill in the Stripe identifiers.

3. Run the CLI.

```powershell
npm run start
```

## Scripts

- `npm run start` runs the interactive CLI with `tsx`.
- `npm run build` compiles the project into `dist/`.
- `npm run check` runs the TypeScript compiler without emitting files.
- `npm run test` runs the Vitest test suite.

## Notes

- The CLI is live. Demo mode limits processing to 10 rows at a time, but it still creates real Stripe subscriptions.
- The code intentionally keeps workbook parsing, Stripe access, config loading, and orchestration in separate modules.
- Additional operational details are in `docs/runbook.md` and the scope/requirements are in `docs/requirements.md`.
