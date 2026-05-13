import AVFoundation
import MediaPlayer
import UIKit

final class NowPlayingCenter: @unchecked Sendable {
    nonisolated(unsafe) static let shared = NowPlayingCenter()

    weak var player: NativePlayer?
    private var commandsConfigured = false

    private init() {}

    func activate() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
        try? AVAudioSession.sharedInstance().setActive(true)

        guard !commandsConfigured else { return }
        commandsConfigured = true

        let cc = MPRemoteCommandCenter.shared()
        cc.playCommand.addTarget { [weak self] _ in
            self?.player?.setPlaying(true); return .success
        }
        cc.pauseCommand.addTarget { [weak self] _ in
            self?.player?.setPlaying(false); return .success
        }
        cc.nextTrackCommand.addTarget { _ in
            NotificationCenter.default.post(name: .nativePlayerRemoteNext, object: nil)
            return .success
        }
        cc.previousTrackCommand.addTarget { _ in
            NotificationCenter.default.post(name: .nativePlayerRemotePrev, object: nil)
            return .success
        }
        cc.changePlaybackPositionCommand.isEnabled = true
        cc.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let positionEvent = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            self?.player?.seek(toMs: positionEvent.positionTime * 1000.0)
            return .success
        }
        cc.seekForwardCommand.isEnabled = false
        cc.seekBackwardCommand.isEnabled = false
        cc.skipForwardCommand.isEnabled = false
        cc.skipBackwardCommand.isEnabled = false
    }

    func update(title: String, artist: String?, coverUrl: String?, durationMs: Double, positionMs: Double) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyPlaybackDuration: durationMs / 1000.0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: positionMs / 1000.0,
        ]
        if let a = artist { info[MPMediaItemPropertyArtist] = a }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        if let u = coverUrl, let url = URL(string: u) {
            fetchArtwork(url: url, title: title, artist: artist, durationMs: durationMs, positionMs: positionMs)
        }
    }

    private func fetchArtwork(url: URL, title: String, artist: String?, durationMs: Double, positionMs: Double) {
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data, let image = UIImage(data: data) else { return }
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async {
                var info: [String: Any] = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                info[MPMediaItemPropertyArtwork] = artwork
                // Re-apply primary fields in case nowPlayingInfo was overwritten between calls.
                info[MPMediaItemPropertyTitle] = title
                if let a = artist { info[MPMediaItemPropertyArtist] = a }
                info[MPMediaItemPropertyPlaybackDuration] = durationMs / 1000.0
                info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = positionMs / 1000.0
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }.resume()
    }

    func clear() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }
}

extension Notification.Name {
    static let nativePlayerRemoteNext = Notification.Name("nativePlayerRemoteNext")
    static let nativePlayerRemotePrev = Notification.Name("nativePlayerRemotePrev")
}
