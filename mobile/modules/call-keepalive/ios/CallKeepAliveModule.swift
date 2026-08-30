import AVFoundation
import ExpoModulesCore

/**
 * Keeps a call alive while the app is in the background.
 *
 * iOS needs nothing like Android's foreground service — the `audio` and
 * `voip` background modes in Info.plist already grant the exemption. What it
 * does need is an audio session configured for a call and *held active*: the
 * exemption applies while audio is actually running, and a session that is
 * merely configured is not running.
 *
 * `.playAndRecord` with mode `.voiceChat` is what makes this a call rather
 * than playback: it enables echo cancellation, picks the receiver instead of
 * the speaker, and tells the system this session should survive the app
 * leaving the screen.
 *
 * Interruptions are observed rather than assumed. A phone call, Siri or
 * another app taking the session ends ours, and without reactivating on the
 * way out the call comes back silent — which is the same symptom as having
 * no session at all, arrived at from the other direction.
 */
public final class CallKeepAliveModule: Module {
  private var active = false
  private var interruptionObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("CallKeepAlive")

    Function("isSupported") { () -> Bool in true }

    // `video` and the notification strings are Android's business. They are
    // accepted and ignored here so the JS side has one call for both
    // platforms rather than a branch at every call site.
    Function("start") { (_ video: Bool, _ title: String?, _ body: String?) -> Bool in
      self.activate()
    }

    Function("stop") {
      self.deactivate()
    }

    OnDestroy {
      self.deactivate()
    }
  }

  @discardableResult
  private func activate() -> Bool {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(
        .playAndRecord,
        mode: .voiceChat,
        options: [.allowBluetooth, .allowBluetoothA2DP, .duckOthers]
      )
      try session.setActive(true, options: [])
    } catch {
      // A call that cannot configure audio should still connect and work
      // while the app is open — which is what happened before this module
      // existed. Failing loudly here would turn a degraded call into none.
      return false
    }

    observeInterruptions()
    active = true
    return true
  }

  private func deactivate() {
    if let observer = interruptionObserver {
      NotificationCenter.default.removeObserver(observer)
      interruptionObserver = nil
    }
    guard active else { return }
    active = false

    // `.notifyOthersOnDeactivation` so whatever was ducked — music, a
    // podcast — comes back up instead of staying quiet after the call.
    try? AVAudioSession.sharedInstance().setActive(
      false,
      options: [.notifyOthersOnDeactivation]
    )
  }

  private func observeInterruptions() {
    guard interruptionObserver == nil else { return }
    interruptionObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: AVAudioSession.sharedInstance(),
      queue: .main
    ) { [weak self] notification in
      guard
        let self,
        self.active,
        let info = notification.userInfo,
        let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
        let type = AVAudioSession.InterruptionType(rawValue: raw)
      else { return }

      switch type {
      case .began:
        // Nothing to do: the system has already taken the session. Tearing
        // our state down here would leave nothing to reactivate with.
        break
      case .ended:
        // Only when the system says resuming is appropriate. Reactivating
        // over an incoming phone call is how an app gets muted for good.
        let options = (info[AVAudioSessionInterruptionOptionKey] as? UInt)
          .map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
        if options.contains(.shouldResume) {
          try? AVAudioSession.sharedInstance().setActive(true, options: [])
        }
      @unknown default:
        break
      }
    }
  }
}
