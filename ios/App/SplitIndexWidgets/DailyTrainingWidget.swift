import WidgetKit
import SwiftUI
import UIKit

/**
 * The daily-training home-screen widget: what the athlete is doing today.
 *
 * Reads whatever the app last wrote into the shared App Group container
 * (DailyTrainingStore) — a widget extension can't reach Supabase, so there is
 * nothing to fetch here, only something to render.
 *
 * THE REFRESH POLICY (the question this widget lives or dies on):
 *
 * The app publishes today plus the next several days. `getTimeline` then emits
 * one entry per LOCAL MIDNIGHT across that horizon, so WidgetKit already holds
 * tomorrow's render before tomorrow arrives. The day rolls over at 00:00 with
 * no app launch, no background refresh and no network. The system is also
 * asked for a fresh timeline once a day (`.after` the next midnight), which is
 * cheap against the refresh budget and picks up anything published since; and
 * the app calls `reloadTimelines` the moment the plan changes.
 *
 * Every view below resolves "which day is this" from `entry.date`, NEVER from
 * `Date()`. WidgetKit renders future entries ahead of time, so a view that
 * asked the clock would render tomorrow's slot with today's session in it.
 *
 * When the payload runs out — an athlete who has not opened the app in a
 * fortnight — the widget says so. It does not pin the last known day in place.
 * A stale session presented as today's is the same class of bug as the
 * hardcoded race time this codebase already shipped once.
 *
 * Colours: this widget carries BOTH halves of the app, so it uses the neutral
 * app palette for its surface and the zone accents (cardio blue / lab green)
 * only to mark which side a session belongs to — the same rule
 * logbook-theme.ts applies to a row on the neutral surface.
 */

// MARK: - Palette

/// --background (dark) / --cardio-bg (light)
private let dtBackground = Color(
    light: Color(red: 0xF7 / 255, green: 0xFB / 255, blue: 0xFF / 255),
    dark: Color(red: 0x06 / 255, green: 0x06 / 255, blue: 0x06 / 255)
)
/// --cardio-text / --foreground
private let dtText = Color(
    light: Color(red: 0x0C / 255, green: 0x1A / 255, blue: 0x24 / 255),
    dark: Color(red: 0xFA / 255, green: 0xFA / 255, blue: 0xFA / 255)
)
/// --cardio-muted / --muted
private let dtMuted = Color(
    light: Color(red: 0x5B / 255, green: 0x72 / 255, blue: 0x84 / 255),
    dark: Color(red: 0xA1 / 255, green: 0xA1 / 255, blue: 0xAA / 255)
)
/// --cardio-accent / --cardio-accent-soft
private let dtCardio = Color(
    light: Color(red: 0x3B / 255, green: 0xA6 / 255, blue: 0xFF / 255),
    dark: Color(red: 0x6B / 255, green: 0xB8 / 255, blue: 0xFF / 255)
)
/// --strength-accent. Neon green is unreadable on a light home screen, so the
/// light variant is the darker green the app already falls back to for gym
/// content on its cardio (white) surface.
private let dtStrength = Color(
    light: Color(red: 0x11 / 255, green: 0x7A / 255, blue: 0x3B / 255),
    dark: Color(red: 0x3D / 255, green: 0xFF / 255, blue: 0x6E / 255)
)
/// --cardio-border / white hairline
private let dtHairline = Color(
    light: Color(red: 0x3B / 255, green: 0xA6 / 255, blue: 0xFF / 255).opacity(0.22),
    dark: Color.white.opacity(0.10)
)

