import ActivityKit
import WidgetKit
import SwiftUI
import AppIntents

/// Split Index brand green (matches --strength-accent / --gym-accent in the
/// web app's design system, src/app/globals.css) — used throughout instead
/// of generic black/white so the lock-screen card reads as this app's,
/// not a stock system template (user feedback: "make it personalised to
/// split index with a logo or some colours").
private let splitIndexAccent = Color(red: 0x3D / 255, green: 0xFF / 255, blue: 0x6E / 255)
private let splitIndexBackground = Color(red: 0x08 / 255, green: 0x0C / 255, blue: 0x0A / 255)

private func formatElapsed(_ totalSeconds: Int) -> String {
    let h = totalSeconds / 3600
    let m = (totalSeconds % 3600) / 60
    let s = totalSeconds % 60
    if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
    return String(format: "%d:%02d", m, s)
}

private func formatMMSS(_ totalSeconds: Int) -> String {
    let m = max(0, totalSeconds) / 60
    let s = max(0, totalSeconds) % 60
    return String(format: "%d:%02d", m, s)
}

@available(iOS 16.2, *)
private func sfSymbol(for mode: SplitIndexActivityAttributes.Mode) -> String {
    mode == .gymTimer ? "dumbbell.fill" : "figure.run"
}

/// Elapsed-time display shared by lock screen and Dynamic Island — date-driven
/// (see ContentState's doc comment for why): a static Text while paused, a
/// natively-ticking one while running, so it can never freeze regardless of
/// whether the app is backgrounded, locked, or suspended.
@available(iOS 16.2, *)
private struct ElapsedClockView: View {
    let state: SplitIndexActivityAttributes.ContentState

    var body: some View {
        if state.isPaused {
            Text(formatElapsed(state.pausedElapsedSeconds))
        } else {
            Text(state.startDate, style: .timer)
        }
    }
}

/// Rest countdown — same native date-driven approach. `Text(_:style:.timer)`
/// counts DOWN automatically when given a future reference date, so this
/// keeps counting correctly through a lock/background window too, and
/// re-derives "done" from the date itself (not just the `restDone` hint)
/// so a rest that finished while the app was away still reads correctly the
/// instant the lock screen re-renders.
@available(iOS 16.2, *)
private struct RestCountdownRow: View {
    let restEndDate: Date
    let compact: Bool

    private var isDone: Bool { restEndDate <= Date() }

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "timer")
                .foregroundStyle(isDone ? Color.red : splitIndexAccent)
            if isDone {
                Text("Rest over!")
            } else {
                Text(restEndDate, style: .timer)
            }
        }
        .font(compact ? .caption.monospacedDigit() : .subheadline.bold().monospacedDigit())
        .foregroundStyle(isDone ? Color.red : .primary)
    }
}

@available(iOS 16.2, *)
struct SplitIndexWidgetsLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SplitIndexActivityAttributes.self) { context in
            LockScreenView(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(splitIndexBackground)
                .activitySystemActionForegroundColor(splitIndexAccent)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.attributes.title, systemImage: sfSymbol(for: context.attributes.mode))
                        .font(.caption)
                        .lineLimit(1)
                        .foregroundStyle(splitIndexAccent)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ElapsedClockView(state: context.state)
                        .font(.title3.monospacedDigit().bold())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ExpandedBottomView(attributes: context.attributes, state: context.state)
                }
            } compactLeading: {
                Image(systemName: sfSymbol(for: context.attributes.mode))
                    .foregroundStyle(splitIndexAccent)
            } compactTrailing: {
                ElapsedClockView(state: context.state)
                    .font(.caption.monospacedDigit())
            } minimal: {
                Image(systemName: sfSymbol(for: context.attributes.mode))
                    .foregroundStyle(splitIndexAccent)
            }
        }
    }
}

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let attributes: SplitIndexActivityAttributes
    let state: SplitIndexActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(attributes.title, systemImage: sfSymbol(for: attributes.mode))
                    .font(.caption.bold())
                    .foregroundStyle(splitIndexAccent)
                Spacer()
                Text("SPLIT INDEX")
                    .font(.caption2.weight(.heavy))
                    .tracking(1.2)
                    .foregroundStyle(.secondary)
            }

            HStack(alignment: .lastTextBaseline) {
                ElapsedClockView(state: state)
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .monospacedDigit()
                Spacer()
                if let bpm = state.heartRateBpm {
                    Label("\(bpm)", systemImage: "heart.fill")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.red)
                }
            }

            if attributes.mode == .gpsTracking {
                HStack(spacing: 20) {
                    if let distanceKm = state.distanceKm {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("DISTANCE").font(.caption2).foregroundStyle(.secondary)
                            Text(String(format: "%.2f km", distanceKm)).font(.subheadline.bold())
                        }
                    }
                    if let paceOrSpeed = state.paceOrSpeedText {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("PACE").font(.caption2).foregroundStyle(.secondary)
                            Text(paceOrSpeed).font(.subheadline.bold())
                        }
                    }
                }
            } else {
                GymTimerControlsRow(state: state)
            }
        }
        .padding(16)
        .foregroundStyle(.white)
    }
}

/// Gym-timer-only interactive row: Pause/Resume always shown; the rest
/// countdown (or a one-tap "Start rest" row) replaces the empty space below
/// it. Buttons only render on iOS 17+ (Button(intent:) inside a Live
/// Activity needs `LiveActivityIntent`, an iOS 17 API — see
/// GymTimerIntents.swift) — iOS 16.2/16.3 users still see the live clock and
/// rest countdown, just without the tappable controls, rather than the
/// whole card failing to build.
@available(iOS 16.2, *)
private struct GymTimerControlsRow: View {
    let state: SplitIndexActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if #available(iOS 17.0, *) {
                HStack(spacing: 12) {
                    Button(intent: ToggleGymTimerIntent()) {
                        Label(state.isPaused ? "Resume" : "Pause", systemImage: state.isPaused ? "play.fill" : "pause.fill")
                            .font(.caption.bold())
                    }
                    .tint(splitIndexAccent)

                    if let restEndDate = state.restEndDate, restEndDate > Date() {
                        Button(intent: DismissRestIntent()) {
                            Label("Skip rest", systemImage: "xmark")
                                .font(.caption.bold())
                        }
                        .tint(.secondary)
                    } else {
                        Button(intent: AddRestIntent(seconds: 90)) {
                            Label("Rest 90s", systemImage: "timer")
                                .font(.caption.bold())
                        }
                        .tint(splitIndexAccent)
                    }
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
            }

            if let restEndDate = state.restEndDate {
                RestCountdownRow(restEndDate: restEndDate, compact: false)
            }
        }
    }
}

@available(iOS 16.2, *)
private struct ExpandedBottomView: View {
    let attributes: SplitIndexActivityAttributes
    let state: SplitIndexActivityAttributes.ContentState

    var body: some View {
        if attributes.mode == .gpsTracking, let distanceKm = state.distanceKm, let paceOrSpeed = state.paceOrSpeedText {
            HStack {
                Text(String(format: "%.2f km", distanceKm))
                Text("·")
                Text(paceOrSpeed)
                if let bpm = state.heartRateBpm {
                    Text("·")
                    Label("\(bpm)", systemImage: "heart.fill")
                }
            }
            .font(.caption.monospacedDigit())
        } else if attributes.mode == .gymTimer {
            GymTimerControlsRow(state: state)
        }
    }
}
