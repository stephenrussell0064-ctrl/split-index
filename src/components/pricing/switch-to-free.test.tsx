import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SwitchToFreeView, type SwitchToFreeViewProps } from "@/components/pricing/switch-to-free";
import type { SubscriptionView } from "@/app/api/stripe/subscription/route";

/**
 * The billing page's "switch to free", state by state.
 *
 * The states cannot be reached against the real Stripe account from a test
 * (the only key on this machine is live, and there is no test subscription to
 * cancel), so the markup is a pure function of the route's answer and is
 * pinned here with renderToStaticMarkup like the other component tests. The
 * route itself has its own tests; this guards what the athlete sees for each
 * answer it can give.
 */

const PERIOD_END = "2026-12-15T09:00:00.000Z";

function stripe(overrides: Partial<NonNullable<SubscriptionView["subscription"]>> = {}): SubscriptionView {
  return {
    source: "stripe",
    sku: "monthly",
    subscription: { status: "active", cancelAtPeriodEnd: false, periodEnd: PERIOD_END, ...overrides },
  };
}

function render(overrides: Partial<SwitchToFreeViewProps> & { view: SubscriptionView }): string {
  const noop = () => {};
  return renderToStaticMarkup(
    <SwitchToFreeView
      native={false}
      step="idle"
      busy={false}
      error={null}
      onSwitch={noop}
      onConfirm={noop}
      onKeep={noop}
      onResume={noop}
      {...overrides}
    />
  );
}

describe("a Stripe subscriber", () => {
  it("starts with a single Switch to free button and no scary copy", () => {
    const html = render({ view: stripe() });
    expect(html).toContain("Switch to free");
    expect(html).not.toContain("Confirm switch");
    expect(html).not.toContain("charged");
  });

  it("confirms with the date premium runs to, and offers a way back", () => {
    const html = render({ view: stripe(), step: "confirming" });
    expect(html).toContain("You keep Premium until 15 December 2026, then move to Free.");
    expect(html).toContain("You won&#x27;t be charged again.");
    expect(html).toContain("Confirm switch to free");
    expect(html).toContain("Keep premium");
  });

  it("shows the end date and an undo once the cancellation is pending", () => {
    const html = render({ view: stripe({ cancelAtPeriodEnd: true }) });
    expect(html).toContain("Premium ends on 15 December 2026.");
    expect(html).toContain("Keep premium");
    expect(html).not.toContain("Switch to free");
  });

  it("copes with Stripe not reporting a period end", () => {
    const html = render({ view: stripe({ cancelAtPeriodEnd: true, periodEnd: null }) });
    expect(html).toContain("Premium ends at the end of this billing period.");
  });

  it("surfaces the route's error sentence under the buttons", () => {
    const html = render({ view: stripe(), step: "confirming", error: "Couldn't update your subscription: card declined" });
    expect(html).toContain("card declined");
  });
});

describe("an App Store subscriber", () => {
  const native: SubscriptionView = { source: "revenuecat", sku: "monthly", subscription: null };

  it("on the web is told where the subscription actually lives, with links", () => {
    const html = render({ view: native });
    expect(html).toContain("App Store or Google Play");
    expect(html).toContain("https://apps.apple.com/account/subscriptions");
    expect(html).toContain("https://play.google.com/store/account/subscriptions");
    expect(html).not.toContain("Switch to free");
  });

  it("in the native shell gets nothing here — ManageSubscription already covers it", () => {
    expect(render({ view: native, native: true })).toBe("");
  });
});

describe("nothing for Stripe to cancel", () => {
  it("renders nothing for hand-granted premium with no source", () => {
    expect(render({ view: { source: null, sku: null, subscription: null } })).toBe("");
  });

  it("renders nothing for a lifetime purchase", () => {
    expect(render({ view: { source: "stripe", sku: "lifetime", subscription: null } })).toBe("");
  });
});
