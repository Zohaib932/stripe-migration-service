import fs from "node:fs";
import XlsxPopulate from "xlsx-populate";
import type { Sheet, Workbook } from "xlsx-populate";
import type { CustomerRow, MigrationResult, SheetColumnMap, SummaryRow } from "./types.js";

const SUMMARY_SHEET_NAME = "Summary";
const STATUS_HEADER = "status";
const ERROR_HEADER = "error";

interface ColumnRequirement {
    key: keyof Omit<SheetColumnMap, "status" | "error">;
    aliases: string[];
}

const REQUIRED_COLUMNS: ColumnRequirement[] = [
    { key: "oldId", aliases: ["PS Old_ID", "PS Old ID"] },
    { key: "orgId", aliases: ["ORG_ID", "ORG ID", "org_id", "org id"] },
    { key: "billableUsers", aliases: ["BILLABLE_USERS", "Billable Users"] },
    { key: "chargeDay", aliases: ["Day charge is on", "day charge is on"] },
];

function normalizeText(value: unknown): string {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\$/g, " dollar ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\bjun\b/g, "june")
        .replace(/\s+/g, " ")
        .trim();
}

function excelSerialToDate(serial: number): Date {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + serial * 24 * 60 * 60 * 1000);
}

function readCellValueAsDate(cellValue: unknown): Date {
    if (cellValue instanceof Date) {
        return cellValue;
    }

    if (typeof cellValue === "number") {
        return excelSerialToDate(cellValue);
    }

    const date = new Date(String(cellValue));
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Unable to parse workbook date value: ${String(cellValue)}`);
    }

    return date;
}

function toTrimmedString(value: unknown): string {
    return String(value ?? "").trim();
}

function normalizedNamesContainEachOther(left: string, right: string): boolean {
    return left.includes(right) || right.includes(left);
}

function buildSummaryRowCandidate(row: unknown[], index: number) {
    return {
        index,
        rowNumber: index + 2,
        summaryTabName: toTrimmedString(row[1]),
        productLabel: toTrimmedString(row[2]),
        couponLabel: toTrimmedString(row[3]),
        targetStartMonth: readCellValueAsDate(row[4]),
        notes: toTrimmedString(row[5]),
    };
}

export async function loadWorkbook(workbookPath: string): Promise<Workbook> {
    if (!fs.existsSync(workbookPath)) {
        throw new Error(`Workbook not found: ${workbookPath}`);
    }

    return XlsxPopulate.fromFileAsync(workbookPath);
}

export function getEligibleSummaryRows(workbook: Workbook): SummaryRow[] {
    const summarySheet = workbook.sheet(SUMMARY_SHEET_NAME);
    if (!summarySheet) {
        throw new Error("Summary sheet is missing from the workbook.");
    }

    const usedRange = summarySheet.usedRange();
    if (!usedRange) {
        throw new Error("Summary sheet is empty.");
    }

    const values = usedRange.value();
    const workbookTabs = workbook.sheets().map((sheet) => sheet.name());
    const customerSheets = workbookTabs.filter((sheetName) => sheetName !== SUMMARY_SHEET_NAME).slice(0, 6);
    const matchedSheetNames = new Set<string>();
    const dataRows = values.slice(1).filter((row) => row[1]);
    const candidates = dataRows.slice(0, 6).map((row, index) => buildSummaryRowCandidate(row, index));
    const resolvedRows: SummaryRow[] = [];
    const unresolvedCandidates = new Set(candidates.map((candidate) => candidate.index));

    function assignMatches(
        strategy: SummaryRow["resolutionStrategy"],
        matcher: (candidate: ReturnType<typeof buildSummaryRowCandidate>, sheetName: string) => boolean,
    ): void {
        for (const candidate of candidates) {
            if (!unresolvedCandidates.has(candidate.index)) {
                continue;
            }

            const actualSheetName = customerSheets.find(
                (sheetName) => !matchedSheetNames.has(sheetName) && matcher(candidate, sheetName),
            );

            if (!actualSheetName) {
                continue;
            }

            matchedSheetNames.add(actualSheetName);
            unresolvedCandidates.delete(candidate.index);
            resolvedRows.push({
                ...candidate,
                actualSheetName,
                resolutionStrategy: strategy,
            });
        }
    }

    assignMatches("exact", (candidate, sheetName) => sheetName === candidate.summaryTabName);
    assignMatches("normalized", (candidate, sheetName) => normalizeText(sheetName) === normalizeText(candidate.summaryTabName));
    assignMatches(
        "ordered-fallback",
        (candidate, sheetName) => normalizedNamesContainEachOther(normalizeText(sheetName), normalizeText(candidate.summaryTabName)),
    );

    if (resolvedRows.length === 0) {
        throw new Error("Unable to resolve any workbook sheets from the first 6 Summary rows.");
    }

    if (unresolvedCandidates.size > 0 && customerSheets.length >= candidates.length) {
        const unresolvedRowNumbers = candidates
            .filter((candidate) => unresolvedCandidates.has(candidate.index))
            .map((candidate) => candidate.rowNumber)
            .join(", ");

        throw new Error(`Unable to resolve workbook sheet(s) for summary row(s): ${unresolvedRowNumbers}.`);
    }

    return resolvedRows.sort((left, right) => left.index - right.index);
}

function getHeaderRow(sheet: Sheet): string[] {
    const usedRange = sheet.usedRange();
    if (!usedRange) {
        throw new Error(`Sheet ${sheet.name()} is empty.`);
    }

    const values = usedRange.value();
    return Array.isArray(values[0]) ? values[0].map((cell) => toTrimmedString(cell)) : [];
}

export function ensureSheetColumns(sheet: Sheet): SheetColumnMap {
    const headerRow = getHeaderRow(sheet);
    const normalizedHeaders = headerRow.map((header) => normalizeText(header));

    const columnMap = {} as SheetColumnMap;

    for (const requirement of REQUIRED_COLUMNS) {
        const index = requirement.aliases
            .map((alias) => normalizedHeaders.findIndex((header) => header === normalizeText(alias)))
            .find((matchIndex) => matchIndex >= 0);

        if (index === undefined) {
            throw new Error(`Missing required column on sheet ${sheet.name()}: ${requirement.aliases[0]}`);
        }

        columnMap[requirement.key] = index + 1;
    }

    const statusIndex = normalizedHeaders.findIndex((header) => header === normalizeText(STATUS_HEADER));
    if (statusIndex >= 0) {
        columnMap.status = statusIndex + 1;
    } else {
        columnMap.status = headerRow.length + 1;
        sheet.cell(1, columnMap.status).value(STATUS_HEADER);
    }

    const refreshedHeaderLength = Math.max(headerRow.length, columnMap.status);
    const errorIndex = normalizedHeaders.findIndex((header) => header === normalizeText(ERROR_HEADER));
    if (errorIndex >= 0) {
        columnMap.error = errorIndex + 1;
    } else {
        columnMap.error = refreshedHeaderLength + 1;
        sheet.cell(1, columnMap.error).value(ERROR_HEADER);
    }

    return columnMap;
}

function parsePositiveInteger(value: unknown): number {
    const parsed = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return Number.NaN;
    }

    return parsed;
}

export function listCustomerRows(sheet: Sheet, columns: SheetColumnMap): CustomerRow[] {
    const usedRange = sheet.usedRange();
    if (!usedRange) {
        return [];
    }

    const lastRow = usedRange.endCell().rowNumber();
    const rows: CustomerRow[] = [];

    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
        const oldId = toTrimmedString(sheet.cell(rowNumber, columns.oldId).value());
        const orgId = toTrimmedString(sheet.cell(rowNumber, columns.orgId).value());
        const billableUsersValue = sheet.cell(rowNumber, columns.billableUsers).value();
        const chargeDayValue = sheet.cell(rowNumber, columns.chargeDay).value();
        const currentStatus = toTrimmedString(sheet.cell(rowNumber, columns.status).value());
        const currentError = toTrimmedString(sheet.cell(rowNumber, columns.error).value());

        if (!oldId && !orgId && billableUsersValue == null && chargeDayValue == null) {
            continue;
        }

        rows.push({
            rowNumber,
            oldId,
            orgId,
            billableUsers: parsePositiveInteger(billableUsersValue),
            chargeDay: parsePositiveInteger(chargeDayValue),
            currentStatus,
            currentError,
        });
    }

    return rows;
}

export function getPendingRows(rows: CustomerRow[]): CustomerRow[] {
    // Status is audit output only. Every run should re-verify the current Stripe state.
    return rows;
}

export function updateRowResult(sheet: Sheet, columns: SheetColumnMap, result: MigrationResult): void {
    sheet.cell(result.rowNumber, columns.status).value(result.status);
    sheet.cell(result.rowNumber, columns.error).value(result.error);
}

export async function persistWorkbook(workbook: Workbook, workbookPath: string): Promise<void> {
    await workbook.toFileAsync(workbookPath);
}

export function getSheetByName(workbook: Workbook, sheetName: string): Sheet {
    const sheet = workbook.sheet(sheetName);
    if (!sheet) {
        throw new Error(`Sheet not found: ${sheetName}`);
    }

    return sheet;
}

export function formatSummaryRowLabel(summary: SummaryRow): string {
    if (summary.summaryTabName === summary.actualSheetName) {
        return summary.summaryTabName;
    }

    return `${summary.summaryTabName} [sheet: ${summary.actualSheetName}]`;
}
