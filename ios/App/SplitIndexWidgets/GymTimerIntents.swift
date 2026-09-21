import AppIntents
import ActivityKit

/**
 * Interactive Live Activity buttons for the gym workout timer (user
 * feedback: "add all the functions like pause, add rest and everything else
 * on to the widget on lock screen").
 *
 * THIS FILE MUST BE A MEMBER OF THE APP TARGET, NOT ONLY THE WIDGET
 * EXTENSION. `SplitIndexWidgets/` is a file-system-synchronized group owned
 * by SplitIndexWidgetsExtension, so every file in it joins the extension
 * automatically and NOTHING joins the app unless it is added by hand — which
 * is how this one was missed. The App target's Sources phase lists it
 * explicitly, next to SplitIndexActivityAttributes.swift and the two stores,
 * which are shared the same way.
 *
 * It matters because a `LiveActivityIntent` is performed in the APP's
 * process, and because `Activity<T>.activities` is only populated there. An
 * earlier version of this comment claimed the opposite — that these run in
 * the extension and that ActivityKit's list is shared across targets — and
 * that belief is precisely why the file was never added to the app. The
 * symptom was silent: the buttons rendered, `gymTimerActivity()` returned
 * nil against an empty list, the `guard` returned `.result()`, and Pause and
 * Rest 90s did nothing at all on a shipped build.
 *
 * iOS 17+ only: Button(intent:) inside a Live Activity is an iOS 17 API —
 * see SplitIndexWidgetsLiveActivity.swift's `#available(iOS 17.0, *)` gate
 * around every button that references these.
 *
 * The open app (if any) has no way to be notified synchronously when one of
 * these runs — LiveActivityPlugin.swift's `getState()` bridge method is the
 * other half: the JS side calls it on resume/visibilitychange (see
 * gym-workout-timer.tsx) to pull whatever the lock screen last did back
 * into its own React state, rather than the two silently drifting apart.
 */
@available(iOS 17.0, *)
private func gymTimerActivity() -> Activity<SplitIndexActivityAttributes>? {
    Activity<SplitIndexActivityAttributes>.activities.first { $0.attributes.mode == .gymTimer }
}

@available(iOS 17.0, *)
struct ToggleGymTimerIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Pause/Resume Workout Timer"
    static var description = IntentDescription("Pauses or resumes the Split Index gym workout timer.")

    func perform() async throws -> some IntentResult {
        guard let activity = gymTimerActivity() else { return .result() }
        var state = activity.content.state
        let now = Date()
        if state.isPaused {
            // Resume: shift startDate so the natively-ticking Text picks up
            // exactly where the paused total left off, rather than
            // restarting from zero (see ContentState's doc comment).
            state.startDate = now.addingTimeInterval(-Double(state.pausedElapsedSeconds))
            state.isPaused = false
        } else {
            // Pause: freeze the current running elapsed as the new paused total.
            state.pausedElapsedSeconds = max(0, Int(now.timeIntervalSince(state.startDate)))
            state.isPaused = true
        }
        await activity.update(.init(state: state, staleDate: nil))
        return .result()
    }
}

@available(iOS 17.0, *)
struct AddRestIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Start Rest Timer"
    static var description = IntentDescription("Starts a rest countdown on the Split Index gym workout timer.")

    @Parameter(title: "Seconds")
    var seconds: Int

    init() {
        self.seconds = 90
    }

    init(seconds: Int) {
        self.seconds = seconds
    }

    func perform() async throws -> some IntentResult {
        guard let activity = gymTimerActivity() else { return .result() }
        var state = activity.content.state
        state.restEndDate = Date().addingTimeInterval(Double(seconds))
        state.restDone = false
        await activity.update(.init(state: state, staleDate: nil))
        return .result()
    }
}

@available(iOS 17.0, *)
struct DismissRestIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Skip Rest"
    static var description = IntentDescription("Clears the rest countdown on the Split Index gym workout timer.")

    func perform() async throws -> some IntentResult {
        guard let activity = gymTimerActivity() else { return .result() }
        var state = activity.content.state
        state.restEndDate = nil
        state.restDone = false
        await activity.update(.init(state: state, staleDate: nil))
        return .result()
    }
}
