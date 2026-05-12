import Foundation
import SwiftUI
import SASCore

/// DI bag. Non-MainActor at the class level so it can be the default value of
/// the SwiftUI `EnvironmentKey` (SwiftUI propagates env in a non-MainActor
/// context during initial graph setup, before the explicit `.environment(...)`
/// binding has taken effect). `bootPlayer()` and the MainActor-bound state
/// (PlayerStore, NowPlayingCenter, PlaybackEngine) are isolated explicitly.
final class AppContainer: @unchecked Sendable {
    let api: APIBundle
    let persistence: UserDefaultsQueuePersistence

    @MainActor private(set) var streamWorkerURL: URL?
    @MainActor private(set) var playerStore: PlayerStore?
    @MainActor private(set) var nowPlaying: NowPlayingCenter?
    @MainActor private(set) var engine: PlaybackEngine?
    private(set) var heartbeat: HeartbeatTimer?

    init() {
        self.api = APIBundle(webappBaseURL: AppConfig.webappBaseURL)
        self.persistence = UserDefaultsQueuePersistence()
    }

    /// Boot the player after a successful auth probe. Fetches the stream worker URL
    /// and wires the engine + store + NowPlaying. Idempotent.
    @MainActor
    func bootPlayer() async {
        guard playerStore == nil else { return }
        do {
            let workerURL = try await api.config.streamWorkerURL()
            self.streamWorkerURL = workerURL
            let engine = PlaybackEngine(
                api: api,
                offlineStore: NoopOfflineStore(),
                streamWorkerURL: workerURL
            )
            let heartbeat = HeartbeatTimer(streamWorkerURL: workerURL)
            self.engine = engine
            self.heartbeat = heartbeat

            // Build remote handlers using a weak placeholder; bind after store exists.
            weak var weakStore: PlayerStore?
            let handlers = RemoteHandlers(
                play: { Task { @MainActor in weakStore?.togglePlayback() } },
                pause: { Task { @MainActor in weakStore?.togglePlayback() } },
                toggle: { Task { @MainActor in weakStore?.togglePlayback() } },
                next: { Task { @MainActor in weakStore?.next() } },
                prev: { Task { @MainActor in weakStore?.prev() } },
                seek: { t in Task { @MainActor in weakStore?.seek(t) } }
            )
            let np = NowPlayingCenter(handlers: handlers)
            self.nowPlaying = np

            let store = PlayerStore(engine: engine, persistence: persistence, nowPlaying: np, heartbeat: heartbeat)
            weakStore = store
            self.playerStore = store
        } catch {
            // Streaming features unavailable. Login still works; catalog still works.
            // Surface this in UI as a banner if it becomes a real problem.
        }
    }
}
