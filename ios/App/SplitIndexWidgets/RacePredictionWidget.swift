import WidgetKit
import SwiftUI
import UIKit

/**
 * The home-screen widget: the athlete's predicted race times, 5K as the
 * headline. Reads whatever the app last wrote into the shared App Group
 * container (RacePredictionStore) — a widget extension can't reach Supabase
 * itself, so there is nothing to fetch here, only something to render.
 *
 * Colours come from the app's own design system rather than being invented:
 * this is a CARDIO surface, so it uses the cardio palette from
 * src/app/globals.css (--cardio-*) — sky blue on near-white in light
 * appearance, the softer blue on near-black in dark. The neon green
 * (--strength-accent) that the Live Activity uses is the gym/strength
 * accent, and it reads badly on a light home screen anyway; race times
 * belong to the endurance side of the app.
 */

// MARK: - Palette

/// --cardio-bg / --background
private let surfaceBackground = Color(
    light: Color(red: 0xF7 / 255, green: 0xFB / 255, blue: 0xFF / 255),
    dark: Color(red: 0x06 / 255, green: 0x06 / 255, blue: 0x06 / 255)
)
/// --cardio-text / --foreground
private let surfaceText = Color(
    light: Color(red: 0x0C / 255, green: 0x1A / 255, blue: 0x24 / 255),
    dark: Color(red: 0xFA / 255, green: 0xFA / 255, blue: 0xFA / 255)
)
/// --cardio-muted / --muted
private let surfaceMuted = Color(
    light: Color(red: 0x5B / 255, green: 0x72 / 255, blue: 0x84 / 255),
    dark: Color(red: 0xA1 / 255, green: 0xA1 / 255, blue: 0xAA / 255)
)
/// --cardio-accent / --cardio-accent-soft (the soft variant carries better on black)
private let surfaceAccent = Color(
    light: Color(red: 0x3B / 255, green: 0xA6 / 255, blue: 0xFF / 255),
    dark: Color(red: 0x6B / 255, green: 0xB8 / 255, blue: 0xFF / 255)
)
/// --cardio-border
private let surfaceHairline = Color(
    light: Color(red: 0x3B / 255, green: 0xA6 / 255, blue: 0xFF / 255).opacity(0.22),
    dark: Color.white.opacity(0.10)
)

private extension Color {
    /// Appearance-aware colour without needing an asset catalog entry per
    /// token — the widget must read correctly in both light and dark home
    /// screens, and `UIColor(dynamicProvider:)` is the only way to do that
    /// for a literal.
    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { traits in
            UIColor(traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

// MARK: - Timeline

struct RacePredictionEntryModel: TimelineEntry {
    let date: Date
    let snapshot: RacePredictionSnapshot?
}

struct RacePredictionProvider: TimelineProvider {
    /// The gallery preview. Uses `.calibrating` rather than an invented
    /// finish time, so nothing that looks like a real prediction is ever
    /// shown for an athlete who doesn't have one — the widget gallery is
    /// exactly where a fake "25:00" would be most convincing and most wrong.
    private static let previewSnapshot = RacePredictionSnapshot(
        status: .calibrating,
        sampleCount: 0,
        samplesNeeded: 5
    )

    func placeholder(in context: Context) -> RacePredictionEntryModel {
        RacePredictionEntryModel(date: Date(), snapshot: Self.previewSnapshot)
    }

    func getSnapshot(in context: Context, completion: @escaping (RacePredictionEntryModel) -> Void) {
        let stored = context.isPreview ? Self.previewSnapshot : RacePredictionStore.load()
        completion(RacePredictionEntryModel(date: Date(), snapshot: stored))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RacePredictionEntryModel>) -> Void) {
        let entry = RacePredictionEntryModel(date: Date(), snapshot: RacePredictionStore.load())
        // The app calls WidgetCenter.reloadTimelines whenever the numbers
        // change (RacePredictionsPlugin), so this refresh is only a safety
        // net for the case where that call never arrived — six hours is
        // cheap against the system's refresh budget and stops the widget
        // sitting on a payload it has no way of knowing is out of date.
        let refresh = Calendar.current.date(byAdding: .hour, value: 6, to: Date()) ?? Date().addingTimeInterval(21600)
        completion(Timeline(entries: [entry], policy: .after(refresh)))
    }
}

// MARK: - Widget

struct RacePredictionWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: RacePredictionStore.widgetKind,
            provider: RacePredictionProvider()
        ) { entry in
            RacePredictionWidgetView(snapshot: entry.snapshot)
                .widgetContainerBackground()
        }
        .configurationDisplayName("Race Predictions")
        .description("Your predicted 5K, and the rest of your race ladder.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

private extension View {
    /// iOS 17 moved widget backgrounds behind `containerBackground` and
    /// renders anything else on a system-supplied surface; 16.x still wants
    /// the background painted directly. Both paths are needed because this
    /// extension deploys to 16.2.
    @ViewBuilder
    func widgetContainerBackground() -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(surfaceBackground, for: .widget)
        } else {
            self.padding(14).background(surfaceBackground)
        }
    }
}

// MARK: - Views

