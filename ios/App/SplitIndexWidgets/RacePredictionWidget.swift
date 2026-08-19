import WidgetKit
import SwiftUI
import UIKit

/**
 * The home-screen widget: both halves of the Split Index — the athlete's
 * predicted race times and their best-ever squat, bench, and deadlift.
 * Reads whatever the app last wrote into the shared App Group container
 * (RacePredictionStore) — a widget extension can't reach Supabase itself,
 * so there is nothing to fetch here, only something to render.
 *
 * Each half carries its OWN empty state, because endurance-only and
 * strength-only athletes are both completely normal here. A runner who has
 * never lifted must not see a 0 kg squat, and a lifter who has never run
 * must not see a card that looks broken — so the missing half says what is
 * missing, in words, and the half that exists still gets shown.
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
    let availability: RacePredictionStore.Availability
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
        RacePredictionEntryModel(date: Date(), availability: .published(Self.previewSnapshot))
    }

    func getSnapshot(in context: Context, completion: @escaping (RacePredictionEntryModel) -> Void) {
        let availability: RacePredictionStore.Availability = context.isPreview
            ? .published(Self.previewSnapshot)
            : RacePredictionStore.resolve()
        completion(RacePredictionEntryModel(date: Date(), availability: availability))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RacePredictionEntryModel>) -> Void) {
        let entry = RacePredictionEntryModel(date: Date(), availability: RacePredictionStore.resolve())
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
            RacePredictionWidgetView(availability: entry.availability)
                .widgetContainerBackground()
        }
        .configurationDisplayName("Races & Lifts")
        .description("Your predicted race times and your best squat, bench, and deadlift.")
        // No .systemLarge. Medium already holds everything the payload has —
        // the 5K, the ladder or the big three, and the evidence behind them.
        // Large would be the same content with more air around it, and every
        // family added is another layout to keep honest in both appearances.
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

/// The endurance half, already resolved. `.ready` is only ever produced when
/// a headline entry is genuinely present — a payload claiming "ready" with no
/// number is a bug upstream, and the safe reading of it is "we have nothing",
/// not "show something plausible".
private enum RaceHalf {
    case ready(headline: RacePredictionEntry, ladder: [RacePredictionEntry], sampleCount: Int)
    case calibrating(logged: Int, needed: Int)
    case empty
}

/// The strength half. Two states, because a best-ever lift needs no
/// calibration — see StrengthSnapshot. `.ready` requires at least one real
/// lift, so an athlete who has never touched a barbell gets words, never a
/// 0 kg squat.
private enum StrengthHalf {
    case ready(lifts: [StrengthLiftEntry], totalKg: Double, liftsLogged: Int)
    case empty
}

private struct RacePredictionWidgetView: View {
    let availability: RacePredictionStore.Availability

    var body: some View {
        Group {
            switch availability {
            case .disconnected:
                // The App Group isn't live for this build, so nothing the app
                // writes can ever arrive. Say so. Silently rendering the
                // empty state here is precisely the failure that made a
                // fully-trained athlete look untrained. Points at Settings
                // rather than guessing at a remedy: a widget has no room to
                // explain this, and the app's Settings screen says exactly
                // what is broken. Promising "reinstall and it'll work" would
                // be a second false statement on top of the one this replaces.
                MessageView(
                    title: "Widget not connected",
                    message: "Check Settings in the app",
                    detail: "Split Index can't share data with this widget on this build. Your training is still in the app."
                )
            case .neverPublished:
                // Reachable container, nothing in it. The app has never
                // handed anything over — which is a different sentence from
                // "you have no training", and telling an athlete the second
                // when the first is true is how this widget lost their trust.
                MessageView(
                    title: "Not synced yet",
                    message: "Open Split Index to sync",
                    detail: "Your predictions and lifts appear here once you've opened the app's home screen."
                )
            case .published(let snapshot):
                PublishedView(
                    race: Self.raceHalf(of: snapshot),
                    strength: Self.strengthHalf(of: snapshot),
                    updatedAt: snapshot.updatedAt
                )
            }
        }
        .foregroundStyle(surfaceText)
        // A widget must never stretch a number across a family it wasn't
        // laid out for — pin everything top-leading and let the family
        // decide how much room the content gets.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private static func raceHalf(of snapshot: RacePredictionSnapshot) -> RaceHalf {
        switch snapshot.status {
        case .ready:
            guard let headline = snapshot.headline else { return .empty }
            return .ready(
                headline: headline,
                ladder: snapshot.ladder,
                sampleCount: snapshot.sampleCount
            )
        case .calibrating:
            return .calibrating(logged: snapshot.sampleCount, needed: snapshot.samplesNeeded)
        case .noData:
            return .empty
        }
    }

    /// A snapshot written before the strength half existed has `strength ==
    /// nil`. That reads as the strength empty state, which is the honest
    /// answer: this widget has not been told anything about their lifting.
    private static func strengthHalf(of snapshot: RacePredictionSnapshot) -> StrengthHalf {
        guard let strength = snapshot.strength,
              strength.status == .ready,
              !strength.lifts.isEmpty
        else { return .empty }
        return .ready(
            lifts: strength.lifts,
            totalKg: strength.totalKg,
            liftsLogged: strength.liftsLogged
        )
    }
}

/// Both halves of the Split Index, laid out for the family it's in.
private struct PublishedView: View {
    @Environment(\.widgetFamily) private var family
    let race: RaceHalf
    let strength: StrengthHalf
    let updatedAt: Date

    var body: some View {
        if nothingLogged {
            // Neither half has anything. One honest invitation covering both,
            // rather than two empty columns that read as a broken card.
            MessageView(
                title: "Nothing logged yet",
                message: "Log a run or a lift",
                detail: "Split Index builds your race times and your best lifts from your own sessions."
            )
        } else if family == .systemMedium {
            MediumView(race: race, strength: strength, updatedAt: updatedAt)
        } else {
            SmallView(race: race, strength: strength)
        }
    }

    private var nothingLogged: Bool {
        if case .empty = race, case .empty = strength { return true }
        return false
    }
}

// MARK: - Small

/// Small holds ONE number legibly and no more, so it shows the half the
/// athlete actually has, race first.
///
/// Race leads because the 5K is this app's established headline. But an
/// athlete who only lifts would otherwise stare at "log a run" forever on a
/// card that could have shown their squat, so when there's no race
/// prediction the strength half takes the card instead. The rule is "show
/// the half we have", which is deterministic and explainable — not a guess
/// at what the athlete meant.
private struct SmallView: View {
    let race: RaceHalf
    let strength: StrengthHalf

    private enum Content {
        case race(headline: RacePredictionEntry, sampleCount: Int)
        case strength(totalKg: Double, liftsLogged: Int)
        case calibrating(logged: Int, needed: Int)
        case empty
    }

    private var content: Content {
        if case .ready(let headline, _, let sampleCount) = race {
            return .race(headline: headline, sampleCount: sampleCount)
        }
        if case .ready(_, let totalKg, let liftsLogged) = strength {
            return .strength(totalKg: totalKg, liftsLogged: liftsLogged)
        }
        if case .calibrating(let logged, let needed) = race {
            return .calibrating(logged: logged, needed: needed)
        }
        return .empty
    }

    var body: some View {
        switch content {
        case .race(let headline, let sampleCount):
            SmallStatView(
                caption: "\(headline.label) PREDICTION",
                value: formatRacePrediction(headline.seconds),
                detail: evidenceText(sampleCount)
            )
        case .strength(let totalKg, let liftsLogged):
            // The same two lines the dashboard's SBD tile prints, so the
            // home screen and the app can't state different totals.
            SmallStatView(
                caption: "SBD TOTAL",
                value: formatLiftKg(totalKg),
                detail: "\(liftsLogged)/3 lifts logged"
            )
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
                title: "Nothing logged yet",
                message: "Log a run or a lift",
                detail: "Split Index builds your race times and your best lifts from your own sessions."
            )
        }
    }
}

private struct SmallStatView: View {
    let caption: String
    let value: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BrandHeader()

            Spacer(minLength: 4)

            ColumnCaption(caption)

            Text(value)
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .monospacedDigit()
                .minimumScaleFactor(0.6)
                .lineLimit(1)

            Text(detail)
                .font(.system(size: 10))
                .foregroundStyle(surfaceMuted)
                .lineLimit(1)
        }
    }
}

// MARK: - Medium

/// Endurance on the left, strength on the right, split by the same hairline
/// the ladder used to sit behind. This is the family where the widget can
/// actually be what the app is — both halves at once.
private struct MediumView: View {
    let race: RaceHalf
    let strength: StrengthHalf
    let updatedAt: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BrandHeader()

            Spacer(minLength: 6)

            HStack(alignment: .top, spacing: 14) {
                RaceColumn(race: race)

                Rectangle()
                    .fill(surfaceHairline)
                    .frame(width: 1)

                RightColumn(strength: strength, ladder: ladder)
            }

            Spacer(minLength: 4)

            Text("Updated \(updatedAt.formatted(.relative(presentation: .named)))")
                .font(.system(size: 9))
                .foregroundStyle(surfaceMuted)
                .lineLimit(1)
        }
    }

    private var ladder: [RacePredictionEntry] {
        if case .ready(_, let ladder, _) = race { return ladder }
        return []
    }
}

private struct RaceColumn: View {
    let race: RaceHalf

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch race {
            case .ready(let headline, _, let sampleCount):
                ColumnCaption("\(headline.label) PREDICTION")
                // 34pt rather than the 40pt this had when the race owned the
                // whole card: it now shares the width with the lifts, and a
                // number that has to shrink to fit reads worse than one laid
                // out to the space it actually has.
                Text(formatRacePrediction(headline.seconds))
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text(evidenceText(sampleCount))
                    .font(.system(size: 10))
                    .foregroundStyle(surfaceMuted)
                    .lineLimit(1)
            case .calibrating(let logged, let needed):
                ColumnCaption("5K PREDICTION")
                Text("Calibrating")
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(needed > 0 ? "\(logged) of \(needed) runs" : "Keep logging runs")
                    .font(.system(size: 10))
                    .foregroundStyle(surfaceMuted)
                    .lineLimit(1)
            case .empty:
                ColumnCaption("5K PREDICTION")
                Text("No runs yet")
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text("Log a run")
                    .font(.system(size: 10))
                    .foregroundStyle(surfaceMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }
}

/// Top lifts when there are lifts. Otherwise the race ladder, which is what
/// this column used to hold — an endurance-only athlete keeps their 10K and
/// Half rather than losing them to a column of "no lifts". Only when there
/// is neither does it become the invitation to log one.
private struct RightColumn: View {
    let strength: StrengthHalf
    let ladder: [RacePredictionEntry]

    private enum Content {
        case lifts(lifts: [StrengthLiftEntry], liftsLogged: Int)
        case ladder([RacePredictionEntry])
        case invitation
    }

    private var content: Content {
        if case .ready(let lifts, _, let liftsLogged) = strength {
            return .lifts(lifts: lifts, liftsLogged: liftsLogged)
        }
        if !ladder.isEmpty { return .ladder(ladder) }
        return .invitation
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            switch content {
            case .lifts(let lifts, let liftsLogged):
                ColumnCaption("TOP LIFTS")
                ForEach(lifts.prefix(3), id: \.label) { lift in
                    ColumnRow(label: lift.label, value: formatLiftKg(lift.kg))
                }
                // Only when something is genuinely missing. A complete
                // 3-of-3 lifter doesn't need to be told their set is full.
                if liftsLogged < 3 {
                    Text("\(liftsLogged)/3 logged")
                        .font(.system(size: 9))
                        .foregroundStyle(surfaceMuted)
                        .lineLimit(1)
                }
            case .ladder(let entries):
                ColumnCaption("RACE LADDER")
                ForEach(entries.prefix(3), id: \.label) { entry in
                    ColumnRow(label: entry.label, value: formatRacePrediction(entry.seconds))
                }
            case .invitation:
                ColumnCaption("TOP LIFTS")
                Text("No lifts yet")
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Text("Log a squat, bench, or deadlift")
                    .font(.system(size: 10))
                    .foregroundStyle(surfaceMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: 140)
    }
}

private struct ColumnRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.system(size: 11))
                .foregroundStyle(surfaceMuted)
                .lineLimit(1)
            Spacer(minLength: 6)
            Text(value)
                .font(.system(size: 13, weight: .semibold))
                .monospacedDigit()
                .lineLimit(1)
        }
    }
}

private struct ColumnCaption: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(surfaceMuted)
            .lineLimit(1)
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
