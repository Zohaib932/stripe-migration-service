import type { CouponMapping, PriceMapping } from "./types.js";

export const PRICE_MAPPINGS: Record<string, PriceMapping> = {
    "Bloom Growth™ Core Monthly": {
        label: "Bloom Growth™ Core Monthly",
        productEnvKey: "STRIPE_PRODUCT_CORE_MONTHLY",
        priceEnvKey: "STRIPE_PRICE_CORE_MONTHLY",
    },
    "Bloom Growth™ Software Platform - Monthly": {
        label: "Bloom Growth™ Software Platform - Monthly",
        productEnvKey: "STRIPE_PRODUCT_SOFTWARE_PLATFORM_MONTHLY",
        priceEnvKey: "STRIPE_PRICE_SOFTWARE_PLATFORM_MONTHLY",
    },
};

export const COUPON_MAPPINGS: Record<string, CouponMapping> = {
    "$100 Off (12 Months)": {
        label: "$100 Off (12 Months)",
        couponEnvKey: "STRIPE_COUPON_100_OFF_12_MONTHS",
    },
    "$150 Off (12 Months)": {
        label: "$150 Off (12 Months)",
        couponEnvKey: "STRIPE_COUPON_150_OFF_12_MONTHS",
    },
    "Full Price (No Coupon)": {
        label: "Full Price (No Coupon)",
        couponEnvKey: null,
    },
    "No Change (Legacy Price)": {
        label: "No Change (Legacy Price)",
        couponEnvKey: null,
    },
};

export function resolvePriceMapping(productLabel: string): PriceMapping {
    const mapping = PRICE_MAPPINGS[productLabel];
    if (!mapping) {
        throw new Error(`Unsupported summary product label: ${productLabel}`);
    }

    return mapping;
}

export function resolveCouponMapping(couponLabel: string): CouponMapping {
    const mapping = COUPON_MAPPINGS[couponLabel];
    if (!mapping) {
        throw new Error(`Unsupported summary coupon label: ${couponLabel}`);
    }

    return mapping;
}