private extension Color {
    /// Appearance-aware colour without an asset-catalog entry per token — the
    /// widget must read correctly on both light and dark home screens, and
    /// `UIColor(dynamicProvider:)` is the only way to do that for a literal.
    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { traits in
            UIColor(traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

private func accent(for domain: String) -> Color {
    domain == "strength" ? dtStrength : dtCardio
}

// MARK: - Timeline

struct DailyTrainingTimelineEntry: TimelineEntry {
    /// The moment this entry represents. The VIEW's notion of "today" — never
    /// `Date()`, because WidgetKit renders future entries in advance.
    let date: Date
    let availability: DailyTrainingStore.Availability
}

struct DailyTrainingProvider: TimelineProvider {
    /// How many days ahead to pre-render. Five is comfortably more than the
    /// system's daily refresh needs and keeps the timeline small.
    private static let horizonDays = 5

    /// The gallery preview. A rest day rather than an invented session: the
    /// gallery is exactly where a plausible fake "10km easy" would be most
    /// convincing and most wrong, and a rest day is a real, honest state that
    /// still shows what the widget is for.
    private static let previewSnapshot = DailyTrainingSnapshot(
        status: .ready,
        days: [
            DailyTrainingDay(
                date: DailyTrainingStore.dayKey(for: Date()),
                isRest: true,
                restReason: "Rest before tomorrow's long run.",
                weekLabel: "Week 3 · Build",
                totalMinutes: 0,
                sessions: []
            )
        ]
    )

    func placeholder(in context: Context) -> DailyTrainingTimelineEntry {
        DailyTrainingTimelineEntry(date: Date(), availability: .published(Self.previewSnapshot))
    }

    func getSnapshot(in context: Context, completion: @escaping (DailyTrainingTimelineEntry) -> Void) {
        let availability: DailyTrainingStore.Availability = context.isPreview
            ? .published(Self.previewSnapshot)
            : DailyTrainingStore.resolve()
        completion(DailyTrainingTimelineEntry(date: Date(), availability: availability))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DailyTrainingTimelineEntry>) -> Void) {
        let availability = DailyTrainingStore.resolve()
        let calendar = Calendar.current
        let now = Date()
        let midnight = calendar.startOfDay(for: now)

        // Now, then every local midnight across the horizon. One snapshot,
        // many entries: each renders the day its own `date` falls on, which is
        // what makes the rollover happen without the app.
        var entries = [DailyTrainingTimelineEntry(date: now, availability: availability)]
        for offset in 1...Self.horizonDays {
            guard let next = calendar.date(byAdding: .day, value: offset, to: midnight) else { continue }
            entries.append(DailyTrainingTimelineEntry(date: next, availability: availability))
        }

        // Ask for a fresh timeline once tomorrow has started. The pre-built
        // entries above already carry the rollover, so this is the belt to
        // their braces: it is what picks up a plan published since, and what
        // eventually replaces the payload rather than letting it run to its
        // end unnoticed.
        let nextRefresh = calendar.date(byAdding: .day, value: 1, to: midnight) ?? now.addingTimeInterval(86_400)
        completion(Timeline(entries: entries, policy: .after(nextRefresh)))
    }
}

// MARK: - Widget

struct DailyTrainingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: DailyTrainingStore.widgetKind,
            provider: DailyTrainingProvider()
        ) { entry in
            DailyTrainingWidgetView(date: entry.date, availability: entry.availability)
                .widgetContainerBackground()
        }
        .configurationDisplayName("Today's Training")
        .description("The session your plan has for you today.")
        // StaticConfiguration, not AppIntentConfiguration: this extension
        // deploys to iOS 16.2 and AppIntentConfiguration is 17+.
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

private extension View {
    /// iOS 17 moved widget backgrounds behind `containerBackground` and
    /// renders anything else on a system surface; 16.x still wants the
    /// background painted directly. Both paths are needed at a 16.2 floor.
    @ViewBuilder
    func widgetContainerBackground() -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(dtBackground, for: .widget)
        } else {
            self.padding(14).background(dtBackground)
        }
    }
}

// MARK: - Resolution

/// What this widget has to say on this particular day. Resolved once, from the
/// entry's own date, so every view below renders the same answer.
private enum DayState {
    /// A real day of a real plan. `day` may be a rest day — that is content.
    case scheduled(DailyTrainingDay, next: DailyTrainingDay?)
    /// A plan exists, but this date is past the end of what the app published.
    case stale(updatedAt: Date)
    /// A message state: no plan, between blocks, disconnected, never published.
    case message(title: String, message: String, detail: String)
}

