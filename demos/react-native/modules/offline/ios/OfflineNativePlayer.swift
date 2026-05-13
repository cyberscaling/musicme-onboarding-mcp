import AVFoundation
import ExpoModulesCore
import UIKit

final class NativePlayer: ExpoView {

    private var player: AVPlayer?
    private var loader: SasPlayerResourceLoader?
    private let loaderQueue = DispatchQueue(label: "cc.musicme.sasplayer.asset")
    private var timeObserver: Any?
    private var statusObservation: NSKeyValueObservation?
    private var rateObservation: NSKeyValueObservation?

    var autoPlay: Bool = false
    var trackTitle: String?
    var trackArtist: String?
    var trackCoverUrl: String?
    private(set) var currentRef: (cb: Int, disc: Int, track: Int)?

    let onReady = EventDispatcher()
    let onError = EventDispatcher()
    let onPlay = EventDispatcher()
    let onPause = EventDispatcher()
    let onTimeUpdate = EventDispatcher()
    let onEnded = EventDispatcher()
    let onStalled = EventDispatcher()
    let onSessionRotated = EventDispatcher()
    let onMetrics = EventDispatcher()

    private var loadStartedAt: Date?
    private var canplayAt: Date?
    private var bufferUnderruns: Int = 0
    private var lastEmittedFor: String?
    private weak var currentStreamSource: StreamSource?

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        backgroundColor = .black
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    func load(cb: Int, disc: Int, track: Int) {
        guard let service = OfflineSingleton.shared.service,
              let workerUrl = PlayerConfig.shared.workerUrl,
              let tokenProvider = PlayerConfig.shared.tokenProvider
        else {
            onError(["message": "player_not_configured"])
            return
        }

        if currentRef != nil {
            emitMetrics(outcome: "aborted")
        }

        tearDownPlayer()

        loadStartedAt = Date()
        canplayAt = nil
        bufferUnderruns = 0
        lastEmittedFor = nil

        let ref = StreamSession.TrackRef(cb: cb, disc: disc, track: track)
        let trackId = "\(cb):\(disc):\(track)"
        let source: ByteSource
        if let cached = PrefetchCache.shared.take(trackId) {
            source = cached
        } else {
            do {
                source = try service.openSource(
                    ref: ref, workerUrl: workerUrl, tokenProvider: tokenProvider)
            } catch {
                onError(["message": "openSource failed: \(error)"])
                return
            }
        }
        // Evict every other cached source to keep memory bounded.
        PrefetchCache.shared.clear(except: trackId)

        self.currentStreamSource = source as? StreamSource

        let loader = SasPlayerResourceLoader(source: source)
        self.loader = loader
        let encoded = trackId.addingPercentEncoding(withAllowedCharacters: .urlHostAllowed) ?? trackId
        guard let url = URL(string: "\(SasPlayerResourceLoader.scheme)://\(encoded)/audio.m4a") else {
            onError(["message": "invalid_trackid"]); return
        }

        let asset = AVURLAsset(url: url)
        asset.resourceLoader.setDelegate(loader, queue: loaderQueue)
        let item = AVPlayerItem(asset: asset)
        let p = AVPlayer(playerItem: item)
        self.player = p
        self.currentRef = (cb, disc, track)

        timeObserver = p.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 1000),
            queue: .main
        ) { [weak self] time in
            guard let self = self, let d = self.player?.currentItem?.duration else { return }
            let duration = CMTimeGetSeconds(d).isFinite ? CMTimeGetSeconds(d) * 1000 : 0
            self.onTimeUpdate(["position": CMTimeGetSeconds(time) * 1000, "duration": duration])
            if let ref = self.currentRef {
                NowPlayingCenter.shared.update(
                    title: self.trackTitle ?? "\(ref.cb)/\(ref.disc)/\(ref.track)",
                    artist: self.trackArtist,
                    coverUrl: self.trackCoverUrl,
                    durationMs: duration, positionMs: CMTimeGetSeconds(time) * 1000)
            }
        }

        NotificationCenter.default.addObserver(
            self, selector: #selector(itemDidEnd),
            name: .AVPlayerItemDidPlayToEndTime, object: item)

        NotificationCenter.default.addObserver(
            self, selector: #selector(itemStalled),
            name: .AVPlayerItemPlaybackStalled, object: item)

        statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            switch item.status {
            case .readyToPlay:
                if self?.canplayAt == nil { self?.canplayAt = Date() }
                let durSec = CMTimeGetSeconds(item.duration)
                self?.onReady(["duration": (durSec.isFinite ? durSec : 0) * 1000])
            case .failed:
                self?.onError(["message": item.error?.localizedDescription ?? "unknown"])
            default: break
            }
        }
        rateObservation = p.observe(\.rate, options: [.new]) { [weak self] player, _ in
            if player.rate > 0 { self?.onPlay([:]) } else { self?.onPause([:]) }
        }

        if autoPlay { p.play() }

        NowPlayingCenter.shared.player = self
        NowPlayingCenter.shared.activate()
        NowPlayingCenter.shared.update(
            title: trackTitle ?? "\(cb)/\(disc)/\(track)",
            artist: trackArtist,
            coverUrl: trackCoverUrl,
            durationMs: 0, positionMs: 0)
    }

    @objc private func itemDidEnd() {
        emitMetrics(outcome: "canplay")
        onEnded([:])
    }

    @objc private func itemStalled() {
        bufferUnderruns += 1
        onStalled([:])
    }

    private func emitMetrics(outcome: String) {
        guard let ref = currentRef else { return }
        let trackId = "\(ref.cb):\(ref.disc):\(ref.track)"
        if lastEmittedFor == trackId { return }
        lastEmittedFor = trackId

        let firstCanplayMs: Double? = (loadStartedAt != nil && canplayAt != nil)
            ? canplayAt!.timeIntervalSince(loadStartedAt!) * 1000.0 : nil
        let totalPlayMs: Double? = loadStartedAt.map { Date().timeIntervalSince($0) * 1000.0 }
        let weakSource = currentStreamSource
        let underruns = bufferUnderruns

        Task { [weak self] in
            var bootstrap: Double? = nil
            var firstRange: Double? = nil
            var fileSize: Int64? = nil
            var rotations: Int = 0
            if let s = weakSource {
                let m = await s.sessionMetrics()
                bootstrap = m.bootstrapMs
                firstRange = m.firstRangeMs
                fileSize = m.fileSizeBytes
                rotations = m.sessionRotations
            }
            await MainActor.run {
                self?.onMetrics([
                    "v": 1,
                    "trackRef": trackId,
                    "outcome": outcome,
                    "bootstrapMs": bootstrap as Any,
                    "firstKeyMs": 0,
                    "firstRangeMs": firstRange as Any,
                    "firstCanplayMs": firstCanplayMs as Any,
                    "totalPlayMs": totalPlayMs as Any,
                    "bufferUnderruns": underruns,
                    "sessionRotations": rotations,
                    "fileSizeBytes": fileSize as Any,
                ])
            }
        }
    }

    func setPlaying(_ playing: Bool) {
        guard let p = player else { return }
        if playing { p.play() } else { p.pause() }
    }
    func seek(toMs: Double) {
        let t = CMTime(seconds: toMs / 1000.0, preferredTimescale: 1000)
        player?.seek(to: t)
    }

    private func tearDownPlayer() {
        if let ref = currentRef, lastEmittedFor != "\(ref.cb):\(ref.disc):\(ref.track)" {
            emitMetrics(outcome: "aborted")
        }
        player?.pause()
        if let t = timeObserver { player?.removeTimeObserver(t) }
        statusObservation = nil
        rateObservation = nil
        NotificationCenter.default.removeObserver(self)
        NowPlayingCenter.shared.clear()
        player = nil
        loader = nil
    }
}

/// Module-wide singleton holding the worker URL + token provider. Populated by
/// `OfflineExpoModule.configurePlayer(...)` (see Task 10).
final class PlayerConfig: @unchecked Sendable {
    static let shared = PlayerConfig()
    var workerUrl: URL?
    var tokenProvider: (@Sendable () async throws -> String)?
    var currentToken: String?
    private init() {}
}
