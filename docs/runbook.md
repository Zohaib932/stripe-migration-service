# Operator Runbook

## Before Running

1. Verify `.env` contains the correct Stripe secret key, product IDs, price IDs, and coupon IDs.
2. Confirm the workbook path points to the working copy of `mrr_combined_listing.xlsx`.
3. Confirm the selected customer sheet includes `PS Old_ID`, `ORG_ID`, `BILLABLE_USERS`, and `Day charge is on`.
4. Make sure you understand that demo mode is live and only limits batch size.

## Running the CLI

```powershell
npm run start
```

The CLI will ask:

1. Whether to run in demo mode.
2. Which of the first 6 eligible cohorts to migrate.
3. Whether to migrate the whole sheet or only the next 10 pending customers.
4. Whether to approve the live migration after showing a preview.

## Status Semantics

- `completed`: a new Stripe subscription was created successfully.
- `skipped_existing_subscription`: the Stripe customer already had a non-canceled subscription.
- `customer_not_found`: no Stripe customer matched the workbook `PS Old_ID`.
- `duplicate_customer_match`: multiple Stripe customers matched the workbook `PS Old_ID`.
- `missing_old_id`: the workbook row did not contain a usable `PS Old_ID`.
- `missing_org_id`: the workbook row did not contain a usable `ORG_ID`.
- `invalid_billable_users`: `BILLABLE_USERS` was missing or invalid.
- `invalid_charge_day`: `Day charge is on` was missing or invalid.
- `config_error`: configuration prevented the row from being processed.
- `stripe_error`: Stripe rejected the subscription creation attempt.

## Demo Mode Behavior

- Demo mode processes at most 10 pending rows at a time.
- After each group of 10, the CLI asks whether to continue with the next 10.
- Every accepted step is live and writes back to Stripe and the workbook.

## Reruns

- The CLI treats `completed` and `skipped_existing_subscription` as terminal.
- Error statuses stay retryable, so reruns will pick them up again after you fix the root cause.
- The workbook is saved after each processed row to reduce progress loss if the run is interrupted.
