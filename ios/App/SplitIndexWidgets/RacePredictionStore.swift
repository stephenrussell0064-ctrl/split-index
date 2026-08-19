import Foundation

/**
 * Shared between the App target and the SplitIndexWidgetsExtension target
 * — same arrangement as SplitIndexActivityAttributes.swift (it lives in the
 * widget folder, which the extension picks up automatically via its
 * synchronized group, and is listed explicitly in the App target's Sources
 * phase). The app WRITES; the widget only ever READS.
 *
 * Why a shared App Group container at all: the predictions live in Supabase
 * and are computed server-side by the Next.js app (see
 * src/app/(app)/dashboard/page.tsx). A widget extension is a separate
 * process with no WebView, no Supabase session, and no network credentials —
 * it cannot fetch any of that itself. So the app hands over the already-
 * computed numbers whenever it renders them, and the widget renders
 * whatever was last handed over.
 *
 * The snapshot is deliberately a state machine, not "a number or zero".
 * There is a real history in this codebase of a placeholder race time being
 * mistaken for a measured one (a hardcoded 25:00 that shipped), so the
 * widget must be able to tell "we have a real prediction" apart from
 * "not enough evidence yet" apart from "nobody is signed in" — and render
 * words, never a fabricated time, for the last two.
 */

/// One rung of the race ladder. `seconds` is always a real, engine-derived
/// prediction — there is no sentinel/placeholder value.
public struct RacePredictionEntry: Codable, Hashable {
    /// Display label as the web app already formats it ("5K", "10K", "Half").
    /// Passed across rather than re-derived natively so the widget can never
    /// disagree with the app about what a distance is called.
    public var label: String
    public var seconds: Double

    public init(label: String, seconds: Double) {
        self.label = label
        self.seconds = seconds
    }
}

public struct RacePredictionSnapshot: Codable, Hashable {
    public enum Status: String, Codable {
        /// A real Tier 2 prediction exists — `headline` is non-nil.
        case ready
        /// The athlete has logged runs, but not enough for the engine to
        /// publish a number yet (tier2IsCalibrating). Show progress, never a time.
        case calibrating
        /// No runs logged at all, or nobody signed in. Show the invitation.
        case noData
    }

    public var status: Status
    /// The 5K — the headline everywhere in this app. Non-nil only when `.ready`.
    public var headline: RacePredictionEntry?
    /// Longer distances for the medium widget (10K, Half). May be empty even
    /// when `.ready`; the small widget never uses it.
    public var ladder: [RacePredictionEntry]
    /// Sessions of evidence behind the prediction — the same count the
    /// Analytics panel shows, so the two can't disagree.
    public var sampleCount: Int
    /// Sessions needed before the engine will publish a number
    /// (TIER2_MIN_SAMPLES_TO_DISPLAY). Only meaningful while `.calibrating`.
    public var samplesNeeded: Int
    /// When the app last handed these numbers over — NOT when the athlete
    /// last ran. Shown so a long-stale widget reads as stale rather than current.
    public var updatedAt: Date

    public init(
        status: Status,
        headline: RacePredictionEntry? = nil,
        ladder: [RacePredictionEntry] = [],
        sampleCount: Int = 0,
        samplesNeeded: Int = 0,
        updatedAt: Date = Date()
    ) {
        self.status = status
        self.headline = headline
        self.ladder = ladder
        self.sampleCount = sampleCount
        self.samplesNeeded = samplesNeeded
        self.updatedAt = updatedAt
    }
}

public enum RacePredictionStore {
    /// Must match the App Groups entitlement on BOTH targets
    /// (App/App.entitlements and SplitIndexWidgets/SplitIndexWidgets.entitlements)
    /// and the group registered on the Apple Developer portal.
    public static let appGroupIdentifier = "group.co.uk.splitindex.app"

