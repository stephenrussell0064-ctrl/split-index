import Foundation
import Capacitor
import HealthKit

/**
 * Reads workouts and vitals OUT of Apple Health, for the logging-effort
 * plan's phase 1. Everything a watch or another app has written into the
 * phone's health store — Apple Watch, Garmin Connect, Whoop, Oura, Coros,
 * Polar, Strava — comes back through here, so Split Index gets every
 * wearable at once without a partner API.
 *
 * READ ONLY. Nothing here writes to Health. (HeartRateWorkoutPlugin starts
 * a workout session to switch the AirPods sensor on, and discards it.)
 *
 * Three methods, all promises:
 *   isAvailable          — HKHealthStore.isHealthDataAvailable()
 *   requestAuthorization — Apple's permission sheet for the five read types.
 *                          HealthKit never says what was granted; a refused
 *                          type simply returns no samples.
 *   fetchSamples         — every sample on or after `since`, at most `limit`
 *                          per type, as plain JSON the web side validates
 *                          (lib/health/samples.ts) before anything is written.
 *
 * Foreground sync, not background delivery. The app is a WebView on the
 * production site, so the JavaScript that posts samples to the server runs
 * only while the app is open; the web side syncs on launch and on resume.
 * HKObserverQuery + enableBackgroundDelivery would wake this plugin with no
 * page to hand the samples to. That is why the background-delivery
 * entitlement stays unused for now, and it is a known item on the App Store
 * readiness checklist.
 *
 * The app's OWN workout sessions (HeartRateWorkoutPlugin's) are filtered out
 * by bundle id here, and again on the server, so a GPS run never comes back
 * as a second copy of itself.
 */
