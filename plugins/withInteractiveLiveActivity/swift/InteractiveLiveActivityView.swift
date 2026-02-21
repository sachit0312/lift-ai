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

struct DebugLog: View {
  #if DEBUG
    private let message: String
    init(_ message: String) {
      self.message = message
      print(message)
    }

    var body: some View {
      Text(message)
        .font(.caption2)
        .foregroundStyle(.red)
    }
  #else
    init(_: String) {}
    var body: some View { EmptyView() }
  #endif
}

// MARK: - Interactive Lock Screen View (iOS 17+)

@available(iOS 17.0, *)
struct InteractiveLiveActivityView: View {
  let contentState: LiveActivityAttributes.ContentState
  let attributes: LiveActivityAttributes

  var body: some View {
    let helper = WorkoutUserDefaultsHelper.shared
    let workoutState = helper.readWorkoutState()

    if let state = workoutState, state.workoutActive {
      if state.isResting {
        RestTimerView(state: state, attributes: attributes)
      } else {
        SetEntryView(state: state, attributes: attributes)
      }
    } else {
      // Fallback to basic view when no workout state available
      FallbackLiveActivityView(contentState: contentState, attributes: attributes)
    }
  }
}

// MARK: - Set Entry View

@available(iOS 17.0, *)
struct SetEntryView: View {
  let state: WorkoutState
  let attributes: LiveActivityAttributes

  var body: some View {
    VStack(spacing: 8) {
      // Exercise name + set counter
      HStack {
        Text(state.current.exerciseName)
          .font(.headline)
          .fontWeight(.semibold)
          .modifier(ConditionalForegroundViewModifier(color: attributes.titleColor))
          .lineLimit(1)
        Spacer()
        Text("Set \(state.current.setNumber)/\(state.current.totalSets)")
          .font(.subheadline)
          .modifier(ConditionalForegroundViewModifier(color: attributes.subtitleColor))
      }

      // Weight stepper
      HStack {
        Text("LBS")
          .font(.caption)
          .foregroundStyle(.secondary)
          .frame(width: 36, alignment: .leading)

        Button(intent: AdjustWeightIntent(delta: -2.5)) {
          Image(systemName: "minus")
            .font(.system(size: 14, weight: .bold))
            .frame(width: 32, height: 32)
            .background(Color.white.opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)

        Text(formatWeight(state.current.weight))
          .font(.title3)
          .fontWeight(.bold)
          .frame(minWidth: 60)
          .multilineTextAlignment(.center)
          .modifier(ConditionalForegroundViewModifier(color: attributes.titleColor))

        Button(intent: AdjustWeightIntent(delta: 2.5)) {
          Image(systemName: "plus")
            .font(.system(size: 14, weight: .bold))
            .frame(width: 32, height: 32)
            .background(Color.white.opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)

        Spacer()
      }

      // Reps stepper
      HStack {
        Text("REPS")
          .font(.caption)
          .foregroundStyle(.secondary)
          .frame(width: 36, alignment: .leading)

        Button(intent: AdjustRepsIntent(delta: -1)) {
          Image(systemName: "minus")
            .font(.system(size: 14, weight: .bold))
            .frame(width: 32, height: 32)
            .background(Color.white.opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)

        Text("\(state.current.reps)")
          .font(.title3)
          .fontWeight(.bold)
          .frame(minWidth: 60)
          .multilineTextAlignment(.center)
          .modifier(ConditionalForegroundViewModifier(color: attributes.titleColor))

        Button(intent: AdjustRepsIntent(delta: 1)) {
          Image(systemName: "plus")
            .font(.system(size: 14, weight: .bold))
            .frame(width: 32, height: 32)
            .background(Color.white.opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)

        Spacer()
      }

      // Complete set button
      Button(intent: CompleteSetIntent()) {
        HStack {
          Image(systemName: "checkmark.circle.fill")
            .font(.system(size: 16))
          Text("Complete Set")
            .fontWeight(.semibold)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(
          RoundedRectangle(cornerRadius: 10)
            .fill(Color(hex: attributes.progressViewTint ?? "#7C5CFC"))
        )
      }
      .buttonStyle(.plain)
    }
    .padding(16)
  }

  private func formatWeight(_ weight: Double) -> String {
    if weight.truncatingRemainder(dividingBy: 1) == 0 {
      return String(Int(weight))
    }
    return String(format: "%.1f", weight)
  }
}

// MARK: - Rest Timer View

@available(iOS 17.0, *)
struct RestTimerView: View {
  let state: WorkoutState
  let attributes: LiveActivityAttributes

  var body: some View {
    VStack(spacing: 10) {
      // Header
      HStack {
        Text("Rest")
          .font(.headline)
          .fontWeight(.semibold)
          .modifier(ConditionalForegroundViewModifier(color: attributes.titleColor))
        Text("- \(state.current.exerciseName)")
          .font(.subheadline)
          .modifier(ConditionalForegroundViewModifier(color: attributes.subtitleColor))
          .lineLimit(1)
        Spacer()
      }

      // Countdown timer
      if state.restEndTime > 0 {
        Text(timerInterval: Date.toTimerInterval(miliseconds: state.restEndTime))
          .font(.system(size: 36, weight: .bold, design: .rounded))
          .modifier(ConditionalForegroundViewModifier(color: attributes.titleColor))
          .multilineTextAlignment(.center)

        // Progress bar
        ProgressView(timerInterval: Date.toTimerInterval(miliseconds: state.restEndTime))
          .tint(attributes.progressViewTint.map { Color(hex: $0) })
      }

      // Timer controls + skip
      HStack(spacing: 12) {
        Button(intent: AdjustRestIntent(delta: -15)) {
          Text("-15s")
            .font(.subheadline)
            .fontWeight(.medium)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Color.white.opacity(0.15))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)

        Button(intent: AdjustRestIntent(delta: 15)) {
          Text("+15s")
            .font(.subheadline)
            .fontWeight(.medium)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Color.white.opacity(0.15))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)

        Button(intent: SkipRestIntent()) {
          Text("Skip")
            .font(.subheadline)
            .fontWeight(.semibold)
            .padding(.horizontal, 14)
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
    .padding(16)
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