    /// Must match `kind` on the widget's StaticConfiguration — it's what
    /// `WidgetCenter.shared.reloadTimelines(ofKind:)` targets.
    public static let widgetKind = "SplitIndexRacePredictionWidget"

    /// Versioned so a future shape change can be introduced without an old
    /// build's decoder choking on it — an unreadable payload degrades to
    /// "no data" (an honest empty state) rather than to a wrong number.
    private static let storageKey = "racePredictions.v1"

    private static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: appGroupIdentifier)
    }

    /// Whether THIS process can actually reach the shared container.
    ///
    /// This is the only trustworthy probe, and the reason matters. An
    /// earlier version of `save` "verified" the write by reading the key
    /// straight back out of the same `UserDefaults` instance — which always
    /// succeeds and therefore proved nothing. `UserDefaults(suiteName:)`
    /// does not fail when the App Groups entitlement is missing: it returns
    /// a working-looking object, keeps the value in this process's own
    /// in-memory domain (so any same-process read-back matches), and simply
    /// never persists it anywhere the widget extension can see. The write
    /// looks perfect from the inside and lands nowhere.
    ///
    /// `containerURL(forSecurityApplicationGroupIdentifier:)` is answered by
    /// the sandbox from the code-signed entitlement rather than from
    /// anything this process holds in memory, so it returns nil exactly when
    /// the App Group is not live for this build — which is the condition we
    /// need to be able to tell the athlete about.
    public static var containerIsReachable: Bool {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupIdentifier
        ) != nil
    }

    /// What the reader (widget, or the app's own status check) can actually
    /// see. Three outcomes that used to be one indistinguishable nil — and
    /// collapsing them is what let a disconnected widget tell an athlete
    /// with a full training history that they had never logged a run.
    public enum Availability {
        /// A payload is present and readable.
        case published(RacePredictionSnapshot)
        /// The container is reachable but empty — the app has not published
        /// yet (fresh install, or the dashboard hasn't been opened since).
        /// An undecodable payload lands here too: the next publish
        /// overwrites it, so "open the app" is the honest advice either way.
        case neverPublished
        /// The App Group is not live for this process. Nothing this app
        /// writes will ever reach the widget until that is fixed.
        case disconnected
    }

    public static func resolve() -> Availability {
        guard containerIsReachable else { return .disconnected }
        guard let data = sharedDefaults?.data(forKey: storageKey) else { return .neverPublished }
        guard let snapshot = try? JSONDecoder().decode(RacePredictionSnapshot.self, from: data) else {
            return .neverPublished
        }
        return .published(snapshot)
    }

    /// Reports whether the payload actually landed somewhere the extension
    /// can read it. The reachability guard is doing the real work here (see
    /// `containerIsReachable`); the read-back that follows only catches an
    /// encode/write fault, which is the cheap half of the problem.
    @discardableResult
    public static func save(_ snapshot: RacePredictionSnapshot) -> Bool {
        guard containerIsReachable,
              let defaults = sharedDefaults,
              let data = try? JSONEncoder().encode(snapshot) else { return false }
        defaults.set(data, forKey: storageKey)
        return defaults.data(forKey: storageKey) == data
    }

    /// Called on sign-out: a widget still showing the previous account's
    /// predicted times on a shared/handed-over phone would be both wrong
    /// and a small privacy leak.
    public static func clear() {
        sharedDefaults?.removeObject(forKey: storageKey)
    }
}

/// Shared formatter so the widget renders exactly what the web app does —
/// the Swift twin of `formatRiegelPrediction` in
/// src/lib/scoring/presentation.ts, including its rounding rule: round the
/// whole value ONCE up front, because rounding the seconds field on its own
/// turns 1499.6s into "24:60" rather than "25:00".
public func formatRacePrediction(_ seconds: Double) -> String {
    let total = Int(seconds.rounded())
    let h = total / 3600
    let m = (total % 3600) / 60
    let s = total % 60
    if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
    return String(format: "%d:%02d", m, s)
}
