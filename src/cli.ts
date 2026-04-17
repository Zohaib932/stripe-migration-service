import { confirm, select } from "@inquirer/prompts";
import { loadConfig } from "./config.js";
import { runSheetMigration } from "./migrateSheet.js";
import { createStripeClient } from "./stripe.js";
import { getEligibleSummaryRows, loadWorkbook, formatSummaryRowLabel } from "./workbook.js";

async function main(): Promise<void> {
    const config = loadConfig();
    const workbook = await loadWorkbook(config.workbookPath);
    const summaryRows = getEligibleSummaryRows(workbook);

    if (summaryRows.length === 0) {
        throw new Error("No eligible summary rows were found in the workbook.");
    }

    const demoMode = await confirm({
        message: "Run in demo mode? Demo mode performs 10 live migrations at a time and asks for approval before continuing.",
        default: true,
    });

    const summary = await select({
        message: "Which sheet do you want to migrate?",
        choices: summaryRows.map((row) => ({
            name: formatSummaryRowLabel(row),
            value: row,
            description: `${row.productLabel} | ${row.couponLabel}`,
        })),
    });

    const selectionMode = await select<"whole-sheet" | "next-ten">({
        message: "How much should this run process?",
        choices: [
            { name: "Whole sheet", value: "whole-sheet" },
            { name: "Next 10 pending customers", value: "next-ten" },
        ],
    });

    const stripe = createStripeClient(config.stripeSecretKey);
    const result = await runSheetMigration(workbook, config, stripe, summary, {
        demoMode,
        selectionMode,
    });

    console.log("\nRun Summary");
    console.table([
        {
            attempted: result.attempted,
            completed: result.completed,
            skippedExistingSubscription: result.skippedExistingSubscription,
            errored: result.errored,
            stoppedByApproval: result.stoppedByApproval,
        },
    ]);
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Migration failed: ${message}`);
    process.exitCode = 1;
});