private func resolve(_ availability: DailyTrainingStore.Availability, on date: Date) -> DayState {
    switch availability {
    case .disconnected:
        // The App Group isn't live for this build, so nothing the app writes
        // can ever arrive. Say so, and point at Settings — silently rendering
        // an empty state here is what once told a fully-trained athlete they
        // had no training.
        return .message(
            title: "Widget not connected",
            message: "Check Settings in the app",
            detail: "Split Index can't share data with this widget on this build. Your plan is still in the app."
        )
    case .neverPublished:
        return .message(
            title: "Not synced yet",
            message: "Open Split Index",
            detail: "Your day appears here once you've opened your hybrid plan in the app."
        )
    case .published(let snapshot):
        switch snapshot.status {
        case .noPlan:
            return .message(
                title: snapshot.headline ?? "No plan yet",
                message: snapshot.message ?? "Open Split Index",
                detail: "Split Index builds a block from your own logged training."
            )
        case .betweenBlocks:
            return .message(
                title: snapshot.headline ?? "Between blocks",
                message: snapshot.message ?? "Open Split Index",
                detail: "You don't have a training block covering today."
            )
        case .ready:
            guard let today = snapshot.day(on: date) else {
                // Past the end of what was published. NEVER fall back to the
                // last known day — a fortnight-old session rendered as today's
                // is a wrong instruction, not a stale one.
                return .stale(updatedAt: snapshot.updatedAt)
            }
            let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: date)
                .flatMap { snapshot.day(on: $0) }
            return .scheduled(today, next: tomorrow)
        }
    }
}

// MARK: - Views

