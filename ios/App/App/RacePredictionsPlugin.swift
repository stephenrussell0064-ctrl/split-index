import Foundation
import Capacitor
import WidgetKit

/**
 * Hands the web app's already-computed race predictions to the home-screen
 * widget (see SplitIndexWidgets/RacePredictionWidget.swift for the UI and
 * RacePredictionStore.swift — shared with this target — for the payload).
 *
 * Same local-plugin shape as LiveActivityPlugin: CAPBridgedPlugin with an
 * explicit `pluginMethods` list, registered by hand in
 * MainViewController.capacitorDidLoad() because nothing else references the
 * class and the linker is otherwise free to dead-strip it.
 *
 * Unlike LiveActivityPlugin this needs no `@available` gymnastics —
 * WidgetCenter and UserDefaults suites both predate the app's iOS 15.0
 * floor. The widget extension itself is 16.2+, but that's the extension's
 * problem: on an older OS there is simply no widget to reload, and writing
 * the payload anyway is harmless.
 *
 * NOTE: everything here depends on the App Group
 * (`group.co.uk.splitindex.app`) being present in BOTH targets' entitlements
 * AND registered for both bundle IDs on the developer portal. Without it,
 * `UserDefaults(suiteName:)` still hands back an object but its writes never
 * reach the extension — so `set` reports `stored` and `containerReachable`
 * back to JS from `RacePredictionStore.containerIsReachable`, a sandbox-level
 * check. It used to report a same-process read-back instead, which succeeds
 * even when the entitlement is missing and therefore always said "stored" —
 * a safeguard that could not fail, and so never caught anything.
 */
@objc(RacePredictionsPlugin)
public class RacePredictionsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RacePredictionsPlugin"
    public let jsName = "RacePredictions"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
    ]

    /// The web app sends one of three states, never "a number that might be
    /// zero". `ready` is the only one carrying a time, and it's rejected
    /// below unless a real, positive headline actually came with it — a
    /// silently-zero prediction rendering as "0:00" on someone's home screen
    /// is the same class of bug as the hardcoded 25:00 that shipped once
    /// before, and this is the boundary where it gets caught.
    @objc func set(_ call: CAPPluginCall) {
        let statusRaw = call.getString("status") ?? "noData"
        var status = RacePredictionSnapshot.Status(rawValue: statusRaw) ?? .noData

        var headline: RacePredictionEntry?
        if status == .ready {
            headline = Self.entry(from: call.getObject("headline"))
            if headline == nil {
                // Claimed ready, arrived without a usable number. Degrade to
                // the honest empty state rather than publishing a blank card.
                status = .noData
            }
        }

        let ladder = (call.getArray("ladder") as? [JSObject] ?? [])
            .compactMap { Self.entry(from: $0) }

        let snapshot = RacePredictionSnapshot(
            status: status,
            headline: headline,
            ladder: ladder,
            sampleCount: call.getInt("sampleCount") ?? 0,
            samplesNeeded: call.getInt("samplesNeeded") ?? 0,
            updatedAt: Date()
        )

        let stored = RacePredictionStore.save(snapshot)
        if stored { Self.reloadWidget() }
        // `containerReachable` is reported separately so the JS side can tell
        // "the App Group isn't live on this build" (nothing will ever work
        // until someone fixes signing) apart from "the write itself failed"
        // (transient). They need different words in front of an athlete.
        call.resolve([
            "stored": stored,
            "containerReachable": RacePredictionStore.containerIsReachable,
        ])
    }

    /// Read-only truth about the shared container, for the app to show the
    /// athlete instead of making them guess why their home screen is empty.
    /// Reports what the WIDGET would see, from the app's side of the group —
    /// if this says disconnected, so is the widget.
    @objc func status(_ call: CAPPluginCall) {
        var result = JSObject()
        result["containerReachable"] = RacePredictionStore.containerIsReachable
        result["appGroup"] = RacePredictionStore.appGroupIdentifier

        switch RacePredictionStore.resolve() {
        case .disconnected:
            result["state"] = "disconnected"
        case .neverPublished:
            result["state"] = "empty"
        case .published(let snapshot):
            result["state"] = "published"
            result["status"] = snapshot.status.rawValue
            result["sampleCount"] = snapshot.sampleCount
            result["updatedAt"] = ISO8601DateFormatter().string(from: snapshot.updatedAt)
            if let headline = snapshot.headline {
                result["headlineLabel"] = headline.label
                result["headlineSeconds"] = headline.seconds
            }
        }

        call.resolve(result)
    }

    /// Sign-out. A widget left showing the previous account's predicted
    /// times is both wrong and a small privacy leak on a shared phone.
    @objc func clear(_ call: CAPPluginCall) {
        RacePredictionStore.clear()
        Self.reloadWidget()
        call.resolve(["cleared": true])
    }

    private static func reloadWidget() {
        WidgetCenter.shared.reloadTimelines(ofKind: RacePredictionStore.widgetKind)
    }

    /// Nil for anything that isn't a real, positive duration — a missing
    /// label, a missing/zero/negative seconds value, or a non-finite double
    /// that slipped across the JS bridge. Callers treat nil as "no rung",
    /// so a malformed entry disappears instead of rendering as 0:00.
    private static func entry(from object: JSObject?) -> RacePredictionEntry? {
        guard let object,
              let label = object["label"] as? String,
              !label.isEmpty,
              let seconds = (object["seconds"] as? NSNumber)?.doubleValue,
              seconds.isFinite,
              seconds > 0
        else { return nil }
        return RacePredictionEntry(label: label, seconds: seconds)
    }
}
