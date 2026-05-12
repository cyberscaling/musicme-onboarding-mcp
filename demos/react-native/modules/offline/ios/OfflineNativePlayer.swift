import AVFoundation
import ExpoModulesCore
import UIKit

class OfflineNativePlayer: ExpoView {
    private var player: AVPlayer?
    private var loader: OfflineAssetResourceLoader?
    private let loaderQueue = DispatchQueue(label: "cc.musicme.offline.asset-loader")
    private var timeObserver: Any?
    private var statusObservation: NSKeyValueObservation?
    private var rateObservation: NSKeyValueObservation?

    var autoPlay: Bool = false

    let onReady = EventDispatcher()
    let onError = EventDispatcher()
    let onPlay = EventDispatcher()
    let onPause = EventDispatcher()
    let onTimeUpdate = EventDispatcher()
    let onEnded = EventDispatcher()

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        backgroundColor = .black
    }

    deinit {
        // Observers are cleaned up in `load(trackId:)` when reloading; on deallocation
        // the player and KVO observation are torn down by ARC. Touching MainActor-isolated
        // stored properties from a nonisolated deinit is rejected by Swift 6.
        NotificationCenter.default.removeObserver(self)
    }

    func load(trackId: String) {
        guard let service = OfflineSingleton.shared.service else {
            onError(["message": "offline service not ready"])
            return
        }

        player?.pause()
        if let observer = timeObserver { player?.removeTimeObserver(observer) }
        statusObservation = nil
        rateObservation = nil
        NotificationCenter.default.removeObserver(self)

        let loader = OfflineAssetResourceLoader(
            service: service,
            deviceIdProvider: { DeviceIdProvider.current() }
        )
        self.loader = loader

        let encoded = trackId.addingPercentEncoding(withAllowedCharacters: .urlHostAllowed) ?? trackId
        guard let url = URL(string: "\(OfflineAssetResourceLoader.scheme)://\(encoded)/audio.m4a") else {
            onError(["message": "invalid trackId"])
            return
        }

        let asset = AVURLAsset(url: url)
        asset.resourceLoader.setDelegate(loader, queue: loaderQueue)

        let item = AVPlayerItem(asset: asset)
        let p = AVPlayer(playerItem: item)
        self.player = p

        timeObserver = p.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 1000),
            queue: DispatchQueue.main
        ) { [weak self] time in
            self?.onTimeUpdate(["position": CMTimeGetSeconds(time) * 1000])
        }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(itemDidEnd),
            name: .AVPlayerItemDidPlayToEndTime,
            object: item
        )

        statusObservation = item.observe(\AVPlayerItem.status, options: [.new]) { [weak self] item, _ in
            switch item.status {
            case .readyToPlay:
                self?.onReady([:])
            case .failed:
                self?.onError(["message": item.error?.localizedDescription ?? "unknown"])
            default:
                break
            }
        }

        rateObservation = p.observe(\.rate, options: [.new]) { [weak self] player, _ in
            if player.rate > 0 { self?.onPlay([:]) } else { self?.onPause([:]) }
        }

        if autoPlay { p.play() }
    }

    @objc private func itemDidEnd() { onEnded([:]) }

    func setPlaying(_ playing: Bool) {
        guard let p = player else { return }
        if playing { p.play() } else { p.pause() }
        // onPlay / onPause emitted by the rate KVO observer reacting to state changes.
    }

    func seek(toMs: Double) {
        let time = CMTime(seconds: toMs / 1000.0, preferredTimescale: 1000)
        player?.seek(to: time)
    }
}
