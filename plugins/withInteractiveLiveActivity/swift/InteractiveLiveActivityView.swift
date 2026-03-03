import SwiftUI
import WidgetKit

#if canImport(ActivityKit)

struct ConditionalForegroundViewModifier: ViewModifier {
  let color: String?

  func body(content: Content) -> some View {
    if let color = color {
      content.foregroundStyle(Color(hex: color))
    } else {
      content
    }
  }
}

// MARK: - Parsed State from ContentState

/// Parses set data from ContentState subtitle format: "Set X/Y" or "Set X/Y|D"
/// where D = total rest duration in seconds (present only during rest).
@available(iOS 17.0, *)
struct ParsedSetState {
  var exerciseName: String
  var setNumber: Int
  var totalSets: Int
  var totalRestSeconds: Int?

  static func from(_ cs: LiveActivityAttributes.ContentState) -> ParsedSetState? {
    guard let subtitle = cs.subtitle else { return nil }
    let setStr = subtitle.replacingOccurrences(of: "Set ", with: "")

    // Split by pipe first to extract optional rest duration
    let pipeParts = setStr.components(separatedBy: "|")
    let setParts = pipeParts[0].components(separatedBy: "/")
    guard setParts.count == 2, let setNum = Int(setParts[0]), let total = Int(setParts[1]) else { return nil }

    var restSeconds: Int? = nil
    if pipeParts.count == 2, let d = Int(pipeParts[1]) {
      restSeconds = d
    }

    return ParsedSetState(exerciseName: cs.title, setNumber: setNum, totalSets: total, totalRestSeconds: restSeconds)
  }
}

// MARK: - Interactive Lock Screen View (iOS 17+)

@available(iOS 17.0, *)
struct InteractiveLiveActivityView: View {
  let contentState: LiveActivityAttributes.ContentState
  let attributes: LiveActivityAttributes

  var body: some View {
    if ParsedSetState.from(contentState) != nil ||
       (contentState.timerEndDateInMilliseconds ?? 0) > 0 {
      UnifiedWorkoutView(contentState: contentState, attributes: attributes)
    } else {
      FallbackLiveActivityView(contentState: contentState, attributes: attributes)
    }
  }
}

// MARK: - Unified Workout View

@available(iOS 17.0, *)
struct UnifiedWorkoutView: View {
  let contentState: LiveActivityAttributes.ContentState
  let attributes: LiveActivityAttributes

  private var restEndDate: Date? {
    guard let end = contentState.timerEndDateInMilliseconds, end > 0 else { return nil }
    return Date(timeIntervalSince1970: end / 1000)
  }

  private var parsed: ParsedSetState? {
    ParsedSetState.from(contentState)
  }

  private var restEndTime: Double {
    contentState.timerEndDateInMilliseconds ?? 0
  }

  private var isResting: Bool {
    guard let restEnd = restEndDate else { return false }
    return restEnd > Date()
  }

  /// Progress bar interval using total rest duration encoded in subtitle.
  /// This gives proportional display: bar = remaining / total_rest_seconds.
  private var progressInterval: ClosedRange<Date> {
    let endMs = restEndTime
    let endDate = Date(timeIntervalSince1970: endMs / 1000)
    if let p = parsed, let totalRestSeconds = p.totalRestSeconds, totalRestSeconds > 0 {
      let totalMs = Double(totalRestSeconds) * 1000
      let startDate = Date(timeIntervalSince1970: (endMs - totalMs) / 1000)
      return min(startDate, endDate) ... endDate
    }
    return Date.now ... max(Date.now, endDate)
  }

  var body: some View {
    let resting = isResting

    VStack(spacing: 6) {
      // Header row: exercise name + set counter (identical in both states)
      HStack {
        Text(contentState.title)
          .font(.subheadline)
          .fontWeight(.semibold)
          .modifier(ConditionalForegroundViewModifier(color: attributes.titleColor))
          .lineLimit(1)
        Spacer()
        if let p = parsed {
          Text("Set \(p.setNumber)/\(p.totalSets)")
            .font(.caption)
            .modifier(ConditionalForegroundViewModifier(color: attributes.subtitleColor))
            .invalidatableContent()
        }
      }

      // Rest timer section (only when resting)
      if resting {
        // Countdown timer
        Text(timerInterval: Date.toTimerInterval(miliseconds: restEndTime))
          .id(restEndTime)  // Force recreation on timer adjustment
          .font(.system(size: 28, weight: .bold, design: .rounded))
          .modifier(ConditionalForegroundViewModifier(color: attributes.titleColor))
          .multilineTextAlignment(.center)
          .invalidatableContent()

        // Progress bar
        ProgressView(timerInterval: progressInterval, countsDown: true)
          .id(restEndTime)  // Force recreation on timer adjustment
          .tint(attributes.progressViewTint.map { Color(hex: $0) })
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
  }
}

// MARK: - Fallback View (iOS 16 / No State)

struct FallbackLiveActivityView: View {
  let contentState: LiveActivityAttributes.ContentState
  let attributes: LiveActivityAttributes

  var progressViewTint: Color? {
    attributes.progressViewTint.map { Color(hex: $0) }
  }

  var body: some View {
    VStack(alignment: .leading) {
      HStack(alignment: .center) {
        VStack(alignment: .leading, spacing: 2) {
          Text(contentState.title)
            .font(.title2)
            .fontWeight(.semibold)
            .modifier(ConditionalForegroundViewModifier(color: attributes.titleColor))

          if let subtitle = contentState.subtitle {
            Text(subtitle)
              .font(.title3)
              .modifier(ConditionalForegroundViewModifier(color: attributes.subtitleColor))
          }
        }.layoutPriority(1)
      }

      if let date = contentState.timerEndDateInMilliseconds {
        ProgressView(timerInterval: Date.toTimerInterval(miliseconds: date))
          .tint(progressViewTint)
      } else if let progress = contentState.progress {
        ProgressView(value: progress)
          .tint(progressViewTint)
      }
    }
    .padding(24)
  }
}

// MARK: - Main View Router

struct LiveActivityView: View {
  let contentState: LiveActivityAttributes.ContentState
  let attributes: LiveActivityAttributes

  var body: some View {
    if #available(iOS 17.0, *) {
      InteractiveLiveActivityView(contentState: contentState, attributes: attributes)
    } else {
      FallbackLiveActivityView(contentState: contentState, attributes: attributes)
    }
  }
}

#endif
