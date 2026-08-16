import Foundation

struct RestTimerSnapshot: Codable {
  let version: Int
  let sessionId: String
  let activityId: String
  let exerciseName: String
  let setNumber: Int
  let totalSets: Int
  var endTimeMs: Double
  var maxRestSeconds: Double
  var isActive: Bool
  var updatedAtMs: Double
  var writer: String

  var isValid: Bool {
    version == 1
      && !sessionId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !activityId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !exerciseName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && setNumber > 0
      && totalSets >= setNumber
      && endTimeMs.isFinite
      && endTimeMs >= 0
      && maxRestSeconds.isFinite
      && maxRestSeconds >= 0
      && updatedAtMs.isFinite
      && updatedAtMs >= 0
      && (writer == "javascript" || writer == "intent")
  }
}

enum RestTimerSnapshotStore {
  static let appGroupId = "group.com.sachitgoyal.liftai"
  static let snapshotKey = "liftai_rest_timer_snapshot"

  static func read() -> RestTimerSnapshot? {
    guard let defaults = UserDefaults(suiteName: appGroupId) else {
      return nil
    }
    // Refresh the cross-process suite before decoding. The containing app explicitly
    // synchronizes its writes, and the intent extension may remain alive across rest sessions.
    defaults.synchronize()

    guard
      let raw = defaults.string(forKey: snapshotKey),
      let data = raw.data(using: .utf8),
      let snapshot = try? JSONDecoder().decode(RestTimerSnapshot.self, from: data),
      snapshot.isValid
    else {
      return nil
    }
    return snapshot
  }

  @discardableResult
  static func write(_ snapshot: RestTimerSnapshot) -> Bool {
    guard snapshot.isValid,
          let defaults = UserDefaults(suiteName: appGroupId),
          let data = try? JSONEncoder().encode(snapshot),
          let raw = String(data: data, encoding: .utf8)
    else {
      return false
    }

    defaults.set(raw, forKey: snapshotKey)
    defaults.synchronize()
    return true
  }
}
