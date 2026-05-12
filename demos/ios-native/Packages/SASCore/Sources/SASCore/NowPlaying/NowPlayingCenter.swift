import Foundation
#if canImport(UIKit)
import UIKit
#endif
import MediaPlayer

@MainActor
public final class NowPlayingCenter {
    private let urlSession: URLSession

    public init(handlers: RemoteHandlers, urlSession: URLSession = .shared) {
        self.urlSession = urlSession
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { _ in handlers.play(); return .success }
        c.pauseCommand.addTarget { _ in handlers.pause(); return .success }
        c.togglePlayPauseCommand.addTarget { _ in handlers.toggle(); return .success }
        c.nextTrackCommand.addTarget { _ in handlers.next(); return .success }
        c.previousTrackCommand.addTarget { _ in handlers.prev(); return .success }
        c.changePlaybackPositionCommand.addTarget { event in
            if let e = event as? MPChangePlaybackPositionCommandEvent {
                handlers.seek(e.positionTime)
                return .success
            }
            return .commandFailed
        }
    }

    public func update(track: TrackMeta?, elapsed: TimeInterval, duration: TimeInterval, isPlaying: Bool) {
        guard let track else { clear(); return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artist,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0
        ]
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        #if canImport(UIKit)
        if let coverURL = track.coverURL {
            let session = urlSession
            Task.detached { await Self.loadArtwork(url: coverURL, session: session) }
        }
        #endif
    }

    public func clear() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    #if canImport(UIKit)
    /// Nonisolated so the `MPMediaItemArtwork` request handler — invoked from
    /// MediaPlayer's private accessQueue — does not assert on a MainActor hop.
    nonisolated private static func loadArtwork(url: URL, session: URLSession) async {
        let req = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 8)
        guard let (data, _) = try? await session.data(for: req),
              let image = UIImage(data: data) else { return }
        let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        await MainActor.run {
            var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
            info[MPMediaItemPropertyArtwork] = artwork
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        }
    }
    #endif
}
