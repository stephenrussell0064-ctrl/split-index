import { describe, expect, it } from "vitest";
import { PURCHASES_ERROR_CODE } from "@revenuecat/purchases-capacitor";
import { mapPurchaseError } from "./billing-errors";

describe("mapPurchaseError", () => {
  it("treats a user cancel as silent, never as a failure", () => {
    // The expensive mistake in this whole module: showing "Purchase failed"
    // to someone who deliberately tapped Cancel.
    const mapped = mapPurchaseError({ code: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR });
    expect(mapped.cancelled).toBe(true);
    expect(mapped.message).toBe("");
  });

  it("still detects a cancel from the deprecated userCancelled flag alone", () => {
    // Belt and braces for an SDK that stops sending a code we recognise —
    // the fallback must not be the error toast.
    const mapped = mapPurchaseError({ code: undefined, userCancelled: true });
    expect(mapped.cancelled).toBe(true);
  });

  it("reads a numeric code, not only the string form the bridge sends", () => {
    const mapped = mapPurchaseError({ code: 1 });
    expect(mapped.cancelled).toBe(true);
  });

  it("points an already-owned product at restore rather than at retrying", () => {
    const mapped = mapPurchaseError({
      code: PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR,
    });
    expect(mapped.canRestore).toBe(true);
    expect(mapped.cancelled).toBe(false);
    expect(mapped.message).toMatch(/restore/i);
  });

  it("marks a pending purchase as neither success nor failure", () => {
    // Ask to Buy and SCA. Calling this a failure tells a child's parent the
    // purchase died when it is sitting in their approval queue.
    const mapped = mapPurchaseError({ code: PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR });
    expect(mapped.pending).toBe(true);
    expect(mapped.cancelled).toBe(false);
    expect(mapped.message).not.toBe("");
  });

  it("does not tell an offline user to simply try again with no explanation", () => {
    const mapped = mapPurchaseError({ code: PURCHASES_ERROR_CODE.NETWORK_ERROR });
    expect(mapped.message).toMatch(/connection/i);
  });

  it("falls back to a retry message for an unknown code, without claiming a cancel", () => {
    const mapped = mapPurchaseError({ code: "9999" });
    expect(mapped.cancelled).toBe(false);
    expect(mapped.message).toBe("Purchase failed. Please try again.");
  });

  it("survives a thrown value that is not an object at all", () => {
    for (const thrown of [undefined, null, "boom", 42]) {
      const mapped = mapPurchaseError(thrown);
      expect(mapped.cancelled).toBe(false);
      expect(mapped.message).not.toBe("");
    }
  });
});
