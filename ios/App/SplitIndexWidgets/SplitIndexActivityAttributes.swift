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

    public struct ContentState: Codable, Hashable {
        public var elapsedSeconds: Int
        /// GPS tracking only — nil for the gym timer.
        public var distanceKm: Double?
        /// GPS tracking only — e.g. "5:30/km" or "12.4 km/h", nil for the gym timer.
        public var paceOrSpeedText: String?
        /// GPS tracking only, when a heart-rate source is connected.
        public var heartRateBpm: Int?
        /// Gym timer only — seconds left on the current rest countdown, nil when no rest is active.
        public var restRemainingSeconds: Int?
        public var restDone: Bool

        public init(
            elapsedSeconds: Int,
            distanceKm: Double? = nil,
            paceOrSpeedText: String? = nil,
            heartRateBpm: Int? = nil,
            restRemainingSeconds: Int? = nil,
            restDone: Bool = false
        ) {
            self.elapsedSeconds = elapsedSeconds
            self.distanceKm = distanceKm
            self.paceOrSpeedText = paceOrSpeedText
            self.heartRateBpm = heartRateBpm
            self.restRemainingSeconds = restRemainingSeconds
            self.restDone = restDone
        }
    }

    public var mode: Mode
    /// e.g. "Running", "Outdoor Cycling", "Walking", "Gym Workout".
    public var title: String
}
