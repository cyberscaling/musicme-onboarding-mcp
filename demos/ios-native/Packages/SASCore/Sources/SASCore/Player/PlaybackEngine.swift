import Foundation
import AVFoundation
import os

public protocol PlaybackEngineProtocol: AnyObject, Sendable {
    var events: AsyncStream<PlaybackEvent> { get }
    func load(track: TrackRef, meta: TrackMeta) async
    func play() async
    func pause() async
    func seek(to time: TimeInterval) async
    func stop() async
    func currentElapsedMs() -> Int
    func currentSessionId() async -> String?
}

public final class PlaybackEngine: NSObject, PlaybackEngineProtocol, @unchecked Sendable {
    private let api: APIBundle
    private let offlineStore: OfflineStore
    private let urlSession: URLSession
    private let streamWorkerURL: URL
    private let log = Logger(subsystem: "cc.musicme.sasdemo.ios", category: "player")

    private let player = AVPlayer()
    private var currentLoader: SecureStreamLoader?
    private var currentSession: StreamSession?
    private var statusObserver: NSKeyValueObservation?
    private var rateObserver: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var timeObserverToken: Any?

    private let eventsContinuation: AsyncStream<PlaybackEvent>.Continuation
    public let events: AsyncStream<PlaybackEvent>

    public init(api: APIBundle, offlineStore: OfflineStore, streamWorkerURL: URL, urlSession: URLSession = .shared) {
        self.api = api
        self.offlineStore = offlineStore
        self.urlSession = urlSession
        self.streamWorkerURL = streamWorkerURL
        var continuation: AsyncStream<PlaybackEvent>.Continuation!
        self.events = AsyncStream { continuation = $0 }
        self.eventsContinuation = continuation
        super.init()
    }

    deinit {
        if let token = timeObserverToken { player.removeTimeObserver(token) }
        if let obs = endObserver { NotificationCenter.default.removeObserver(obs) }
        eventsContinuation.finish()
    }

    public func load(track: TrackRef, meta: TrackMeta) async {
        eventsContinuation.yield(.loading)
        do {
            let item: AVPlayerItem
            if let localURL = await offlineStore.localURL(for: track) {
                item = AVPlayerItem(url: localURL)
                currentLoader = nil
                currentSession = nil
            } else {
                // init-stream expects { cb: Int, disc: Int, track: Int, context: String }
                let token = try await api.jwt.mint()
                let session = try await initStream(track: track, jwt: token)
                let loader = SecureStreamLoader(
                    session: session, jwt: token,
                    streamWorkerURL: streamWorkerURL,
                    urlSession: urlSession,
                    refreshJWT: { [api] in
                        await api.jwt.invalidate()
                        return try await api.jwt.mint()
                    }
                )
                let url = URL(string: "secured://stream/\(session.sessionId)")!
                // Override MIME hints AVPlayer to treat this custom-scheme asset as MP4 audio,
                // ensuring it asks the resource loader for byte ranges instead of bailing early.
                let asset = AVURLAsset(url: url, options: [
                    "AVURLAssetOverrideMIMETypeKey": "audio/mp4"
                ])
                asset.resourceLoader.setDelegate(loader, queue: DispatchQueue(label: "cc.musicme.sasdemo.ios.loader"))
                currentLoader = loader
                currentSession = session
                item = AVPlayerItem(asset: asset)
            }
            attachObservers(to: item)
            player.replaceCurrentItem(with: item)
        } catch let e as PlaybackError {
            eventsContinuation.yield(.error(e))
        } catch APIError.unauthorized {
            eventsContinuation.yield(.error(.sessionExpired))
        } catch APIError.http(let status, _) {
            eventsContinuation.yield(.error(.streamUnavailable(httpStatus: status)))
        } catch {
            eventsContinuation.yield(.error(.streamFetch(message: error.localizedDescription)))
        }
    }

    public func play() async { await MainActor.run { player.play() } }
    public func pause() async { await MainActor.run { player.pause() } }
    public func seek(to time: TimeInterval) async {
        await player.seek(to: CMTime(seconds: time, preferredTimescale: 600))
    }
    public func stop() async {
        await MainActor.run {
            player.pause()
            player.replaceCurrentItem(with: nil)
        }
        currentLoader = nil
        currentSession = nil
    }

    public func currentElapsedMs() -> Int {
        // Safe: currentTime() is documented thread-safe for reading.
        Int(player.currentTime().seconds * 1000)
    }

    public func currentSessionId() async -> String? {
        currentSession?.sessionId
    }

    // MARK: - internals

    private func initStream(track: TrackRef, jwt: String) async throws -> StreamSession {
        guard let cb = Int(track.cb) else {
            throw PlaybackError.streamUnavailable(httpStatus: 400)
        }
        var req = URLRequest(url: streamWorkerURL.appendingPathComponent("init-stream"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONEncoder().encode(
            InitStreamRequest(cb: cb, disc: track.disc, track: track.track, context: "on_demand"))
        let (data, resp): (Data, URLResponse)
        do { (data, resp) = try await urlSession.data(for: req) }
        catch { throw PlaybackError.streamFetch(message: error.localizedDescription) }
        let http = resp as! HTTPURLResponse
        if http.statusCode == 401 { throw PlaybackError.sessionExpired }
        guard (200..<300).contains(http.statusCode) else {
            throw PlaybackError.streamUnavailable(httpStatus: http.statusCode)
        }
        let parsed: InitStreamResponse
        do { parsed = try JSONDecoder().decode(InitStreamResponse.self, from: data) }
        catch { throw PlaybackError.streamFetch(message: "init decode") }
        do {
            return try StreamSession(
                sessionId: parsed.sessionId, fileSize: parsed.fileSize,
                keyB64: parsed.keyB64, ivB64: parsed.ivB64
            )
        } catch {
            throw PlaybackError.decrypt(message: "session base64 decode failed")
        }
    }

    private func attachObservers(to item: AVPlayerItem) {
        statusObserver?.invalidate()
        rateObserver?.invalidate()
        if let token = timeObserverToken { player.removeTimeObserver(token); timeObserverToken = nil }
        if let obs = endObserver { NotificationCenter.default.removeObserver(obs) }

        statusObserver = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard let self else { return }
            switch item.status {
            case .readyToPlay:
                let d = item.duration.seconds
                self.eventsContinuation.yield(.canplay(duration: d.isFinite ? d : 0))
            case .failed:
                let msg = (item.error as NSError?)?.localizedDescription ?? "unknown"
                self.eventsContinuation.yield(.error(.playbackFailed(message: msg)))
            default: break
            }
        }

        let interval = CMTime(seconds: 1, preferredTimescale: 600)
        timeObserverToken = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] t in
            guard let self else { return }
            let elapsed = t.seconds
            let d = self.player.currentItem?.duration.seconds ?? 0
            self.eventsContinuation.yield(.timeUpdate(elapsed: elapsed, duration: d.isFinite ? d : 0))
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            self?.eventsContinuation.yield(.ended)
        }
    }
}
