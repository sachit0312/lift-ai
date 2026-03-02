import Foundation
import os

let appGroupID = "group.com.sachitgoyal.liftai"
let workoutStateKey = "liftai_workout_state"
let actionQueueKey = "liftai_action_queue"

private let logger = Logger(subsystem: "com.sachitgoyal.liftai.LiveActivity", category: "UserDefaults")

// MARK: - Codable Models

struct WorkoutSetState: Codable {
    var exerciseName: String
    var exerciseBlockIndex: Int
    var setNumber: Int
    var totalSets: Int
    var restSeconds: Int
    var restEnabled: Bool
}

struct WorkoutState: Codable {
    var current: WorkoutSetState
    var isResting: Bool
    var restEndTime: Double
    var workoutActive: Bool
}

struct WorkoutAction: Codable {
    var type: String
    var delta: Double?
    var ts: Double
}

// MARK: - Helper

class WorkoutUserDefaultsHelper {
    static let shared = WorkoutUserDefaultsHelper()

    private let defaults: UserDefaults?

    private init() {
        defaults = UserDefaults(suiteName: appGroupID)
        if defaults == nil {
            logger.error("Failed to create UserDefaults for suite: \(appGroupID)")
        }
    }

    func readWorkoutState() -> WorkoutState? {
        defaults?.synchronize()
        guard let jsonString = defaults?.string(forKey: workoutStateKey),
              let data = jsonString.data(using: .utf8) else {
            logger.debug("readWorkoutState: no data for key \(workoutStateKey)")
            return nil
        }
        do {
            let state = try JSONDecoder().decode(WorkoutState.self, from: data)
            return state
        } catch {
            logger.error("readWorkoutState: decode failed: \(error.localizedDescription)")
            return nil
        }
    }

    func writeWorkoutState(_ state: WorkoutState) {
        guard let data = try? JSONEncoder().encode(state),
              let jsonString = String(data: data, encoding: .utf8) else {
            logger.error("writeWorkoutState: encode failed")
            return
        }
        defaults?.set(jsonString, forKey: workoutStateKey)
        defaults?.synchronize()
        logger.debug("writeWorkoutState: wrote state (exercise=\(state.current.exerciseName), set=\(state.current.setNumber)/\(state.current.totalSets))")
    }

    func appendAction(_ action: WorkoutAction) {
        var actions = readActionsInternal()
        guard let actionData = try? JSONEncoder().encode(action),
              let actionDict = try? JSONSerialization.jsonObject(with: actionData) else {
            logger.error("appendAction: encode failed")
            return
        }
        actions.append(actionDict)
        guard let arrayData = try? JSONSerialization.data(withJSONObject: actions),
              let jsonString = String(data: arrayData, encoding: .utf8) else {
            logger.error("appendAction: serialize failed")
            return
        }
        defaults?.set(jsonString, forKey: actionQueueKey)
        defaults?.synchronize()
        logger.debug("appendAction: queued action type=\(action.type)")
    }

    func readAndClearActions() -> [WorkoutAction] {
        defaults?.synchronize()
        guard let jsonString = defaults?.string(forKey: actionQueueKey),
              let data = jsonString.data(using: .utf8) else { return [] }
        defaults?.removeObject(forKey: actionQueueKey)
        defaults?.synchronize()
        return (try? JSONDecoder().decode([WorkoutAction].self, from: data)) ?? []
    }

    func clearAll() {
        defaults?.removeObject(forKey: workoutStateKey)
        defaults?.removeObject(forKey: actionQueueKey)
        defaults?.synchronize()
    }

    private func readActionsInternal() -> [Any] {
        defaults?.synchronize()
        guard let jsonString = defaults?.string(forKey: actionQueueKey),
              let data = jsonString.data(using: .utf8),
              let array = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return [] }
        return array
    }
}
