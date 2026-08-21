import WidgetKit
import SwiftUI

/// Three widgets ship in this extension: the GPS-run / gym-timer Live Activity
/// (lock screen + Dynamic Island), the home-screen race-prediction widget, and
/// the home-screen daily-training widget.
///
/// The Live Activity used to be the only member here, which is precisely why
/// nothing showed up when the athlete went looking in the Home Screen widget
/// gallery — an `ActivityConfiguration` is not a gallery-installable widget.
/// Each `StaticConfiguration` below is what puts an entry there, and a widget
/// left out of this bundle is a widget that does not exist however complete
/// its own file looks.
@main
struct SplitIndexWidgetsBundle: WidgetBundle {
    var body: some Widget {
        SplitIndexWidgetsLiveActivity()
        RacePredictionWidget()
        DailyTrainingWidget()
    }
}
