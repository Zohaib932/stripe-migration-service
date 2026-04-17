import Stripe from "stripe";
import type { CreateSubscriptionInput, ExistingSubscriptionInfo, SummaryRow } from "./types.js";

export function createStripeClient(secretKey: string): Stripe {
    return new Stripe(secretKey, {
        appInfo: {
            name: "stripe-migration-service",
            version: "1.0.0",
        },
    });
}

export async function validatePriceMapping(
    stripe: Stripe,
    priceId: string,
    productId: string,
    summary: SummaryRow,
): Promise<void> {
    const price = await stripe.prices.retrieve(priceId);

    if (price.product !== productId) {
        throw new Error(
            `Configured price ${priceId} does not belong to configured product ${productId} for ${summary.summaryTabName}.`,
        );
    }

    if (!price.recurring || price.recurring.interval !== "month") {
        throw new Error(`Configured price ${priceId} is not a monthly recurring Stripe price.`);
    }
}

export async function findCustomersByOldId(stripe: Stripe, oldId: string): Promise<Stripe.Customer[]> {
    const query = `metadata['old_id']:'${oldId.replace(/'/g, "\\'")}'`;
    const results = await stripe.customers.search({ query, limit: 10 });
    return results.data;
}

export async function getExistingSubscriptions(
    stripe: Stripe,
    customerId: string,
): Promise<ExistingSubscriptionInfo[]> {
    const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
    });

    return subscriptions.data
        .filter((subscription) => subscription.status !== "canceled" && subscription.status !== "incomplete_expired")
        .map((subscription) => ({ id: subscription.id, status: subscription.status }));
}

export async function setCustomerOrgIdMetadata(stripe: Stripe, customerId: string, orgId: string): Promise<void> {
    await stripe.customers.update(customerId, {
        metadata: {
            org_id: orgId,
        },
    });
}

export async function createSubscriptionSchedule(
    stripe: Stripe,
    input: CreateSubscriptionInput,
): Promise<Stripe.SubscriptionSchedule> {
    const firstPhase: Stripe.SubscriptionScheduleCreateParams.Phase = {
        items: [{ price: input.priceId, quantity: input.quantity }],
        proration_behavior: "none",
    };

    if (input.couponId) {
        firstPhase.discounts = [{ coupon: input.couponId }];
    }

    const params: Stripe.SubscriptionScheduleCreateParams = {
        customer: input.customerId,
        start_date: Math.floor(input.firstBillingDate.getTime() / 1000),
        end_behavior: "release",
        metadata: {
            migration_source: "mrr_combined_listing.xlsx",
            migration_sheet: input.summary.actualSheetName,
            migration_summary_tab: input.summary.summaryTabName,
            migration_old_id: input.oldId,
        },
        phases: [firstPhase],
    };

    return stripe.subscriptionSchedules.create(params, {
        idempotencyKey: input.idempotencyKey,
    });
}
