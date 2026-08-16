import ActivityKit
import AppIntents
import Foundation
import OSLog
import UserNotifications

@available(iOS 17.0, *)
private actor RestTimerIntentCoordinator {
  static let shared = RestTimerIntentCoordinator()

  private let logger = Logger(
    subsystem: "com.sachitgoyal.liftai",
    category: "RestTimerIntent"
  )
  private let notificationIdentifier = "liftai-rest-complete"

  func adjust(by deltaSeconds: Int) async {
    guard var snapshot = RestTimerSnapshotStore.read(), snapshot.isActive else {
      logger.info("Ignoring rest adjustment without an active snapshot")
      return
    }

    let nowMs = Date().timeIntervalSince1970 * 1000
    guard snapshot.endTimeMs > nowMs else {
      logger.info("Ignoring rest adjustment for an expired snapshot")
      return
    }

    let adjustedEndTimeMs = snapshot.endTimeMs + Double(deltaSeconds * 1000)
    if adjustedEndTimeMs <= nowMs {
      snapshot.endTimeMs = 0
      snapshot.isActive = false
    } else {
      snapshot.endTimeMs = adjustedEndTimeMs
      if deltaSeconds > 0 {
        snapshot.maxRestSeconds += Double(deltaSeconds)
      }
    }
    snapshot.updatedAtMs = nowMs
    snapshot.writer = "intent"

    guard RestTimerSnapshotStore.write(snapshot) else {
      logger.error("Failed to write adjusted rest snapshot")
      return
    }

    await updateLiveActivity(from: snapshot)
    await replaceCompletionNotification(from: snapshot)
  }

  private func updateLiveActivity(from snapshot: RestTimerSnapshot) async {
    guard let activity = Activity<LiveActivityAttributes>.activities.first(where: {
      $0.id == snapshot.activityId
    }) else {
      logger.error("No matching Live Activity for rest adjustment")
      return
    }

    let subtitle = snapshot.isActive
      ? "Set \(snapshot.setNumber)/\(snapshot.totalSets)|\(Int(snapshot.maxRestSeconds))"
      : "Set \(snapshot.setNumber)/\(snapshot.totalSets)"
    let state = LiveActivityAttributes.ContentState(
      title: snapshot.exerciseName,
      subtitle: subtitle,
      timerEndDateInMilliseconds: snapshot.isActive ? snapshot.endTimeMs : nil,
      progress: nil,
      imageName: nil,
      dynamicIslandImageName: nil
    )
    let staleDate = snapshot.isActive
      ? Date(timeIntervalSince1970: snapshot.endTimeMs / 1000)
      : nil

    await activity.update(ActivityContent(state: state, staleDate: staleDate))
  }

  private func replaceCompletionNotification(from snapshot: RestTimerSnapshot) async {
    let center = UNUserNotificationCenter.current()
    center.removePendingNotificationRequests(withIdentifiers: [notificationIdentifier])
    center.removeDeliveredNotifications(withIdentifiers: [notificationIdentifier])

    guard snapshot.isActive else { return }

    let remainingSeconds = (snapshot.endTimeMs / 1000) - Date().timeIntervalSince1970
    guard remainingSeconds > 0 else { return }

    let content = UNMutableNotificationContent()
    content.title = "Rest Complete"
    content.body = "Time for your next set"
    content.sound = .default
    content.interruptionLevel = .timeSensitive

    let trigger = UNTimeIntervalNotificationTrigger(
      timeInterval: max(1, remainingSeconds),
      repeats: false
    )
    let request = UNNotificationRequest(
      identifier: notificationIdentifier,
      content: content,
      trigger: trigger
    )

    do {
      try await center.add(request)
    } catch {
      logger.error("Failed to reschedule rest notification: \(error.localizedDescription, privacy: .public)")
    }
  }
}

@available(iOS 17.0, *)
struct DecreaseRestIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Decrease rest by 15 seconds"

  func perform() async throws -> some IntentResult {
    await RestTimerIntentCoordinator.shared.adjust(by: -15)
    return .result()
  }
}

@available(iOS 17.0, *)
struct IncreaseRestIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Increase rest by 15 seconds"

  func perform() async throws -> some IntentResult {
    await RestTimerIntentCoordinator.shared.adjust(by: 15)
    return .result()
  }
}