private struct DailyTrainingWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let date: Date
    let availability: DailyTrainingStore.Availability

    var body: some View {
        Group {
            switch resolve(availability, on: date) {
            case .scheduled(let day, let next):
                if family == .systemMedium {
                    MediumDayView(day: day, next: next)
                } else {
                    SmallDayView(day: day)
                }
            case .stale(let updatedAt):
                MessageView(
                    title: "Out of date",
                    message: "Open Split Index",
                    detail: "Your plan was last synced \(updatedAt.formatted(.relative(presentation: .named))) and doesn't reach today. Rather than show you an old session, this is blank."
                )
            case .message(let title, let message, let detail):
                MessageView(title: title, message: message, detail: detail)
            }
        }
        .foregroundStyle(dtText)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Small

/// Small holds one thing legibly: what today is. The first session's name and
/// its headline number, or the fact that today is a rest day.
private struct SmallDayView: View {
    let day: DailyTrainingDay

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BrandHeader(caption: "TODAY")

            Spacer(minLength: 4)

            if day.isRest {
                // A rest day is a prescription. It gets the same treatment a
                // session does — a word at size, and the reason underneath.
                Text("Rest day")
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(day.restReason ?? "Nothing scheduled today.")
                    .font(.system(size: 10))
                    .foregroundStyle(dtMuted)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let session = day.sessions.first {
                Text(session.title)
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                    .foregroundStyle(accent(for: session.domain))
                Text(session.detail)
                    .font(.system(size: 11))
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)

                Spacer(minLength: 2)

                Text(footnote)
                    .font(.system(size: 9))
                    .foregroundStyle(dtMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
    }

    /// "45 min · Week 3 · Build", and a second session named rather than
    /// hidden — a double day the widget silently halved would be a lie of
    /// omission about how much work today is.
    private var footnote: String {
        var parts: [String] = []
        if day.totalMinutes > 0 { parts.append(formatTrainingMinutes(day.totalMinutes)) }
        if day.sessions.count > 1 { parts.append("+\(day.sessions.count - 1) more") }
        if !day.weekLabel.isEmpty { parts.append(day.weekLabel) }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Medium

/// Medium is where the widget can be what the day actually is: every session
/// on it, and a line of what is coming tomorrow.
private struct MediumDayView: View {
    let day: DailyTrainingDay
    let next: DailyTrainingDay?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                BrandHeader(caption: "TODAY")
                Spacer(minLength: 6)
                if !day.weekLabel.isEmpty {
                    Text(day.weekLabel)
                        .font(.system(size: 9, weight: .semibold))
                        .tracking(0.5)
                        .foregroundStyle(dtMuted)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 6)

            if day.isRest {
                Text("Rest day")
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(day.restReason ?? "Nothing scheduled today.")
                    .font(.system(size: 11))
                    .foregroundStyle(dtMuted)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            } else {
                // At most two: a third session on one day is rare, and three
                // stacked rows in this height would shrink all of them below
                // glanceable. The footer names the remainder rather than
                // dropping it silently.
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(Array(day.sessions.prefix(2).enumerated()), id: \.offset) { _, session in
                        SessionRow(session: session, compact: day.sessions.count > 1)
                    }
                }
                if day.sessions.count > 2 {
                    Text("+\(day.sessions.count - 2) more today")
                        .font(.system(size: 9))
                        .foregroundStyle(dtMuted)
                        .padding(.top, 3)
                }
            }

            Spacer(minLength: 4)

            Rectangle().fill(dtHairline).frame(height: 1)

            Text(tomorrowLine)
                .font(.system(size: 10))
                .foregroundStyle(dtMuted)
                .lineLimit(1)
                .padding(.top, 5)
        }
    }

    /// Nothing is claimed about tomorrow when tomorrow is past the end of the
    /// published days — the line simply says the plan does not reach it.
    private var tomorrowLine: String {
        guard let next else { return "Tomorrow: not synced yet" }
        if next.isRest { return "Tomorrow: rest" }
        let names = next.sessions.map(\.title).joined(separator: " + ")
        return names.isEmpty ? "Tomorrow: rest" : "Tomorrow: \(names)"
    }
}

private struct SessionRow: View {
    let session: DailyTrainingSession
    /// True on a two-session day, where each row gets half the height.
    let compact: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            RoundedRectangle(cornerRadius: 1)
                .fill(accent(for: session.domain))
                .frame(width: 2)

            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 5) {
                    Text(session.title)
                        .font(.system(size: compact ? 15 : 19, weight: .bold, design: .rounded))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    if let slot = session.slot, !slot.isEmpty {
                        Text(slot)
                            .font(.system(size: 8, weight: .bold))
                            .tracking(0.5)
                            .foregroundStyle(dtMuted)
                    }
                    if session.isQuality {
                        Text("QUALITY")
                            .font(.system(size: 8, weight: .bold))
                            .tracking(0.5)
                            .foregroundStyle(dtMuted)
                    }
                    Spacer(minLength: 0)
                    if session.minutes > 0 {
                        Text(formatTrainingMinutes(session.minutes))
                            .font(.system(size: 10, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(dtMuted)
                    }
                }
                Text(session.detail)
                    .font(.system(size: 11))
                    .lineLimit(compact ? 1 : 2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxHeight: compact ? 44 : 70, alignment: .top)
    }
}

// MARK: - Shared

private struct BrandHeader: View {
    let caption: String

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "calendar")
                .font(.caption2.bold())
            Text(caption)
                .font(.system(size: 9, weight: .heavy))
                .tracking(1.1)
            Spacer(minLength: 0)
        }
        .foregroundStyle(dtCardio)
    }
}

/// Every non-scheduled state. Words only — never a session, never a placeholder
/// distance, never an em-dash standing in for training that does not exist.
private struct MessageView: View {
    @Environment(\.widgetFamily) private var family
    let title: String
    let message: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BrandHeader(caption: "SPLIT INDEX")

            Spacer(minLength: 6)

            Text(title)
                .font(.system(size: family == .systemMedium ? 20 : 16, weight: .bold, design: .rounded))
                .lineLimit(2)
                .minimumScaleFactor(0.7)

            Text(message)
                .font(.system(size: family == .systemMedium ? 13 : 11, weight: .medium))
                .foregroundStyle(dtCardio)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)

            if family == .systemMedium {
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(dtMuted)
                    .padding(.top, 4)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
    }
}
