import Foundation
import ActivityKit

/**
 * Shared between the App target and the SplitIndexWidgetsExtension target
 * (compiled into both — see LiveActivityPlugin.swift in App/ for how the
 * main app starts/updates/ends activities, and
 * SplitIndexWidgetsLiveActivity.swift for how the extension renders them).
 * `ActivityAttributes` itself only exists from iOS 16.2, above the app's
 * 15.0 floor, hence the `@available` on the whole type — harmless on the
 * extension side, which already targets 16.2+.
 *
 * One shared shape covers both GPS tracking and the gym workout timer
 * (`mode` picks which) rather than two separate Activity types, since only
 * one of these is ever live at once and the widget UI already branches per
 * mode — a single Activity keeps the plugin and the widget's rendering
 * logic in one place instead of two near-identical copies.
 */
@available(iOS 16.2, *)
public struct SplitIndexActivityAttributes: ActivityAttributes {
    public enum Mode: String, Codable, Hashable {
        case gpsTracking
        case gymTimer
    }

    /// Deliberately date-driven, not a plain incrementing Int: the old
    /// `elapsedSeconds: Int` only ever changed when the JS side pushed a new
    /// value via `update()`, and iOS suspends/throttles a backgrounded
    /// WebView's JS timers almost immediately — the moment the screen locks
    /// or the app loses focus, updates stop arriving and the lock-screen
    /// card visibly freezes (user feedback: "gets stuck when I leave my
    /// phone locked... or when I click off the app"). A `startDate` rendered
    /// via SwiftUI's `Text(_:style:.timer)` instead ticks natively, driven by
    /// ActivityKit/the system itself — it keeps counting correctly through
    /// the whole locked/backgrounded period with zero further app
    /// involvement, which is the standard, documented pattern for Live
    /// Activity timers (see SplitIndexWidgetsLiveActivity.swift's
    /// ElapsedClockView/RestCountdownView).
    public struct ContentState: Codable, Hashable {
        /// Reference instant for the CURRENT running segment. While paused
        /// this is meaningless and ignored; on resume the app/an App Intent
        /// sets it to `now - pausedElapsedSeconds` so the native timer picks
        /// back up exactly where it left off rather than restarting at zero.
        public var startDate: Date
        /// True freezes the displayed clock at `pausedElapsedSeconds`
        /// instead of ticking — gym timer only, GPS tracking never pauses.
        public var isPaused: Bool
        /// The frozen total to show while `isPaused`; irrelevant while running.
        public var pausedElapsedSeconds: Int
        /// GPS tracking only — nil for the gym timer.
        public var distanceKm: Double?
        /// GPS tracking only — e.g. "5:30/km" or "12.4 km/h", nil for the gym timer.
        public var paceOrSpeedText: String?
        /// GPS tracking only, when a heart-rate source is connected.
        public var heartRateBpm: Int?
        /// Gym timer only — a future instant to count down to, natively
        /// (`Text(_:style:.timer)` counts DOWN when given a future date);
        /// nil when no rest is active.
        public var restEndDate: Date?
        /// Best-effort hint only — rendering always re-checks `restEndDate`
        /// against the current instant too, so a rest that finished while
        /// the app was backgrounded still reads "Rest over!" immediately
        /// without waiting for a JS push that may not have gotten through.
        public var restDone: Bool

        public init(
            startDate: Date,
            isPaused: Bool = false,
            pausedElapsedSeconds: Int = 0,
            distanceKm: Double? = nil,
            paceOrSpeedText: String? = nil,
            heartRateBpm: Int? = nil,
            restEndDate: Date? = nil,
            restDone: Bool = false
        ) {
            self.startDate = startDate
            self.isPaused = isPaused
            self.pausedElapsedSeconds = pausedElapsedSeconds
            self.distanceKm = distanceKm
            self.paceOrSpeedText = paceOrSpeedText
            self.heartRateBpm = heartRateBpm
            self.restEndDate = restEndDate
            self.restDone = restDone
        }
    }

    public var mode: Mode
    /// e.g. "Running", "Outdoor Cycling", "Walking", "Gym Workout".
    public var title: String
}
