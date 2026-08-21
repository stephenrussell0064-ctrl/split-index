import Foundation
import Capacitor
import WidgetKit

/**
 * Hands the web app's already-computed training days to the home-screen widget
 * (see SplitIndexWidgets/DailyTrainingWidget.swift for the UI and
 * DailyTrainingStore.swift — shared with this target — for the payload).
 *
 * Same local-plugin shape as RacePredictionsPlugin: CAPBridgedPlugin with an
 * explicit `pluginMethods` list, registered by hand in
 * MainViewController.capacitorDidLoad() because nothing else references the
 * class and the linker is otherwise free to dead-strip it.
 *
 * The boundary rule this file exists to enforce: a `ready` that arrives
 * without usable content is downgraded to a message state rather than
 * published as an empty card. A rest day IS usable content — a day with
 * `isRest` true and no sessions is a valid, prescribed day and must survive
 * this filter intact. A day with neither a rest flag nor a session is not a
 * day, and is dropped.
 */
@objc(DailyTrainingPlugin)
public class DailyTrainingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DailyTrainingPlugin"
    public let jsName = "DailyTraining"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
    ]

    @objc func set(_ call: CAPPluginCall) {
        let statusRaw = call.getString("status") ?? "noPlan"
        var status = DailyTrainingSnapshot.Status(rawValue: statusRaw) ?? .noPlan

        // Read the nested array as plain Foundation types rather than
        // `[JSObject]`. A failed bridge cast there would produce zero days,
        // which this plugin would then honestly report as "no plan" — a silent
        // wrong empty state, and the exact bug class the race widget was
        // already burned by. `[Any]` / `[String: Any]` cannot fail on anything
        // the WebView can send.
        // `JSArray` is `[any JSValue]`, which converts to `[Any]` implicitly —
        // a conditional cast here would be a no-op the compiler warns about.
        let rawDays: [Any] = call.getArray("days") ?? []
        var days = rawDays.compactMap { Self.day(from: $0 as? [String: Any]) }

        if status == .ready && days.isEmpty {
            // Claimed ready, arrived with nothing to train. Degrade to the
            // honest message state rather than publishing a blank card.
            status = .noPlan
            days = []
        }
        if status != .ready {
            days = []
        }

        let snapshot = DailyTrainingSnapshot(
            status: status,
            days: days,
            headline: Self.nonEmpty(call.getString("headline")),
            message: Self.nonEmpty(call.getString("message")),
            updatedAt: Date()
        )

        let stored = DailyTrainingStore.save(snapshot)
        if stored { Self.reloadWidget() }
        // `containerReachable` is reported separately so the JS side can tell
        // "the App Group isn't live on this build" (permanent until signing is
        // fixed) apart from "the write itself failed" (transient). They need
        // different words in front of an athlete.
        call.resolve([
            "stored": stored,
            "containerReachable": DailyTrainingStore.containerIsReachable,
        ])
    }

    /// Read-only truth about the shared container, for the app to show the
    /// athlete instead of making them guess why their home screen is empty.
    @objc func status(_ call: CAPPluginCall) {
        var result = JSObject()
        result["containerReachable"] = DailyTrainingStore.containerIsReachable
        result["appGroup"] = DailyTrainingStore.appGroupIdentifier

        switch DailyTrainingStore.resolve() {
        case .disconnected:
            result["state"] = "disconnected"
        case .neverPublished:
            result["state"] = "empty"
        case .published(let snapshot):
            result["state"] = "published"
            result["status"] = snapshot.status.rawValue
            result["dayCount"] = snapshot.days.count
            result["updatedAt"] = ISO8601DateFormatter().string(from: snapshot.updatedAt)
            // Whether the payload still covers today — the single fact that
            // decides whether the widget is showing anything at all.
            result["coversToday"] = snapshot.day(on: Date()) != nil
            if let first = snapshot.days.first { result["firstDay"] = first.date }
            if let last = snapshot.days.last { result["lastDay"] = last.date }
        }

        call.resolve(result)
    }

    /// Sign-out. Someone else's training block left on a shared phone's home
    /// screen is both wrong and a small privacy leak.
    @objc func clear(_ call: CAPPluginCall) {
        DailyTrainingStore.clear()
        Self.reloadWidget()
        call.resolve(["cleared": true])
    }

    private static func reloadWidget() {
        WidgetCenter.shared.reloadTimelines(ofKind: DailyTrainingStore.widgetKind)
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return value
    }

    /// Nil for anything that isn't a real day: no date, or neither a rest flag
    /// nor a single usable session. A rest day with no sessions is kept — it
    /// is a prescription, not an absence, and dropping it here would make the
    /// widget report "no plan" on precisely the days the plan says to rest.
    private static func day(from object: [String: Any]?) -> DailyTrainingDay? {
        guard let object,
              let date = object["date"] as? String,
              !date.isEmpty
        else { return nil }

        let isRest = (object["isRest"] as? NSNumber)?.boolValue ?? false
        let rawSessions = object["sessions"] as? [Any] ?? []
        let sessions = rawSessions.compactMap { session(from: $0 as? [String: Any]) }

        guard isRest || !sessions.isEmpty else { return nil }

        return DailyTrainingDay(
            date: date,
            isRest: isRest,
            restReason: nonEmpty(object["restReason"] as? String),
            weekLabel: (object["weekLabel"] as? String) ?? "",
            totalMinutes: (object["totalMinutes"] as? NSNumber)?.intValue ?? 0,
            // A day flagged as rest carries no sessions, whatever arrived.
            sessions: isRest ? [] : sessions
        )
    }

    /// Nil for anything that isn't a real session — same rule as the race
    /// widget's entries. A session with no name would render as a blank line
    /// where an instruction should be.
    private static func session(from object: [String: Any]?) -> DailyTrainingSession? {
        guard let object,
              let title = object["title"] as? String,
              !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }

        return DailyTrainingSession(
            title: title,
            detail: (object["detail"] as? String) ?? "",
            slot: nonEmpty(object["slot"] as? String),
            domain: (object["domain"] as? String) == "strength" ? "strength" : "endurance",
            minutes: (object["minutes"] as? NSNumber)?.intValue ?? 0,
            isQuality: (object["isQuality"] as? NSNumber)?.boolValue ?? false
        )
    }
}
