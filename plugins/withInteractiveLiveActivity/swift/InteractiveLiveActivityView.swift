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

/// Parses set data from ContentState subtitle format: "Set X/Y"
@available(iOS 17.0, *)
struct ParsedSetState {
  var exerciseName: String
  var setNumber: Int
  var totalSets: Int

  static func from(_ cs: LiveActivityAttributes.ContentState) -> ParsedSetState? {
    guard let subtitle = cs.subtitle else { return nil }
    let setStr = subtitle.replacingOccurrences(of: "Set ", with: "")
    let setParts = setStr.components(separatedBy: "/")
    guard setParts.count == 2, let setNum = Int(setParts[0]), let total = Int(setParts[1]) else { return nil }
    return ParsedSetState(exerciseName: cs.title, setNumber: setNum, totalSets: total)
  }
}

// MARK: - Interactive Lock Screen View (iOS 17+)

@available(iOS 17.0, *)
struct InteractiveLiveActivityView: View {
  let contentState: LiveActivityAttributes.ContentState
  let attributes: LiveActivityAttributes

  var body: some View {
    if let timerEnd = contentState.timerEndDateInMilliseconds, timerEnd > 0 {
      RestTimerView(exerciseName: contentState.title, restEndTime: timerEnd, attributes: attributes)
    } else if let parsed = ParsedSetState.from(contentState) {
      SetEntryView(parsed: parsed, attributes: attributes)
    } else {
      FallbackLiveActivityView(contentState: contentState, attributes: attributes)
    }
  }
}

// MARK: - Set Entry View

@available(iOS 17.0, *)
struct SetEntryView: View {
  let parsed: ParsedSetState
  let attributes: LiveActivityAttributes

  var body: some View {
    VStack(spacing: 6) {
      // Row 1: Exercise name + set counter
      HStack {
        Text(parsed.exerciseName)
          .font(.subheadline)
          .fontWeight(.semibold)
          .modifier(ConditionalForegroundViewModifier(color: attributes.titleColor))
          .lineLimit(1)
        Spacer()
        Text("Set \(parsed.setNumber)/\(parsed.totalSets)")
          .font(.caption)
          .modifier(ConditionalForegroundViewModifier(color: attributes.subtitleColor))
          .invalidatableContent()
      }

      // Row 2: Complete set button
      Button(intent: CompleteSetIntent()) {
        HStack {
          Image(systemName: "checkmark.circle.fill")
            .font(.system(size: 14))
          Text("Complete Set")
            .font(.subheadline)
            .fontWeight(.semibold)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(
          RoundedRectangle(cornerRadius: 10)
            .fill(Color(hex: attributes.progressViewTint ?? "#7C5CFC"))
        )
      }
      .buttonStyle(.plain)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
  }
}

// MARK: - Rest Timer View

@available(iOS 17.0, *)
struct RestTimerView: View {
  let exerciseName: String
  let restEndTime: Double
  let attributes: LiveActivityAttributes

  var body: some View {
    VStack(spacing: 6) {
      // Header
      HStack {
        Text("Rest")
          .font(.subheadline)
          .fontWeight(.semibold)
          .modifier(ConditionalForegroundViewModifier(color: attributes.titleColor))
        Text("· \(exerciseName)")
          .font(.caption)
          .modifier(ConditionalForegroundViewModifier(color: attributes.subtitleColor))
          .lineLimit(1)
        Spacer()
      }

      // Countdown timer
      Text(timerInterval: Date.toTimerInterval(miliseconds: restEndTime))
        .font(.system(size: 28, weight: .bold, design: .rounded))
        .modifier(ConditionalForegroundViewModifier(color: attributes.titleColor))
        .multilineTextAlignment(.center)
        .invalidatableContent()

      // Progress bar
      ProgressView(timerInterval: Date.toTimerInterval(miliseconds: restEndTime))
        .tint(attributes.progressViewTint.map { Color(hex: $0) })

      // Timer controls + skip
      HStack(spacing: 8) {
        Button(intent: DecreaseRestIntent()) {
          Text("-15s")
            .font(.caption)
            .fontWeight(.semibold)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(Color.white.opacity(0.15))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)

        Button(intent: IncreaseRestIntent()) {
          Text("+15s")
            .font(.caption)
            .fontWeight(.semibold)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(Color.white.opacity(0.15))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)

        Button(intent: SkipRestIntent()) {
          Text("Skip")
            .font(.caption)
            .fontWeight(.semibold)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(
              Capsule()
                .fill(Color(hex: attributes.progressViewTint ?? "#7C5CFC").opacity(0.3))
            )
            .foregroundStyle(Color(hex: attributes.progressViewTint ?? "#7C5CFC"))
        }
        .buttonStyle(.plain)
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
