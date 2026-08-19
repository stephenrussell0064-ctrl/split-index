import WidgetKit
import SwiftUI

/// Two widgets ship in this extension: the GPS-run / gym-timer Live Activity
/// (lock screen + Dynamic Island) and the home-screen race-prediction widget.
///
/// The Live Activity used to be the only member here, which is precisely why
/// nothing showed up when the athlete went looking in the Home Screen widget
/// gallery — an `ActivityConfiguration` is not a gallery-installable widget.
/// `RacePredictionWidget` is the `StaticConfiguration` that puts an entry
/// there.
@main
struct SplitIndexWidgetsBundle: WidgetBundle {
    var body: some Widget {
        SplitIndexWidgetsLiveActivity()
        RacePredictionWidget()
    }
}
