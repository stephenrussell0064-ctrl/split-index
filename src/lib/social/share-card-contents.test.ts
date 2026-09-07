import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/testing/source-scan";

/**
 * M10 — what a shareable card is allowed to carry, and who agreed to it.
 *
 * D4 permits a shared card to show the username, the score, the tier and the
 * interference finding. The Hybrid card also rendered
 * `Readiness <start> → <end>`, and was reachable from a bare anchor that
 * generated and opened the image before the athlete had seen anything.
 *
 * A CORRECTION THIS TEST ENCODES. The audit called readiness "a Tier 2-derived
 * value", i.e. Article 9 health data. Measured, that is wrong: `computeReadiness`
 * takes `sessions` and returns an acute:chronic workload ratio derived from
 * training load, touching no health table, no PAR-Q answer, no HRV and no sleep
 * row. It is Tier 1 data held on contract necessity. It comes off the card for
 * the reason that survives the correction — a readiness figure beside somebody's
 * name on an image built for public posting is an inference about their physical
 * condition, and D4's allowlist exists so that call is not made per-field.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function source(rel: string): string {
  return stripComments(readFileSync(`${ROOT}/${rel}`, "utf8"));
}

const HYBRID_CARD = "src/app/api/reports/hybrid/card/route.tsx";
const INTERFERENCE_CARD = "src/app/api/interference/report-card/route.tsx";
const SHARE_BUTTON = "src/components/analytics/share-image-button.tsx";

describe("what the generated cards render", () => {
  /** THE FAILING-BEFORE TEST: the old route built and rendered `readinessLine`. */
  it("keeps readiness off the hybrid card", () => {
    const code = source(HYBRID_CARD);
    expect(code).not.toMatch(/readinessLine/);
    expect(code).not.toMatch(/readinessTrend/i);
    expect(code.toLowerCase()).not.toContain("readiness");
  });

  it("neither card touches a health table or an Article 9 answer", () => {
    // The exclusion the finding was actually reaching for. None of these ever
    // appeared on a card; asserted so that adding one is a decision, not a line.
    const forbidden = [
      "hpe_intake",
      "hpe_injury_reports",
      "parq",
      "pregnan",
      "medication",
      "lea_",
      "sleep_logs",
      "recovery_snapshots",
      "body_metrics",
      "hrv",
    ];
    for (const card of [HYBRID_CARD, INTERFERENCE_CARD]) {
      const code = source(card).toLowerCase();
      for (const term of forbidden) {
        expect(code, `${card} references ${term}`).not.toContain(term);
      }
    }
  });

  it("still renders what D4 does permit", () => {
    // A fix that emptied the card would pass every assertion above.
    const code = source(HYBRID_CARD);
    expect(code).toContain("{name}");
    expect(code).toContain("{scoreLine}");
    expect(code).toContain("interferenceHeadline");
  });

  it("keeps both cards behind authentication", () => {
    for (const card of [HYBRID_CARD, INTERFERENCE_CARD]) {
      expect(source(card), card).toMatch(/auth\.getUser\(\)/);
    }
    // And the hybrid one behind the entitlement it is a feature of.
    expect(source(HYBRID_CARD)).toContain("getEntitlements");
  });
});

describe("nothing is shared without the athlete seeing it first", () => {
  const button = source(SHARE_BUTTON);

  it("renders the generated image before offering to share it", () => {
    expect(button).toContain("SharePreviewDialog");
    // The real bytes, not a mock-up: the object URL of the fetched blob.
    expect(button).toMatch(/src=\{url\}/);
  });

  /**
   * The ordering that makes this a consent step rather than a notification:
   * the share call must be reachable only from the dialog's own button.
   */
  it("calls share only from the confirm handler", () => {
    const confirm = button.slice(button.indexOf("async function handleConfirmShare"));
    expect(confirm).toContain("nav.share");
    const generate = button.slice(
      button.indexOf("async function handleGenerate"),
      button.indexOf("function closePreview")
    );
    expect(generate, "generating the card also shared it").not.toContain("nav.share");
    expect(generate, "generating the card also opened it").not.toContain("window.open");
  });

  it("makes every call site declare what its card contains", () => {
    // A required prop, so a new card cannot be shared without someone writing
    // down what is on it.
    expect(button).toMatch(/contentSummary: string;/);
    for (const site of [
      "src/components/analytics/hybrid-report-view.tsx",
      "src/components/analytics/interference-detail.tsx",
      "src/components/analytics/interference-radar-card.tsx",
    ]) {
      expect(source(site), site).toContain("contentSummary=");
    }
  });

  /**
   * The path this replaced. A bare anchor to an ImageResponse route generates
   * and opens the card with no step in between, so the first sight of it is
   * after the fact.
   */
  it("leaves no raw link to a card route", () => {
    const offenders: string[] = [];
    for (const site of [
      "src/components/analytics/hybrid-report-view.tsx",
      "src/components/analytics/interference-detail.tsx",
      "src/components/analytics/interference-radar-card.tsx",
    ]) {
      const code = source(site);
      for (const [i, line] of code.split("\n").entries()) {
        if (/href="\/api\/(reports\/hybrid\/card|interference\/report-card)"/.test(line)) {
          // Legitimate on ShareImageButton, which fetches it. Not on an anchor.
          const around = code.split("\n").slice(Math.max(0, i - 6), i + 1).join("\n");
          if (!around.includes("<ShareImageButton")) offenders.push(`${site}:${i + 1}`);
        }
      }
    }
    expect(
      offenders,
      "these link straight to a card route, so the image is generated and " +
        "opened before the athlete has seen it:\n  " + offenders.join("\n  ")
    ).toEqual([]);
  });

  it("releases the object URL rather than holding every cancelled card", () => {
    expect(button).toContain("URL.revokeObjectURL");
  });
});
