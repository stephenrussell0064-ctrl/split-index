import ActivityKit
import WidgetKit
import SwiftUI

/// Elapsed-time formatting shared by lock screen and Dynamic Island — kept
/// local to this file rather than imported from the app, since widget
/// extensions can't reach into the main app target's source.
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

@available(iOS 16.2, *)
struct SplitIndexWidgetsLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SplitIndexActivityAttributes.self) { context in
            LockScreenView(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Color.black)
                .activitySystemActionForegroundColor(Color.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.attributes.title, systemImage: sfSymbol(for: context.attributes.mode))
                        .font(.caption)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(formatElapsed(context.state.elapsedSeconds))
                        .font(.title3.monospacedDigit().bold())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ExpandedBottomView(state: context.state)
                }
            } compactLeading: {
                Image(systemName: sfSymbol(for: context.attributes.mode))
            } compactTrailing: {
                Text(formatElapsed(context.state.elapsedSeconds))
                    .font(.caption.monospacedDigit())
            } minimal: {
                Image(systemName: sfSymbol(for: context.attributes.mode))
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
            Label(attributes.title, systemImage: sfSymbol(for: attributes.mode))
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(alignment: .lastTextBaseline) {
                Text(formatElapsed(state.elapsedSeconds))
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
            } else if let restRemaining = state.restRemainingSeconds {
                HStack {
                    Image(systemName: "timer")
                        .foregroundStyle(state.restDone ? .red : .green)
                    Text(state.restDone ? "Rest over!" : "Rest: \(formatMMSS(restRemaining))")
                        .font(.subheadline.bold())
                        .foregroundStyle(state.restDone ? .red : .primary)
                }
            }
        }
        .padding(16)
        .foregroundStyle(.white)
    }
}

@available(iOS 16.2, *)
private struct ExpandedBottomView: View {
    let state: SplitIndexActivityAttributes.ContentState

    var body: some View {
        if let distanceKm = state.distanceKm, let paceOrSpeed = state.paceOrSpeedText {
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
        } else if let restRemaining = state.restRemainingSeconds {
            Text(state.restDone ? "Rest over!" : "Rest: \(formatMMSS(restRemaining))")
                .font(.caption.monospacedDigit())
                .foregroundStyle(state.restDone ? .red : .primary)
        }
    }
}
