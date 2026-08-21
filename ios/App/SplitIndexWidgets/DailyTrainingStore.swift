import Foundation

/**
 * The payload behind the daily-training home-screen widget
 * (SplitIndexWidgets/DailyTrainingWidget.swift).
 *
 * Same arrangement as RacePredictionStore, deliberately: it lives in the
 * widget folder (which the extension picks up automatically via its
 * synchronized group) and is listed explicitly in the App target's Sources
 * phase, so both processes compile the same type. The app WRITES; the widget
 * only ever READS.
 *
 * Why a shared App Group container at all: the plan is generated server-side
 * by the Next.js app (src/app/api/hpe/plan) from the athlete's Supabase
 * history. A widget extension is a separate process with no WebView, no
 * Supabase session and no network credentials — it cannot fetch a plan. So
 * the app hands over the days it has already rendered, and the widget renders
 * whichever of them is today.
 *
 * THE DAY-BOUNDARY PROBLEM, and why this carries an ARRAY of days rather than
 * just today's session:
 *
 * A widget showing yesterday's session at 7am is worse than useless, and the
 * app cannot be relied on to be running at midnight to push a new one. So the
 * app publishes today plus the next several days, and the widget builds a
 * WidgetKit timeline with one entry per local midnight. The rollover then
 * happens inside WidgetKit, with no app launch, no background task and no
 * network — see `DailyTrainingProvider.getTimeline`.
 *
 * The corollary is that the widget must be able to RUN OUT. An athlete who
 * has not opened the app for a fortnight has a payload whose last day is
 * behind them, and the one thing the widget must never do is keep showing the
 * final known day as though it were today. `day(on:)` returns nil past the end
 * of the payload and the view renders a stale state that says so. This app has
 * already shipped one screen that presented a placeholder as a real number for
 * a week; a stale session presented as today's would be the same mistake with
 * a barbell attached.
 */

/// One prescribed session. Every field is something the web app already
/// rendered — nothing here is derived natively, so the widget and the app
/// cannot disagree about what a session is called or how long it takes.
public struct DailyTrainingSession: Codable, Hashable {
    /// What the athlete calls it — "Long run", "Legs". Never an engine key.
    public var title: String
    /// The one line that says what to actually do. Already trimmed by the web
    /// app to something that fits a home screen.
    public var detail: String
    /// "AM" / "PM". Absent when the plan did not slot it.
    public var slot: String?
    /// "endurance" or "strength" — decides the accent, nothing else.
    public var domain: String
    public var minutes: Int
    public var isQuality: Bool

    public init(
        title: String,
        detail: String,
        slot: String? = nil,
        domain: String = "endurance",
        minutes: Int = 0,
        isQuality: Bool = false
    ) {
        self.title = title
        self.detail = detail
        self.slot = slot
        self.domain = domain
        self.minutes = minutes
        self.isQuality = isQuality
    }
}

/// One calendar day of the block.
///
/// A rest day is a real, valid day with `isRest == true` and a reason. It is
/// NOT an absent day and must never render as "no plan" — the plan prescribing
/// rest is the plan working.
public struct DailyTrainingDay: Codable, Hashable {
    /// Local calendar date as "yyyy-MM-dd". A date-only string rather than a
    /// `Date` on purpose: the athlete's Tuesday is the Tuesday on the phone in
    /// their hand, and an instant serialised through UTC slips across midnight
    /// for anyone east or west of Greenwich.
    public var date: String
    public var isRest: Bool
    /// Why the day is clear. Present on a rest day, absent otherwise.
    public var restReason: String?
    /// "Week 3 · Build" — context, in the app's own words.
    public var weekLabel: String
    public var totalMinutes: Int
    public var sessions: [DailyTrainingSession]

    public init(
        date: String,
        isRest: Bool,
        restReason: String? = nil,
        weekLabel: String = "",
        totalMinutes: Int = 0,
        sessions: [DailyTrainingSession] = []
    ) {
        self.date = date
        self.isRest = isRest
        self.restReason = restReason
        self.weekLabel = weekLabel
        self.totalMinutes = totalMinutes
        self.sessions = sessions
    }
}

public struct DailyTrainingSnapshot: Codable, Hashable {
    public enum Status: String, Codable {
        /// A real plan exists and `days` covers at least today.
        case ready
        /// The engine has not built a plan — missing intake, a paused rollout,
        /// a tier gate. `headline`/`message` carry the app's own words for it.
        case noPlan
        /// A plan exists but today falls outside its dates: the block finished,
        /// or has not started. Distinct from `noPlan` because the answer is
        /// different — one needs an intake, the other needs a new block.
        case betweenBlocks
    }

