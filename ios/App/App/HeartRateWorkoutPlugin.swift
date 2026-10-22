import Foundation
import Capacitor
import HealthKit

/**
 * AirPods Pro's heart-rate sensor only activates while an active
 * HKWorkoutSession is running — Apple doesn't expose it as a passive
 * background sensor, and no off-the-shelf Capacitor HealthKit plugin
 * starts/manages a live session (they only support querying already-
 * completed workouts after the fact). This plugin starts a real
 * HKWorkoutSession + HKLiveWorkoutBuilder for the duration of a Split
 * Index GPS run so the same live-BPM experience the Bluetooth HR path
 * (lib/native/heart-rate.ts) gives Garmin/Polar users also works for
 * AirPods Pro, without requiring the separate Apple Fitness app to be
 * running at the same time.
 *
 * `HKWorkoutSession(healthStore:configuration:)` on iPhone (as opposed to
 * watchOS, where it's existed for years) only became available in iOS 26 —
 * Apple gated iPhone-native workout sessions to that release, the same one
 * AirPods Pro's heart-rate sensor shipped alongside. The rest of this app
 * targets iOS 15+, so the actual HealthKit/workout-session implementation
 * is isolated in the `@available(iOS 26.0, *)` HeartRateWorkoutSession
 * class below — the plugin itself stays available at the app's real
 * deployment target and just declines with a clear message on older
 * devices instead of failing to compile or crashing.
 *
 * The workout is discarded rather than saved at the end — Split Index has
 * its own activity log, so writing a second, duplicate entry into Apple
 * Health's own workout history would just be confusing.
 */
@objc(HeartRateWorkoutPlugin)
public class HeartRateWorkoutPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HeartRateWorkoutPlugin"
    public let jsName = "HeartRateWorkout"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    // Boxed as Any? (rather than typed as HeartRateWorkoutSession directly)
    // so this stored property's declared type never references an
    // iOS-26-only symbol — that's what lets this whole class compile
    // unconditionally at the app's iOS 15 deployment target.
    private var activeSession: Any?

    @objc func isAvailable(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            call.resolve(["available": false])
            return
        }
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            call.reject("AirPods heart rate needs iOS 26 or later.")
            return
        }
        let activityType = call.getString("activityType") ?? "running"
        let workoutSession = HeartRateWorkoutSession(plugin: self)
        activeSession = workoutSession
        workoutSession.start(call, activityType: activityType)
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *), let workoutSession = activeSession as? HeartRateWorkoutSession else {
            call.resolve(["stopped": true])
            return
        }
        workoutSession.stop { [weak self] in
            self?.activeSession = nil
            call.resolve(["stopped": true])
        }
    }
}

@available(iOS 26.0, *)
private class HeartRateWorkoutSession: NSObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    private weak var plugin: CAPPlugin?
    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    init(plugin: CAPPlugin) {
        self.plugin = plugin
    }

    func start(_ call: CAPPluginCall, activityType: String) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit is not available on this device")
            return
        }
        guard let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
            call.reject("Heart rate type unavailable")
            return
        }
        let workoutType = HKObjectType.workoutType()
        let typesToShare: Set<HKSampleType> = [workoutType]
        let typesToRead: Set<HKObjectType> = [heartRateType, workoutType]

        healthStore.requestAuthorization(toShare: typesToShare, read: typesToRead) { [weak self] success, error in
            guard let self = self else { return }
            if !success {
                DispatchQueue.main.async {
                    call.reject(error?.localizedDescription ?? "HealthKit authorization was denied")
                }
                return
            }
            DispatchQueue.main.async {
                self.beginWorkoutSession(call, activityType: activityType)
            }
        }
    }

    /// Maps the JS-side GPS sport ("running"/"outdoor_cycling"/"walking") to the
    /// matching HealthKit activity type, so a bike ride or walk logged via
    /// AirPods HR doesn't show up mislabeled as a run in Apple Health.
    private func healthKitActivityType(for activityType: String) -> HKWorkoutActivityType {
        switch activityType {
        case "outdoor_cycling": return .cycling
        case "walking": return .walking
        default: return .running
        }
    }

    private func beginWorkoutSession(_ call: CAPPluginCall, activityType: String) {
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = healthKitActivityType(for: activityType)
        configuration.locationType = .outdoor

        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: configuration)

            session.delegate = self
            builder.delegate = self

            self.session = session
            self.builder = builder

            let startDate = Date()
            session.startActivity(with: startDate)
            builder.beginCollection(withStart: startDate) { success, error in
                DispatchQueue.main.async {
                    if success {
                        call.resolve(["started": true])
                    } else {
                        call.reject(error?.localizedDescription ?? "Could not start the workout session")
                    }
                }
            }
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    func stop(completion: @escaping () -> Void) {
        guard let session = self.session, let builder = self.builder else {
            completion()
            return
        }
        session.end()
        builder.endCollection(withEnd: Date()) { _, _ in
            builder.discardWorkout()
            DispatchQueue.main.async {
                completion()
            }
        }
    }

    // MARK: HKWorkoutSessionDelegate

    func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {}

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        plugin?.notifyListeners("error", data: ["message": error.localizedDescription])
    }

    // MARK: HKLiveWorkoutBuilderDelegate

    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate),
              collectedTypes.contains(heartRateType),
              let statistics = workoutBuilder.statistics(for: heartRateType),
              let mostRecent = statistics.mostRecentQuantity()
        else { return }

        let bpmUnit = HKUnit.count().unitDivided(by: HKUnit.minute())
        plugin?.notifyListeners("heartRate", data: [
            "bpm": mostRecent.doubleValue(for: bpmUnit),
            "timestamp": Date().timeIntervalSince1970 * 1000,
        ])
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}
