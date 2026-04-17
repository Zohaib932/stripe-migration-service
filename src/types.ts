export type SummarySheetHeader = "#" | "Tab" | "Stripe Product SKU" | "Logic / Coupon" | "Target Start Month";

export interface SummaryRow {
    index: number;
    rowNumber: number;
    summaryTabName: string;
    actualSheetName: string;
    productLabel: string;
    couponLabel: string;
    targetStartMonth: Date;
    notes?: string;
    resolutionStrategy: "exact" | "normalized" | "ordered-fallback";
}

export interface SheetColumnMap {
    oldId: number;
    orgId: number;
    billableUsers: number;
    chargeDay: number;
    status: number;
    error: number;
}

export interface CustomerRow {
    rowNumber: number;
    oldId: string;
    orgId: string;
    billableUsers: number;
    chargeDay: number;
    currentStatus: string;
    currentError: string;
}

export type MigrationStatus =
    | "completed"
    | "skipped_existing_subscription"
    | "customer_not_found"
    | "duplicate_customer_match"
    | "missing_old_id"
    | "missing_org_id"
    | "invalid_billable_users"
    | "invalid_charge_day"
    | "config_error"
    | "stripe_error";

export interface MigrationResult {
    rowNumber: number;
    status: MigrationStatus;
    error: string;
    createdResourceId?: string;
}

export interface PriceMapping {
    label: string;
    productEnvKey: string;
    priceEnvKey: string;
}

export interface CouponMapping {
    label: string;
    couponEnvKey: string | null;
}

export interface ResolvedSheetConfig {
    summary: SummaryRow;
    priceMapping: PriceMapping;
    couponMapping: CouponMapping;
    productId: string;
    priceId: string;
    couponId: string | null;
}

export interface AppConfig {
    workbookPath: string;
    stripeSecretKey: string;
    productIds: Record<string, string>;
    priceIds: Record<string, string>;
    couponIds: Record<string, string>;
}

export interface RunOptions {
    demoMode: boolean;
    selectionMode: "whole-sheet" | "next-ten";
}

export interface ExistingSubscriptionInfo {
    id: string;
    status: string;
}

export interface CreateSubscriptionInput {
    customerId: string;
    oldId: string;
    summary: SummaryRow;
    priceId: string;
    quantity: number;
    couponId: string | null;
    firstBillingDate: Date;
    idempotencyKey: string;
}

export interface ProcessedBatchSummary {
    attempted: number;
    completed: number;
    skippedExistingSubscription: number;
    errored: number;
    stoppedByApproval: boolean;
}