private struct RacePredictionWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let snapshot: RacePredictionSnapshot?

    var body: some View {
        Group {
            switch resolvedState {
            case .ready(let headline, let ladder, let sampleCount, let updatedAt):
                if family == .systemMedium {
                    MediumReadyView(
                        headline: headline,
                        ladder: ladder,
                        sampleCount: sampleCount,
                        updatedAt: updatedAt
                    )
                } else {
                    SmallReadyView(headline: headline, sampleCount: sampleCount)
                }
            case .calibrating(let logged, let needed):
                MessageView(
                    title: "Calibrating",
                    message: needed > 0
                        ? "\(logged) of \(needed) runs logged"
                        : "Keep logging runs",
                    detail: "Your 5K prediction appears once there's enough to go on."
                )
            case .empty:
                MessageView(
                    title: "No prediction yet",
                    message: "Log a run to see predictions",
                    detail: "Split Index builds your 5K time from your own sessions."
                )
            }
        }
        .foregroundStyle(surfaceText)
        // A widget must never stretch a number across a family it wasn't
        // laid out for — pin everything top-leading and let the family
        // decide how much room the content gets.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private enum ResolvedState {
        case ready(headline: RacePredictionEntry, ladder: [RacePredictionEntry], sampleCount: Int, updatedAt: Date)
        case calibrating(logged: Int, needed: Int)
        case empty
    }

    /// `.ready` is only honoured when a headline entry is actually present.
    /// A status that claims "ready" with no number is a bug somewhere
    /// upstream, and the safe reading of it is "we have nothing", not "show
    /// something plausible".
    private var resolvedState: ResolvedState {
        guard let snapshot else { return .empty }
        switch snapshot.status {
        case .ready:
            guard let headline = snapshot.headline else { return .empty }
            return .ready(
                headline: headline,
                ladder: snapshot.ladder,
                sampleCount: snapshot.sampleCount,
                updatedAt: snapshot.updatedAt
            )
        case .calibrating:
            return .calibrating(logged: snapshot.sampleCount, needed: snapshot.samplesNeeded)
        case .noData:
            return .empty
        }
    }
}

/// Shared top strip so every state is identifiably this app's, not a
/// generic system card.
private struct BrandHeader: View {
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "figure.run")
                .font(.caption2.bold())
            Text("SPLIT INDEX")
                .font(.system(size: 9, weight: .heavy))
                .tracking(1.1)
            Spacer(minLength: 0)
        }
        .foregroundStyle(surfaceAccent)
    }
}

private struct SmallReadyView: View {
    let headline: RacePredictionEntry
    let sampleCount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BrandHeader()

            Spacer(minLength: 4)

            Text("\(headline.label) PREDICTION")
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(surfaceMuted)

            Text(formatRacePrediction(headline.seconds))
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .monospacedDigit()
                .minimumScaleFactor(0.6)
                .lineLimit(1)

            Text(evidenceText(sampleCount))
                .font(.system(size: 10))
                .foregroundStyle(surfaceMuted)
                .lineLimit(1)
        }
    }
}

private struct MediumReadyView: View {
    let headline: RacePredictionEntry
    let ladder: [RacePredictionEntry]
    let sampleCount: Int
    let updatedAt: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BrandHeader()

            Spacer(minLength: 6)

            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("\(headline.label) PREDICTION")
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(0.6)
                        .foregroundStyle(surfaceMuted)
                    Text(formatRacePrediction(headline.seconds))
                        .font(.system(size: 40, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    Text(evidenceText(sampleCount))
                        .font(.system(size: 10))
                        .foregroundStyle(surfaceMuted)
                        .lineLimit(1)
                }

                // The ladder is genuinely optional — a brand-new Tier 2
                // benchmark can exist with nothing projected beyond the 5K.
                // Rather than pad the column with dashes, the headline just
                // takes the whole card.
                if !ladder.isEmpty {
                    Rectangle()
                        .fill(surfaceHairline)
                        .frame(width: 1)

                    VStack(alignment: .leading, spacing: 5) {
                        ForEach(ladder.prefix(3), id: \.label) { entry in
                            HStack(spacing: 8) {
                                Text(entry.label)
                                    .font(.system(size: 11))
                                    .foregroundStyle(surfaceMuted)
                                Spacer(minLength: 6)
                                Text(formatRacePrediction(entry.seconds))
                                    .font(.system(size: 13, weight: .semibold))
                                    .monospacedDigit()
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: 130)
                }
            }

            Spacer(minLength: 4)

            Text("Updated \(updatedAt.formatted(.relative(presentation: .named)))")
                .font(.system(size: 9))
                .foregroundStyle(surfaceMuted)
                .lineLimit(1)
        }
    }
}

/// Every non-`.ready` state. Deliberately words only — no time, no zero, no
/// em-dash standing in for a number that doesn't exist.
private struct MessageView: View {
    @Environment(\.widgetFamily) private var family
    let title: String
    let message: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BrandHeader()

            Spacer(minLength: 6)

            Text(title)
                .font(.system(size: family == .systemMedium ? 20 : 16, weight: .bold, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            Text(message)
                .font(.system(size: family == .systemMedium ? 13 : 11, weight: .medium))
                .foregroundStyle(surfaceAccent)
                .fixedSize(horizontal: false, vertical: true)

            if family == .systemMedium {
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(surfaceMuted)
                    .padding(.top, 4)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
    }
}

private func evidenceText(_ sampleCount: Int) -> String {
    sampleCount == 1 ? "from 1 session" : "from \(sampleCount) sessions"
}
