import WidgetKit
import SwiftUI

/// Only the Live Activity ships in this extension — no home-screen widget or
/// Control Center toggle, this app doesn't have static data worth putting on
/// either of those yet.
@main
struct SplitIndexWidgetsBundle: WidgetBundle {
    var body: some Widget {
        SplitIndexWidgetsLiveActivity()
    }
}
