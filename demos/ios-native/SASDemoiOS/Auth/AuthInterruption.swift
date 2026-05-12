import Foundation
import AVFoundation
import SASCore

@MainActor
final class AVInterruptionObserver {
    private let store: PlayerStore
    private var token: NSObjectProtocol?
    private var routeToken: NSObjectProtocol?

    init(store: PlayerStore) {
        self.store = store
        token = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] note in
            Task { @MainActor in self?.handleInterruption(note) }
        }
        routeToken = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] note in
            Task { @MainActor in self?.handleRouteChange(note) }
        }
    }

    deinit {
        if let token { NotificationCenter.default.removeObserver(token) }
        if let routeToken { NotificationCenter.default.removeObserver(routeToken) }
    }

    private func handleInterruption(_ note: Notification) {
        guard let info = note.userInfo,
              let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        switch type {
        case .began:
            if store.playing { store.togglePlayback() }
        case .ended:
            let optionsRaw = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let opts = AVAudioSession.InterruptionOptions(rawValue: optionsRaw)
            if opts.contains(.shouldResume) && !store.playing { store.togglePlayback() }
        @unknown default: break
        }
    }

    private func handleRouteChange(_ note: Notification) {
        guard let info = note.userInfo,
              let raw = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
        if reason == .oldDeviceUnavailable, store.playing { store.togglePlayback() }
    }
}
