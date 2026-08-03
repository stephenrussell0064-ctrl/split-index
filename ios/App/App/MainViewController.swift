import Capacitor

/**
 * HeartRateWorkoutPlugin is a local (non-npm) Capacitor plugin — nothing else
 * in the app references its Swift class, so Capacitor's Objective-C runtime
 * auto-discovery can't be relied on (the linker is free to dead-strip an
 * otherwise-unreferenced class), which is why the JS side was seeing
 * "plugin is not implemented on ios" even though the file compiled fine.
 * Explicitly registering it here in capacitorDidLoad() guarantees it's live
 * before any page can call it.
 */
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(HeartRateWorkoutPlugin())
    }
}
