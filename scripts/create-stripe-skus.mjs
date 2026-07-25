// One-off script: creates the annual and lifetime Stripe Prices alongside
// the existing monthly price, attached to the same Product so they show up
// together in the Stripe dashboard. Safe to re-run — it looks up existing
// prices by nickname first and skips creating duplicates.
//
// Usage: node scripts/create-stripe-skus.mjs
// Reads STRIPE_SECRET_KEY and STRIPE_PRICE_ID from .env.local.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Stripe from "stripe";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const path = join(__dirname, "..", ".env.local");
  const text = readFileSync(path, "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

const env = loadEnvLocal();
const secretKey = env.STRIPE_SECRET_KEY;
const existingMonthlyPriceId = env.STRIPE_PRICE_ID;

if (!secretKey) {
  console.error("STRIPE_SECRET_KEY not found in .env.local");
  process.exit(1);
}
if (!existingMonthlyPriceId) {
  console.error("STRIPE_PRICE_ID not found in .env.local");
  process.exit(1);
}

const stripe = new Stripe(secretKey, { apiVersion: "2026-06-24.dahlia" });

async function main() {
  const monthlyPrice = await stripe.prices.retrieve(existingMonthlyPriceId);
  const productId =
    typeof monthlyPrice.product === "string" ? monthlyPrice.product : monthlyPrice.product.id;
  console.log(`Existing monthly price ${existingMonthlyPriceId} belongs to product ${productId}`);

  const existingPrices = await stripe.prices.list({ product: productId, limit: 100 });

  let annualPrice = existingPrices.data.find((p) => p.nickname === "annual");
  if (!annualPrice) {
    annualPrice = await stripe.prices.create({
      product: productId,
      currency: "gbp",
      unit_amount: 2999,
      recurring: { interval: "year" },
      nickname: "annual",
    });
    console.log(`Created annual price: ${annualPrice.id}`);
  } else {
    console.log(`Annual price already exists: ${annualPrice.id}`);
  }

  let lifetimePrice = existingPrices.data.find((p) => p.nickname === "lifetime");
  if (!lifetimePrice) {
    lifetimePrice = await stripe.prices.create({
      product: productId,
      currency: "gbp",
      unit_amount: 7999,
      nickname: "lifetime",
    });
    console.log(`Created lifetime price: ${lifetimePrice.id}`);
  } else {
    console.log(`Lifetime price already exists: ${lifetimePrice.id}`);
  }

  console.log("\nAdd these to your environment (.env.local and Vercel):");
  console.log(`STRIPE_PRICE_ID_MONTHLY=${existingMonthlyPriceId}`);
  console.log(`STRIPE_PRICE_ID_ANNUAL=${annualPrice.id}`);
  console.log(`STRIPE_PRICE_ID_LIFETIME=${lifetimePrice.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
