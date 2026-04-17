import { confirm } from "@inquirer/prompts";
import type Stripe from "stripe";
import { resolveSheetConfig } from "./config.js";
import {
    createSubscriptionSchedule,
    findCustomersByOldId,
    getExistingSubscriptions,
    setCustomerOrgIdMetadata,
    validatePriceMapping,
} from "./stripe.js";
import type {
    AppConfig,
    CustomerRow,
    MigrationResult,
    ProcessedBatchSummary,
    ResolvedSheetConfig,
    RunOptions,
    SummaryRow,
} from "./types.js";
import {
    ensureSheetColumns,
    formatSummaryRowLabel,
    getPendingRows,
    getSheetByName,
    listCustomerRows,
    persistWorkbook,
    updateRowResult,
} from "./workbook.js";
import type { Workbook } from "xlsx-populate";

function daysInMonth(year: number, monthIndex: number): number {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function computeFirstBillingDate(targetStartMonth: Date, chargeDay: number, now: Date = new Date()): Date {
    if (!Number.isInteger(chargeDay) || chargeDay <= 0) {
        throw new Error(`Invalid charge day: ${chargeDay}`);
    }

    const effectiveChargeDay = Math.max(chargeDay - 1, 1);
    const year = targetStartMonth.getUTCFullYear();
    const monthIndex = targetStartMonth.getUTCMonth();
    let billingYear = year;
    let billingMonthIndex = monthIndex;

    while (true) {
        const day = Math.min(effectiveChargeDay, daysInMonth(billingYear, billingMonthIndex));
        const candidate = new Date(Date.UTC(billingYear, billingMonthIndex, day, 23, 59, 59));

        if (candidate.getTime() > now.getTime()) {
            return candidate;
        }

        billingMonthIndex += 1;
        if (billingMonthIndex > 11) {
            billingMonthIndex = 0;
            billingYear += 1;
        }
    }
}

function buildIdempotencyKey(summary: SummaryRow, row: CustomerRow): string {
    return [
        "mrr-combined-listing-schedule-v2",
        summary.actualSheetName,
        summary.rowNumber,
        row.rowNumber,
        row.oldId,
    ]
        .join(":")
        .replace(/[^a-zA-Z0-9:_-]+/g, "-")
        .toLowerCase();
}

function summarizeResults(results: MigrationResult[]): ProcessedBatchSummary {
    return results.reduce<ProcessedBatchSummary>(
        (summary, result) => {
            summary.attempted += 1;

            if (result.status === "completed") {
                summary.completed += 1;
            } else if (result.status === "skipped_existing_subscription") {
                summary.skippedExistingSubscription += 1;
            } else {
                summary.errored += 1;
            }

            return summary;
        },
        {
            attempted: 0,
            completed: 0,
            skippedExistingSubscription: 0,
            errored: 0,
            stoppedByApproval: false,
        },
    );
}

export function countsTowardNextTen(result: MigrationResult): boolean {
    return result.status !== "skipped_existing_subscription";
}

function getChunkSize(options: RunOptions): number {
    if (options.selectionMode === "next-ten") {
        return 10;
    }

    if (options.demoMode) {
        return 10;
    }

    return Number.POSITIVE_INFINITY;
}

async function processRow(
    stripe: Stripe,
    resolvedConfig: ResolvedSheetConfig,
    row: CustomerRow,
): Promise<MigrationResult> {
    if (!row.oldId) {
        return {
            rowNumber: row.rowNumber,
            status: "missing_old_id",
            error: "PS Old_ID is blank.",
        };
    }

    if (!row.orgId) {
        return {
            rowNumber: row.rowNumber,
            status: "missing_org_id",
            error: "ORG_ID is blank.",
        };
    }

    if (!Number.isInteger(row.billableUsers) || row.billableUsers <= 0) {
        return {
            rowNumber: row.rowNumber,
            status: "invalid_billable_users",
            error: `Invalid BILLABLE_USERS value: ${String(row.billableUsers)}`,
        };
    }

    if (!Number.isInteger(row.chargeDay) || row.chargeDay <= 0) {
        return {
            rowNumber: row.rowNumber,
            status: "invalid_charge_day",
            error: `Invalid charge day value: ${String(row.chargeDay)}`,
        };
    }

    const customers = await findCustomersByOldId(stripe, row.oldId);

    if (customers?.length === 0) {
        return {
            rowNumber: row.rowNumber,
            status: "customer_not_found",
            error: `No Stripe customer found for old_id=${row.oldId}.`,
        };
    }

    if (customers.length > 1) {
        return {
            rowNumber: row.rowNumber,
            status: "duplicate_customer_match",
            error: `Multiple Stripe customers found for old_id=${row.oldId}.`,
        };
    }

    const customer = customers[0];
    const subscriptions = await getExistingSubscriptions(stripe, customer.id);
    if (subscriptions?.length > 0) {
        return {
            rowNumber: row.rowNumber,
            status: "skipped_existing_subscription",
            error: `Customer already has ${subscriptions.length} non-canceled subscription(s).`,
        };
    }
    console.log(`Processing row ${row.rowNumber} (oldId=${row.oldId}): creating subscription schedule for customer ${customer.id}...`);
    try {
        const firstBillingDate = computeFirstBillingDate(resolvedConfig.summary.targetStartMonth, row.chargeDay);
        await setCustomerOrgIdMetadata(stripe, customer.id, row.orgId);
        const schedule = await createSubscriptionSchedule(stripe, {
            customerId: customer.id,
            oldId: row.oldId,
            summary: resolvedConfig.summary,
            priceId: resolvedConfig.priceId,
            quantity: row.billableUsers,
            couponId: resolvedConfig.couponId,
            firstBillingDate,
            idempotencyKey: buildIdempotencyKey(resolvedConfig.summary, row),
        });
        console.log(`Successfully created subscription schedule ${schedule} for customer ${customer.id} on row ${row.rowNumber}.`);
        return {
            rowNumber: row.rowNumber,
            status: "completed",
            error: `Created subscription schedule ${schedule.id}; start date ${firstBillingDate.toISOString()}.`,
            createdResourceId: schedule.id,
        };
    } catch (error) {
        console.log('received error from Stripe API:', error);
        console.log(`Error processing row ${row.rowNumber} (oldId=${row.oldId}):`, error);
        const message = error instanceof Error ? error.message : String(error);
        return {
            rowNumber: row.rowNumber,
            status: "stripe_error",
            error: message,
        };
    }
}

function printSheetPreview(resolvedConfig: ResolvedSheetConfig, pendingRows: CustomerRow[], options: RunOptions): void {
    const selectedRows = options.selectionMode === "next-ten" ? Math.min(10, pendingRows.length) : pendingRows.length;

    console.log("\nMigration Preview");
    console.table([
        {
            sheet: formatSummaryRowLabel(resolvedConfig.summary),
            product: resolvedConfig.summary.productLabel,
            priceEnv: resolvedConfig.priceMapping.priceEnvKey,
            priceId: resolvedConfig.priceId,
            productEnv: resolvedConfig.priceMapping.productEnvKey,
            productId: resolvedConfig.productId,
            coupon: resolvedConfig.summary.couponLabel,
            couponId: resolvedConfig.couponId ?? "none",
            pendingRows: pendingRows.length,
            selectedRows,
            mode: options.demoMode ? "demo" : "full",
            selection: options.selectionMode,
        },
    ]);
}

export async function runSheetMigration(
    workbook: Workbook,
    config: AppConfig,
    stripe: Stripe,
    summary: SummaryRow,
    options: RunOptions,
): Promise<ProcessedBatchSummary> {
    const resolvedConfig = resolveSheetConfig(config, summary);
    await validatePriceMapping(stripe, resolvedConfig.priceId, resolvedConfig.productId, summary);

    const sheet = getSheetByName(workbook, summary.actualSheetName);
    const columnMap = ensureSheetColumns(sheet);
    await persistWorkbook(workbook, config.workbookPath);

    let pendingRows = getPendingRows(listCustomerRows(sheet, columnMap));
    printSheetPreview(resolvedConfig, pendingRows, options);

    const proceed = await confirm({
        message: "Proceed with this live Stripe migration?",
        default: false,
    });

    if (!proceed) {
        return {
            attempted: 0,
            completed: 0,
            skippedExistingSubscription: 0,
            errored: 0,
            stoppedByApproval: true,
        };
    }

    const results: MigrationResult[] = [];

    if (options.selectionMode === "next-ten") {
        let actionableRowsProcessed = 0;

        for (const row of pendingRows) {
            const result = await processRow(stripe, resolvedConfig, row);
            updateRowResult(sheet, columnMap, result);
            await persistWorkbook(workbook, config.workbookPath);
            results.push(result);

            const statusLabel = `${result.status}`.padEnd(30, " ");
            console.log(`${statusLabel} row ${result.rowNumber}: ${result.error}`);

            if (countsTowardNextTen(result)) {
                actionableRowsProcessed += 1;
            }

            if (actionableRowsProcessed >= 10) {
                break;
            }
        }

        const summaryResult = summarizeResults(results);
        summaryResult.stoppedByApproval = false;
        return summaryResult;
    }

    const queue = pendingRows;
    const chunkSize = options.demoMode ? 10 : getChunkSize(options);
    let shouldContinue = true;
    let offset = 0;

    while (shouldContinue && offset < queue.length) {
        const currentRows = queue.slice(offset, offset + chunkSize);

        for (const row of currentRows) {
            const result = await processRow(stripe, resolvedConfig, row);
            updateRowResult(sheet, columnMap, result);
            await persistWorkbook(workbook, config.workbookPath);
            results.push(result);

            const statusLabel = `${result.status}`.padEnd(30, " ");
            console.log(`${statusLabel} row ${result.rowNumber}: ${result.error}`);
        }

        offset += currentRows.length;

        const remainingCount = queue.length - offset;

        if (options.demoMode && remainingCount > 0) {
            shouldContinue = await confirm({
                message: `Processed ${currentRows.length} row(s). Continue with the next ${Math.min(10, remainingCount)} live migration(s)?`,
                default: false,
            });
        } else {
            shouldContinue = false;
        }
    }

    const summaryResult = summarizeResults(results);
    summaryResult.stoppedByApproval = offset < queue.length;
    return summaryResult;
}
