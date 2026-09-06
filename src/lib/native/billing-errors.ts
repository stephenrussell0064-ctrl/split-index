import { PURCHASES_ERROR_CODE, type PurchasesError } from "@revenuecat/purchases-capacitor";

/**
 * Turns a RevenueCat SDK rejection into something an athlete can act on.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * The previous version of billing.ts read one field off the thrown value —
 * `userCancelled` — and showed "Purchase failed. Please try again." for
 * everything else. That single message is wrong for most of the cases it
 * covers: a user in airplane mode, a user whose card was declined, a user with
 * Screen Time purchase restrictions, and a user who ALREADY OWNS the product
 * all got told to retry an action that cannot succeed on retry.
 *
 * `userCancelled` is also deprecated in the SDK's own typings in favour of
 * comparing `code` against PURCHASES_ERROR_CODE, so reading it was going to
 * break silently — silently because it is an optional boolean, so its
 * disappearance reads as `false`, i.e. "not cancelled", i.e. an error toast
 * shown to every single person who taps Cancel.
 *
 * Kept separate from billing.ts so the mapping is unit-testable without
 * standing up the Capacitor bridge.
 */

export interface MappedPurchaseError {
  /** The user dismissed the sheet themselves. Show nothing at all. */
  cancelled: boolean;
  /**
   * The purchase is awaiting someone else's approval (Ask to Buy / SCA), so
   * it is neither a success nor a failure — access arrives later, via the
   * webhook, if it is approved.
   */
  pending: boolean;
  /** True when "Restore purchases" is the action that actually fixes this. */
  canRestore: boolean;
  /** Empty only when `cancelled` — there is nothing to say about a cancel. */
  message: string;
  code: PURCHASES_ERROR_CODE | null;
}

/**
 * Messages are deliberately specific about whose problem it is and what the
 * next step is. "Please try again" appears only where trying again can
 * actually work.
 */
const MESSAGES: Partial<Record<PURCHASES_ERROR_CODE, Omit<MappedPurchaseError, "code">>> = {
  [PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR]: {
    cancelled: true,
    pending: false,
    canRestore: false,
    message: "",
  },
  [PURCHASES_ERROR_CODE.NETWORK_ERROR]: {
    cancelled: false,
    pending: false,
    canRestore: false,
    message: "No connection. Check your signal and try again.",
  },
  [PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR]: {
    cancelled: false,
    pending: false,
    canRestore: false,
    message: "No connection. Check your signal and try again.",
  },
  [PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR]: {
    cancelled: false,
    pending: false,
    canRestore: false,
    message: "The store is having trouble right now. Please try again shortly.",
  },
  [PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR]: {
    cancelled: false,
    pending: false,
    canRestore: false,
    message:
      "This device isn't allowed to make purchases. Check Screen Time content and privacy restrictions.",
  },
  [PURCHASES_ERROR_CODE.PURCHASE_INVALID_ERROR]: {
    cancelled: false,
    pending: false,
    canRestore: false,
    message: "That payment was declined. Check the payment method on your store account.",
  },
  [PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR]: {
    cancelled: false,
    pending: false,
    canRestore: false,
    message: "That plan isn't available right now. Please try again shortly.",
  },
  // The store knows this account already bought it. Retrying opens a sheet
  // that will refuse again; restoring is the thing that actually works.
  [PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR]: {
    cancelled: false,
    pending: false,
    canRestore: true,
    message: "You already own this. Tap Restore purchases to get your access back.",
  },
  [PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR]: {
    cancelled: false,
    pending: false,
    canRestore: true,
    message:
      "That purchase is already linked to a different Split Index account. Sign in with that account, or contact support.",
  },
  [PURCHASES_ERROR_CODE.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR]: {
    cancelled: false,
    pending: false,
    canRestore: true,
    message:
      "That purchase is already linked to a different Split Index account. Sign in with that account, or contact support.",
  },
  // Ask to Buy (a child's request to a parent) and bank strong-customer
  // authentication both land here. Telling someone this "failed" would be a
  // lie — the sheet has closed but the purchase is still alive.
  [PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR]: {
    cancelled: false,
    pending: true,
    canRestore: false,
    message: "Your purchase is waiting for approval. Premium unlocks as soon as it goes through.",
  },
  [PURCHASES_ERROR_CODE.INELIGIBLE_ERROR]: {
    cancelled: false,
    pending: false,
    canRestore: false,
    message: "This account isn't eligible for that offer.",
  },
  // Every one of these means the app or the RevenueCat dashboard is
  // misconfigured. The athlete cannot fix it and should not be asked to keep
  // tapping; the detail goes to the console for whoever can.
  [PURCHASES_ERROR_CODE.CONFIGURATION_ERROR]: {
    cancelled: false,
    pending: false,
    canRestore: false,
    message: "Purchases aren't set up correctly. Please contact support.",
  },
  [PURCHASES_ERROR_CODE.INVALID_CREDENTIALS_ERROR]: {
    cancelled: false,
    pending: false,
    canRestore: false,
    message: "Purchases aren't set up correctly. Please contact support.",
  },
  [PURCHASES_ERROR_CODE.INVALID_APPLE_SUBSCRIPTION_KEY_ERROR]: {
    cancelled: false,
    pending: false,
    canRestore: false,
    message: "Purchases aren't set up correctly. Please contact support.",
  },
};

const UNMAPPED: Omit<MappedPurchaseError, "code"> = {
  cancelled: false,
  pending: false,
  canRestore: false,
  message: "Purchase failed. Please try again.",
};

/** Reads the RevenueCat error code off an unknown thrown value, or null. */
function readErrorCode(err: unknown): PURCHASES_ERROR_CODE | null {
  if (typeof err !== "object" || err === null) return null;
  const code = (err as Partial<PurchasesError>).code;
  // The bridge sends the code across as a string ("1", "10", …) and the enum's
  // members are those same strings, so a lookup is enough — but a hybrid SDK
  // that starts sending numbers would otherwise fall through to "try again"
  // for cancellation too, which is the one case that must never show a toast.
  if (typeof code === "string") return code as PURCHASES_ERROR_CODE;
  if (typeof code === "number") return String(code) as PURCHASES_ERROR_CODE;
  return null;
}

export function mapPurchaseError(err: unknown): MappedPurchaseError {
  const code = readErrorCode(err);
  const mapped = code !== null ? MESSAGES[code] : undefined;

  if (mapped) return { ...mapped, code };

  // Last resort for a code this map hasn't seen: the SDK's own deprecated
  // flag. Still worth reading — being wrong about cancellation is the
  // expensive mistake, and a future SDK adding a second cancel-ish code
  // would otherwise show an error toast to someone who just tapped X.
  if (typeof err === "object" && err !== null && (err as Partial<PurchasesError>).userCancelled === true) {
    return { cancelled: true, pending: false, canRestore: false, message: "", code };
  }

  return { ...UNMAPPED, code };
}
