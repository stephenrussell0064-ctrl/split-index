import Foundation
import Capacitor
import ActivityKit

/**
 * Bridges the GPS-run tracking screen and the gym workout timer to a
 * lock-screen / Dynamic Island Live Activity (see SplitIndexActivityAttributes.swift,
 * shared with the SplitIndexWidgetsExtension target, and
 * SplitIndexWidgetsLiveActivity.swift for the actual rendered UI). Only one
 * Live Activity is ever active at a time in this app — starting a new one
 * implicitly replaces whatever was running before.
 *
 * Same boxed-`Any?` + inner-`@available`-gated-class pattern as
 * HeartRateWorkoutPlugin — ActivityKit's `Activity<T>` type itself requires
 * iOS 16.2+, above this app's 15.0 deployment target, so the outer plugin
 * class (which must compile unconditionally) can't store one as a typed
 * property.
 */
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
    ]

    private var session: Any?

    @objc func isAvailable(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["available": false])
            return
        }
        call.resolve(["available": ActivityAuthorizationInfo().areActivitiesEnabled])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.reject("Live Activities need iOS 16.2 or later.")
            return
        }
        guard let mode = call.getString("mode"), let title = call.getString("title") else {
            call.reject("Missing mode/title")
            return
        }
        let contentState = LiveActivitySession.contentState(from: call)
        do {
            let newSession = try LiveActivitySession(mode: mode, title: title, contentState: contentState)
            session = newSession
            call.resolve(["started": true])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), let activeSession = session as? LiveActivitySession else {
            call.resolve(["updated": false])
            return
        }
        let contentState = LiveActivitySession.contentState(from: call)
        Task {
            await activeSession.update(contentState)
            call.resolve(["updated": true])
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), let activeSession = session as? LiveActivitySession else {
            call.resolve(["ended": true])
            return
        }
        Task {
            await activeSession.end()
            self.session = nil
            call.resolve(["ended": true])
        }
    }

    /// Lets the JS side pull the CURRENT lock-screen state back into its own
    /// React state — needed because an interactive Live Activity button
    /// (Pause/Resume, Add Rest — see GymTimerIntents.swift in the widget
    /// extension) updates the Activity directly from the extension's own
    /// process, with no way to call back into this already-running JS
    /// context. Calling this on app-resume (see live-activity.ts /
    /// gym-workout-timer.tsx's visibilitychange listener) is how a
    /// lock-screen tap gets reflected in the open app's UI too. Resolves
    /// `{ found: false }` rather than rejecting when nothing's running —
    /// this is a routine, expected case (no workout active), not an error.
    @objc func getState(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), let activeSession = session as? LiveActivitySession else {
            call.resolve(["found": false])
            return
        }
        call.resolve(activeSession.currentStateDict())
    }
}

@available(iOS 16.2, *)
private class LiveActivitySession {
    private let activity: Activity<SplitIndexActivityAttributes>

    init(mode: String, title: String, contentState: SplitIndexActivityAttributes.ContentState) throws {
        let resolvedMode: SplitIndexActivityAttributes.Mode = mode == "gymTimer" ? .gymTimer : .gpsTracking
        let attributes = SplitIndexActivityAttributes(mode: resolvedMode, title: title)
        activity = try Activity.request(
            attributes: attributes,
            content: .init(state: contentState, staleDate: nil),
            pushType: nil
        )
    }

    func update(_ contentState: SplitIndexActivityAttributes.ContentState) async {
        await activity.update(.init(state: contentState, staleDate: nil))
    }

    func end() async {
        await activity.end(.init(state: activity.content.state, staleDate: nil), dismissalPolicy: .immediate)
    }

    /// Every field is optional from the JS side (a gym-timer update never sends distance, a GPS
    /// update never sends rest-timer fields) — pulled generically here rather than in two
    /// separate parsing paths, since the shape only differs by which keys happen to be present.
    /// Epoch-millisecond doubles cross the JS bridge cleanly (a native Date isn't JSON-representable),
    /// converted to Date here at the boundary.
    static func contentState(from call: CAPPluginCall) -> SplitIndexActivityAttributes.ContentState {
        let startMs = call.getDouble("startDateEpochMs") ?? (Date().timeIntervalSince1970 * 1000)
        let restMs = call.getDouble("restEndDateEpochMs")
        return SplitIndexActivityAttributes.ContentState(
            startDate: Date(timeIntervalSince1970: startMs / 1000),
            isPaused: call.getBool("isPaused") ?? false,
            pausedElapsedSeconds: call.getInt("pausedElapsedSeconds") ?? 0,
            distanceKm: call.getDouble("distanceKm"),
            paceOrSpeedText: call.getString("paceOrSpeedText"),
            heartRateBpm: call.getInt("heartRateBpm"),
            restEndDate: restMs.map { Date(timeIntervalSince1970: $0 / 1000) },
            restDone: call.getBool("restDone") ?? false
        )
    }

    /// Inverse of `contentState(from:)` — serializes the live Activity's
    /// current state back to a JS-readable dict for `LiveActivityPlugin.getState()`.
    func currentStateDict() -> [String: Any] {
        let state = activity.content.state
        var dict: [String: Any] = [
            "found": true,
            "startDateEpochMs": state.startDate.timeIntervalSince1970 * 1000,
            "isPaused": state.isPaused,
            "pausedElapsedSeconds": state.pausedElapsedSeconds,
            "restDone": state.restDone,
        ]
        if let restEndDate = state.restEndDate {
            dict["restEndDateEpochMs"] = restEndDate.timeIntervalSince1970 * 1000
        }
        return dict
    }
}
