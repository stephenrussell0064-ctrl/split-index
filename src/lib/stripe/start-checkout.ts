export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

export async function startStripeCheckout(): Promise<CheckoutResult> {
  try {
    const res = await fetch("/api/stripe/checkout", { method: "POST" });
    const text = await res.text();

    let data: { url?: string; error?: string } = {};
    if (text) {
      try {
        data = JSON.parse(text) as { url?: string; error?: string };
      } catch {
        // Response was not JSON (e.g. empty 500 body)
      }
    }

    if (!res.ok) {
      if (res.status === 503) {
        return {
          ok: false,
          message:
            data.error ??
            "Stripe not configured. Add STRIPE_SECRET_KEY and STRIPE_PRICE_ID to .env.local",
        };
      }
      return {
        ok: false,
        message: data.error ?? `Payment failed (${res.status})`,
      };
    }

    if (data.url) {
      return { ok: true, url: data.url };
    }

    return { ok: false, message: "Payment failed: no checkout URL returned" };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Payment failed",
    };
  }
}
