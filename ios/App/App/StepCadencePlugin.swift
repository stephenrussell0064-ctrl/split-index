import Foundation
import Capacitor
import CoreMotion

/**
 * Running/walking cadence (steps/min) via Core Motion's step counter — no
 * BLE footpod or watch needed, every iPhone with an M-series motion
 * coprocessor (all models this app supports) has this built in. Cadence is
 * reported as a running average (total steps so far ÷ elapsed minutes)
 * rather than an instantaneous delta between callbacks, since CMPedometer's
 * update cadence is irregular and a delta between two closely-spaced
 * callbacks can spike wildly on very little data — the running average
 * settles quickly and matches the "avg cadence" the rest of the app already
 * stores for BLE/manual entries.
 *
 * Cycling has no equivalent here — pedal RPM needs a bike cadence sensor,
 * a different sensor class entirely, so this plugin is only ever started
 * for running/walking sessions (see lib/native/step-cadence.ts).
 */
@objc(StepCadencePlugin)
public class StepCadencePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StepCadencePlugin"
    public let jsName = "StepCadence"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private let pedometer = CMPedometer()
    private var startDate: Date?

    /// Readings before this much elapsed time are too noisy to be worth
    /// emitting — a couple of steps in the first second would otherwise
    /// compute as a wildly high cadence.
    private let minElapsedSecondsBeforeReporting: TimeInterval = 5

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": CMPedometer.isStepCountingAvailable()])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard CMPedometer.isStepCountingAvailable() else {
            call.reject("Step counting is not available on this device")
            return
        }
        let start = Date()
        startDate = start
        pedometer.startUpdates(from: start) { [weak self] data, error in
            guard let self = self, let data = data, error == nil else { return }
            let elapsedSeconds = Date().timeIntervalSince(start)
            guard elapsedSeconds >= self.minElapsedSecondsBeforeReporting else { return }
            let elapsedMinutes = elapsedSeconds / 60
            let cadence = Double(truncating: data.numberOfSteps) / elapsedMinutes
            self.notifyListeners("cadence", data: ["spm": cadence])
        }
        call.resolve(["started": true])
    }

    @objc func stop(_ call: CAPPluginCall) {
        pedometer.stopUpdates()
        startDate = nil
        call.resolve(["stopped": true])
    }
}