@objc(HealthImportPlugin)
public class HealthImportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthImportPlugin"
    public let jsName = "HealthImport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchSamples", returnType: CAPPluginReturnPromise),
    ]

    private let healthStore = HKHealthStore()

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoParser: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static func iso(_ date: Date) -> String {
        return isoFormatter.string(from: date)
    }

    private static func parseIso(_ value: String) -> Date? {
        return isoFormatter.date(from: value) ?? isoParser.date(from: value)
    }

    // MARK: - Types

    private var hrvType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN)! }
    private var restingHrType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .restingHeartRate)! }
    private var bodyMassType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .bodyMass)! }
    private var heartRateType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .heartRate)! }
    private var sleepType: HKCategoryType { HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)! }

    private var readTypes: Set<HKObjectType> {
        return [HKObjectType.workoutType(), hrvType, restingHrType, bodyMassType, heartRateType, sleepType]
    }

    // MARK: - Methods

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Apple Health is not available on this device")
            return
        }
        healthStore.requestAuthorization(toShare: nil, read: readTypes) { success, error in
            DispatchQueue.main.async {
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["requested": success])
                }
            }
        }
    }

    @objc func fetchSamples(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Apple Health is not available on this device")
            return
        }
        guard let sinceText = call.getString("since"), let since = HealthImportPlugin.parseIso(sinceText) else {
            call.reject("fetchSamples needs an ISO 8601 `since`")
            return
        }
        let limit = max(1, min(call.getInt("limit") ?? 500, 2000))
        let predicate = HKQuery.predicateForSamples(withStart: since, end: nil, options: .strictStartDate)
        let ascending = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)

        let group = DispatchGroup()
        var workouts: [[String: Any]] = []
        var hrv: [[String: Any]] = []
        var restingHr: [[String: Any]] = []
        var bodyMass: [[String: Any]] = []
        var sleep: [[String: Any]] = []
        var newest: Date? = nil
        let lock = NSLock()

        func noteNewest(_ date: Date) {
            lock.lock()
            if newest == nil || date > newest! { newest = date }
            lock.unlock()
        }

        // Workouts, with the heart-rate statistics each one needs.
        group.enter()
        let workoutQuery = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: limit, sortDescriptors: [ascending]) { [weak self] _, samples, _ in
            guard let self = self else { group.leave(); return }
            let ownBundle = Bundle.main.bundleIdentifier ?? ""
            let found = (samples as? [HKWorkout] ?? []).filter { workout in
                let bundle = workout.sourceRevision.source.bundleIdentifier
                return !(bundle == ownBundle || bundle.hasPrefix(ownBundle + "."))
            }
            if found.isEmpty { group.leave(); return }
            let inner = DispatchGroup()
            var rows: [[String: Any]] = []
            for workout in found {
                inner.enter()
                self.heartRateStatistics(for: workout) { avg, maxHr in
                    var row: [String: Any] = [
                        "uuid": workout.uuid.uuidString,
                        "activityType": HealthImportPlugin.activityName(workout.workoutActivityType),
                        "start": HealthImportPlugin.iso(workout.startDate),
                        "end": HealthImportPlugin.iso(workout.endDate),
                        "durationSeconds": workout.duration,
                        "sourceName": workout.sourceRevision.source.name,
                        "sourceBundleId": workout.sourceRevision.source.bundleIdentifier,
                    ]
                    if let distance = workout.totalDistance?.doubleValue(for: .meter()) {
                        row["distanceMeters"] = distance
                    }
                    if let energy = workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()) {
                        row["energyKcal"] = energy
                    }
                    if let avg = avg { row["avgHr"] = avg }
                    if let maxHr = maxHr { row["maxHr"] = maxHr }
                    if let elevation = (workout.metadata?[HKMetadataKeyElevationAscended] as? HKQuantity)?.doubleValue(for: .meter()) {
                        row["elevationMeters"] = elevation
                    }
                    if let indoor = workout.metadata?[HKMetadataKeyIndoorWorkout] as? Bool {
                        row["isIndoor"] = indoor
                    }
                    if let device = workout.device?.name {
                        row["deviceName"] = device
                    }
                    lock.lock()
                    rows.append(row)
                    lock.unlock()
                    noteNewest(workout.endDate)
                    inner.leave()
                }
            }
            inner.notify(queue: .global()) {
                lock.lock()
                workouts = rows.sorted { ($0["start"] as? String ?? "") < ($1["start"] as? String ?? "") }
                lock.unlock()
                group.leave()
            }
        }
        healthStore.execute(workoutQuery)

        // Quantity samples: one closure shape for the three daily vitals.
        func quantityRows(_ type: HKQuantityType, unit: HKUnit, into sink: @escaping ([[String: Any]]) -> Void) {
            group.enter()
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: limit, sortDescriptors: [ascending]) { _, samples, _ in
                let rows: [[String: Any]] = (samples as? [HKQuantitySample] ?? []).map { sample in
                    noteNewest(sample.endDate)
                    return [
                        "uuid": sample.uuid.uuidString,
                        "date": HealthImportPlugin.iso(sample.endDate),
                        "value": sample.quantity.doubleValue(for: unit),
                        "sourceName": sample.sourceRevision.source.name,
                    ]
                }
                sink(rows)
                group.leave()
            }
            healthStore.execute(query)
        }

        let bpm = HKUnit.count().unitDivided(by: .minute())
        quantityRows(hrvType, unit: .secondUnit(with: .milli)) { rows in lock.lock(); hrv = rows; lock.unlock() }
        quantityRows(restingHrType, unit: bpm) { rows in lock.lock(); restingHr = rows; lock.unlock() }
        quantityRows(bodyMassType, unit: .gramUnit(with: .kilo)) { rows in lock.lock(); bodyMass = rows; lock.unlock() }

        // Sleep: category samples, raw stage value, aggregated on the web side.
        group.enter()
        let sleepQuery = HKSampleQuery(sampleType: sleepType, predicate: predicate, limit: limit * 4, sortDescriptors: [ascending]) { _, samples, _ in
            let rows: [[String: Any]] = (samples as? [HKCategorySample] ?? []).map { sample in
                noteNewest(sample.endDate)
                return [
                    "uuid": sample.uuid.uuidString,
                    "start": HealthImportPlugin.iso(sample.startDate),
                    "end": HealthImportPlugin.iso(sample.endDate),
                    "value": sample.value,
                    "sourceName": sample.sourceRevision.source.name,
                ]
            }
            lock.lock(); sleep = rows; lock.unlock()
            group.leave()
        }
        healthStore.execute(sleepQuery)

        group.notify(queue: .main) {
            lock.lock()
            let result: [String: Any] = [
                "workouts": workouts,
                "hrv": hrv,
                "restingHr": restingHr,
                "bodyMass": bodyMass,
                "sleep": sleep,
                "newestSampleAt": newest.map { HealthImportPlugin.iso($0) } ?? NSNull(),
            ]
            lock.unlock()
            call.resolve(result)
        }
    }

    // MARK: - Helpers

    /// Average and maximum heart rate across one workout's interval, or nil for either when the store has no heart-rate samples in it.
    private func heartRateStatistics(for workout: HKWorkout, completion: @escaping (Double?, Double?) -> Void) {
        let interval = HKQuery.predicateForSamples(withStart: workout.startDate, end: workout.endDate, options: .strictStartDate)
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let query = HKStatisticsQuery(quantityType: heartRateType, quantitySamplePredicate: interval, options: [.discreteAverage, .discreteMax]) { _, statistics, _ in
            let avg = statistics?.averageQuantity()?.doubleValue(for: bpm)
            let maxHr = statistics?.maximumQuantity()?.doubleValue(for: bpm)
            completion(avg, maxHr)
        }
        healthStore.execute(query)
    }

    /// Apple's long enum to the handful of words the web side maps to a sport.
    private static func activityName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: return "running"
        case .walking: return "walking"
        case .hiking: return "hiking"
        case .cycling: return "cycling"
        case .swimming: return "swimming"
        case .rowing: return "rowing"
        case .traditionalStrengthTraining, .functionalStrengthTraining: return "strength"
        default: return "other"
        }
    }
}