    public var status: Status
    /// Today first, then as many following days as the app could publish.
    /// Empty for every status but `.ready`.
    public var days: [DailyTrainingDay]
    /// Short title for a non-ready state, e.g. "No plan yet".
    public var headline: String?
    /// One concrete next step for a non-ready state.
    public var message: String?
    /// When the app last published — NOT when the athlete last trained.
    public var updatedAt: Date

    public init(
        status: Status,
        days: [DailyTrainingDay] = [],
        headline: String? = nil,
        message: String? = nil,
        updatedAt: Date = Date()
    ) {
        self.status = status
        self.days = days
        self.headline = headline
        self.message = message
        self.updatedAt = updatedAt
    }

    /// The day matching `date` in the CURRENT LOCALE'S calendar, or nil when
    /// the payload does not reach that far.
    ///
    /// Nil is the important return value. It is what makes the widget go stale
    /// honestly instead of pinning the last known day in place forever.
    public func day(on date: Date) -> DailyTrainingDay? {
        let key = DailyTrainingStore.dayKey(for: date)
        return days.first { $0.date == key }
    }
}

public enum DailyTrainingStore {
    /// Must match the App Groups entitlement on BOTH targets
    /// (App/App.entitlements and SplitIndexWidgets/SplitIndexWidgets.entitlements).
    /// Shared with RacePredictionStore — one group, separate keys.
    public static let appGroupIdentifier = "group.co.uk.splitindex.app"

    /// Must match `kind` on the widget's StaticConfiguration — it is what
    /// `WidgetCenter.shared.reloadTimelines(ofKind:)` targets.
    public static let widgetKind = "SplitIndexDailyTrainingWidget"

    /// Versioned so a future shape change can be introduced without an old
    /// build's decoder choking on it. An unreadable payload degrades to "never
    /// published" — an honest empty state — rather than to a wrong session.
    private static let storageKey = "dailyTraining.v1"

    private static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: appGroupIdentifier)
    }

    /// Local-calendar "yyyy-MM-dd", matching exactly what the web app sends
    /// (date-fns `format(d, "yyyy-MM-dd")`, also local).
    ///
    /// `en_US_POSIX` is not optional here: a device on a non-Gregorian
    /// calendar or an unusual locale would otherwise format "yyyy-MM-dd" into
    /// something that never matches the strings the app wrote, and every day
    /// would silently read as missing.
    public static func dayKey(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone.current
        return formatter.string(from: date)
    }

    /// Whether THIS process can actually reach the shared container.
    ///
    /// The only trustworthy probe, for the reason spelled out at length in
    /// RacePredictionStore: `UserDefaults(suiteName:)` hands back a
    /// working-looking object even when the entitlement is missing, keeps
    /// writes in this process's own in-memory domain, and never persists them
    /// anywhere the extension can see. `containerURL(for...)` is answered by
    /// the sandbox from the code-signed entitlement, so it is nil exactly when
    /// the App Group is not live for this build.
    public static var containerIsReachable: Bool {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupIdentifier
        ) != nil
    }

    public enum Availability {
        case published(DailyTrainingSnapshot)
        /// Container reachable, nothing in it — fresh install, or the app has
        /// not opened the plan since. An undecodable payload lands here too:
        /// the next publish overwrites it, so "open the app" is the honest
        /// advice either way.
        case neverPublished
        /// The App Group is not live for this process. Nothing the app writes
        /// will ever reach the widget until that is fixed.
        case disconnected
    }

    public static func resolve() -> Availability {
        guard containerIsReachable else { return .disconnected }
        guard let data = sharedDefaults?.data(forKey: storageKey) else { return .neverPublished }
        guard let snapshot = try? JSONDecoder().decode(DailyTrainingSnapshot.self, from: data) else {
            return .neverPublished
        }
        return .published(snapshot)
    }

    @discardableResult
    public static func save(_ snapshot: DailyTrainingSnapshot) -> Bool {
        guard containerIsReachable,
              let defaults = sharedDefaults,
              let data = try? JSONEncoder().encode(snapshot) else { return false }
        defaults.set(data, forKey: storageKey)
        return defaults.data(forKey: storageKey) == data
    }

    /// Sign-out. Someone else's training block left on a shared phone's home
    /// screen is both wrong and a small privacy leak — the widget has no
    /// session of its own to expire.
    public static func clear() {
        sharedDefaults?.removeObject(forKey: storageKey)
    }
}

/// Whole minutes, the way a person says them — the same rule as
/// `formatMinutes` in src/components/hybrid-plan/plan-calendar.ts, so the
/// widget and the app never print a session's length differently.
public func formatTrainingMinutes(_ minutes: Int) -> String {
    if minutes < 60 { return "\(minutes) min" }
    let h = minutes / 60
    let rem = minutes % 60
    return rem == 0 ? "\(h) hr" : "\(h) hr \(rem) min"
}
