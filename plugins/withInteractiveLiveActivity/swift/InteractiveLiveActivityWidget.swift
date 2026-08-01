import ActivityKit
import SwiftUI
import WidgetKit

struct LiveActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var title: String
    var subtitle: String?
    var timerEndDateInMilliseconds: Double?
    var progress: Double?
    var imageName: String?
    var dynamicIslandImageName: String?
  }

  var name: String
  var backgroundColor: String?
  var titleColor: String?
  var subtitleColor: String?
  var progressViewTint: String?
  var progressViewLabelColor: String?
  var deepLinkUrl: String?
  var timerType: DynamicIslandTimerType?
  var padding: Int?
  var paddingDetails: PaddingDetails?
  var imagePosition: String?
  var imageWidth: Int?
  var imageHeight: Int?
  var imageWidthPercent: Double?
  var imageHeightPercent: Double?
  var imageAlign: String?
  var contentFit: String?

  enum DynamicIslandTimerType: String, Codable {
    case circular
    case digital
  }

  struct PaddingDetails: Codable, Hashable {
    var top: Int?
    var bottom: Int?
    var left: Int?
    var right: Int?
    var vertical: Int?
    var horizontal: Int?
  }
}

struct LiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: LiveActivityAttributes.self) { context in
      // Lock screen: use interactive view. isStale is threaded through so the rest section can
      // disappear at the deadline without the app pushing an update — the only mechanism
      // available while the phone is locked and the JS runtime is suspended.
      LiveActivityView(
        contentState: context.state,
        attributes: context.attributes,
        isStale: context.isStale
      )
        .activityBackgroundTint(
          context.attributes.backgroundColor.map { Color(hex: $0) }
        )
        .activitySystemActionForegroundColor(Color.black)
        .applyWidgetURL(from: context.attributes.deepLinkUrl)
    } dynamicIsland: { context in
      // Dynamic Island: keep original behavior (read-only)
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading, priority: 1) {
          // Strip the "|150" transport suffix — this region prints the subtitle verbatim, so
          // the raw value showed the user "Set 3/4|150".
          dynamicIslandExpandedLeading(
            title: context.state.title,
            subtitle: liveActivityDisplaySubtitle(context.state.subtitle)
          )
            .dynamicIsland(verticalPlacement: .belowIfTooWide)
            .padding(.leading, 5)
            .applyWidgetURL(from: context.attributes.deepLinkUrl)
        }
        DynamicIslandExpandedRegion(.trailing) {
          if let imageName = context.state.imageName {
            dynamicIslandExpandedTrailing(imageName: imageName)
              .padding(.trailing, 5)
              .applyWidgetURL(from: context.attributes.deepLinkUrl)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          if context.state.timerEndDateInMilliseconds != nil && !context.isStale {
            dynamicIslandExpandedBottom(
              contentState: context.state,
              progressViewTint: context.attributes.progressViewTint
            )
            .padding(.horizontal, 5)
            .applyWidgetURL(from: context.attributes.deepLinkUrl)
          }
        }
      } compactLeading: {
        // The app never sets dynamicIslandImageName, so this region used to be permanently
        // blank. A dumbbell at least identifies whose activity this is.
        Image(systemName: "dumbbell.fill")
          .foregroundStyle(context.attributes.progressViewTint.map { Color(hex: $0) } ?? .purple)
          .applyWidgetURL(from: context.attributes.deepLinkUrl)
      } compactTrailing: {
        // Outside rest the timer regions rendered nothing, so for most of a workout the
        // Dynamic Island was an empty pill. Fall back to the set counter.
        if let date = context.state.timerEndDateInMilliseconds, !context.isStale {
          compactTimer(
            endDate: date,
            timerType: context.attributes.timerType ?? .circular,
            progressViewTint: context.attributes.progressViewTint
          ).applyWidgetURL(from: context.attributes.deepLinkUrl)
        } else if let counter = setCounter(context.state.subtitle) {
          Text(counter)
            .font(.system(size: 14, weight: .semibold))
            .minimumScaleFactor(0.8)
            .applyWidgetURL(from: context.attributes.deepLinkUrl)
        }
      } minimal: {
        if let date = context.state.timerEndDateInMilliseconds, !context.isStale {
          compactTimer(
            endDate: date,
            timerType: context.attributes.timerType ?? .circular,
            progressViewTint: context.attributes.progressViewTint
          ).applyWidgetURL(from: context.attributes.deepLinkUrl)
        } else {
          Image(systemName: "dumbbell.fill")
            .foregroundStyle(context.attributes.progressViewTint.map { Color(hex: $0) } ?? .purple)
            .applyWidgetURL(from: context.attributes.deepLinkUrl)
        }
      }
    }
  }

  /// "Set 3/4" -> "3/4", for the compact Dynamic Island where space is tight.
  private func setCounter(_ subtitle: String?) -> String? {
    guard let cleaned = liveActivityDisplaySubtitle(subtitle) else { return nil }
    let stripped = cleaned.replacingOccurrences(of: "Set ", with: "")
    return stripped.contains("/") ? stripped : nil
  }

  @ViewBuilder
  private func compactTimer(
    endDate: Double,
    timerType: LiveActivityAttributes.DynamicIslandTimerType,
    progressViewTint: String?
  ) -> some View {
    if timerType == .digital {
      Text(timerInterval: Date.toTimerInterval(miliseconds: endDate))
        .font(.system(size: 15))
        .minimumScaleFactor(0.8)
        .fontWeight(.semibold)
        .frame(maxWidth: 60)
        .multilineTextAlignment(.trailing)
    } else {
      circularTimer(endDate: endDate)
        .tint(progressViewTint.map { Color(hex: $0) })
    }
  }

  private func dynamicIslandExpandedLeading(title: String, subtitle: String?) -> some View {
    VStack(alignment: .leading) {
      Spacer()
      Text(title)
        .font(.title2)
        .foregroundStyle(.white)
        .fontWeight(.semibold)
      if let subtitle {
        Text(subtitle)
          .font(.title3)
          .minimumScaleFactor(0.8)
          .foregroundStyle(.white.opacity(0.75))
      }
      Spacer()
    }
  }

  private func dynamicIslandExpandedTrailing(imageName: String) -> some View {
    VStack {
      Spacer()
      resizableImage(imageName: imageName)
      Spacer()
    }
  }

  private func dynamicIslandExpandedBottom(
    contentState: LiveActivityAttributes.ContentState,
    progressViewTint: String?
  ) -> some View {
    let endMs = contentState.timerEndDateInMilliseconds ?? 0
    let endDate = Date(timeIntervalSince1970: endMs / 1000)

    // Parse totalRestSeconds from subtitle pipe format ("Set X/Y|D")
    // to compute proportional progress interval (matches lock screen widget)
    let interval: ClosedRange<Date> = {
      if let subtitle = contentState.subtitle {
        let pipeParts = subtitle.components(separatedBy: "|")
        if pipeParts.count == 2, let totalRest = Int(pipeParts[1]), totalRest > 0 {
          let startDate = Date(timeIntervalSince1970: (endMs - Double(totalRest) * 1000) / 1000)
          return min(startDate, endDate) ... endDate
        }
      }
      return Date.now ... max(Date.now, endDate)
    }()

    // Explicit empty labels — the DefaultDateProgressLabel overload draws its own countdown
    // text above the bar, duplicating the timer in the expanded Dynamic Island.
    return ProgressView(
      timerInterval: interval,
      countsDown: true,
      label: { EmptyView() },
      currentValueLabel: { EmptyView() }
    )
      .id(endMs) // Force SwiftUI recreation on timer adjustments
      .foregroundStyle(.white)
      .tint(progressViewTint.map { Color(hex: $0) })
      .padding(.top, 5)
  }

  private func circularTimer(endDate: Double) -> some View {
    ProgressView(
      timerInterval: Date.toTimerInterval(miliseconds: endDate),
      countsDown: false,
      label: { EmptyView() },
      currentValueLabel: {
        EmptyView()
      }
    )
    .progressViewStyle(.circular)
  }
}
