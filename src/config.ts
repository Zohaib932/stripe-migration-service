import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { COUPON_MAPPINGS, PRICE_MAPPINGS } from "./mapping.js";
import type { AppConfig, CouponMapping, PriceMapping, ResolvedSheetConfig, SummaryRow } from "./types.js";

dotenv.config();

const envSchema = z.object({
    STRIPE_SECRET_KEY: z.string().min(1),
    WORKBOOK_PATH: z.string().optional(),
    STRIPE_PRODUCT_CORE_MONTHLY: z.string().min(1),
    STRIPE_PRICE_CORE_MONTHLY: z.string().min(1),
    STRIPE_PRODUCT_SOFTWARE_PLATFORM_MONTHLY: z.string().min(1),
    STRIPE_PRICE_SOFTWARE_PLATFORM_MONTHLY: z.string().min(1),
    STRIPE_COUPON_100_OFF_12_MONTHS: z.string().min(1).optional(),
    STRIPE_COUPON_150_OFF_12_MONTHS: z.string().min(1).optional(),
});

export function loadConfig(cwd: string = process.cwd()): AppConfig {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
        throw new Error(`Invalid environment configuration:\n${parsed.error.issues.map((issue) => `- ${issue.path.join(".")}: ${issue.message}`).join("\n")}`);
    }

    const env = parsed.data;

    return {
        workbookPath: path.resolve(cwd, env.WORKBOOK_PATH ?? "mrr_combined_listing.xlsx"),
        stripeSecretKey: env.STRIPE_SECRET_KEY,
        productIds: {
            STRIPE_PRODUCT_CORE_MONTHLY: env.STRIPE_PRODUCT_CORE_MONTHLY,
            STRIPE_PRODUCT_SOFTWARE_PLATFORM_MONTHLY: env.STRIPE_PRODUCT_SOFTWARE_PLATFORM_MONTHLY,
        },
        priceIds: {
            STRIPE_PRICE_CORE_MONTHLY: env.STRIPE_PRICE_CORE_MONTHLY,
            STRIPE_PRICE_SOFTWARE_PLATFORM_MONTHLY: env.STRIPE_PRICE_SOFTWARE_PLATFORM_MONTHLY,
        },
        couponIds: {
            STRIPE_COUPON_100_OFF_12_MONTHS: env.STRIPE_COUPON_100_OFF_12_MONTHS ?? "",
            STRIPE_COUPON_150_OFF_12_MONTHS: env.STRIPE_COUPON_150_OFF_12_MONTHS ?? "",
        },
    };
}

function resolveIdsForMapping(config: AppConfig, priceMapping: PriceMapping, couponMapping: CouponMapping): {
    productId: string;
    priceId: string;
    couponId: string | null;
} {
    const productId = config.productIds[priceMapping.productEnvKey];
    const priceId = config.priceIds[priceMapping.priceEnvKey];

    if (!productId) {
        throw new Error(`Missing product env var: ${priceMapping.productEnvKey}`);
    }

    if (!priceId) {
        throw new Error(`Missing price env var: ${priceMapping.priceEnvKey}`);
    }

    if (!couponMapping.couponEnvKey) {
        return { productId, priceId, couponId: null };
    }

    const couponId = config.couponIds[couponMapping.couponEnvKey];
    if (!couponId) {
        throw new Error(`Missing coupon env var: ${couponMapping.couponEnvKey}`);
    }

    return { productId, priceId, couponId };
}

export function resolveSheetConfig(config: AppConfig, summary: SummaryRow): ResolvedSheetConfig {
    const priceMapping = PRICE_MAPPINGS[summary.productLabel];
    if (!priceMapping) {
        throw new Error(`Unsupported product label in summary row ${summary.rowNumber}: ${summary.productLabel}`);
    }

    const couponMapping = COUPON_MAPPINGS[summary.couponLabel];
    if (!couponMapping) {
        throw new Error(`Unsupported coupon label in summary row ${summary.rowNumber}: ${summary.couponLabel}`);
    }

    const ids = resolveIdsForMapping(config, priceMapping, couponMapping);

    return {
        summary,
        priceMapping,
        couponMapping,
        productId: ids.productId,
        priceId: ids.priceId,
        couponId: ids.couponId,
    };
}
