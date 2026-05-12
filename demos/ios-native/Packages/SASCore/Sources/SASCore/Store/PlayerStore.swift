import Foundation
import Observation

@available(macOS 14.0, iOS 17.0, *)
@MainActor
@Observable
public final class PlayerStore {
    // Observable state
    public private(set) var items: [QueueItem] = []
    public private(set) var mode: PlayerMode = .idle
    public private(set) var track: TrackMeta?
    public private(set) var trackRef: TrackRef?
    public private(set) var playing: Bool = false
    public private(set) var currentTime: TimeInterval = 0
    public private(set) var duration: TimeInterval = 0
    public private(set) var currentIndex: Int = -1
    public private(set) var ephemeralList: [QueueItem] = []
    public private(set) var ephemeralIndex: Int = -1

    // Collaborators
    private let engine: PlaybackEngineProtocol
    private let persistence: QueuePersistence
    private let nowPlaying: NowPlayingCenter?
    private let heartbeat: HeartbeatTimer?

    nonisolated(unsafe) private var persistDebounce: Task<Void, Never>?
    nonisolated(unsafe) private var eventsTask: Task<Void, Never>?

    public init(
        engine: PlaybackEngineProtocol,
        persistence: QueuePersistence,
        nowPlaying: NowPlayingCenter?,
        heartbeat: HeartbeatTimer?
    ) {
        self.engine = engine
        self.persistence = persistence
        self.nowPlaying = nowPlaying
        self.heartbeat = heartbeat
        let engineRef = engine
        self.eventsTask = Task { [weak self] in
            for await event in engineRef.events {
                await self?.handleEvent(event)
            }
        }
    }

    deinit {
        eventsTask?.cancel()
        persistDebounce?.cancel()
    }

    // MARK: - Lifecycle

    public func hydrate() async {
        items = await persistence.load()
        mode = .idle
    }

    public func clearLocal() async {
        items = []
        await persistence.clear()
    }

    // MARK: - Play helpers

    public func playSingle(_ item: QueueItem) {
        mode = .ephemeral
        ephemeralList = [item]
        ephemeralIndex = 0
        trackRef = item.ref
        track = item.meta
        let ref = item.ref
        let meta = item.meta
        Task { await self.loadAndPlay(ref, meta: meta) }
    }

    // MARK: - Stop

    public func stop() async {
        if let heartbeat { await heartbeat.stop(complete: false) }
        await engine.stop()
        playing = false
        mode = .idle
        track = nil
        trackRef = nil
        currentIndex = -1
        ephemeralIndex = -1
        ephemeralList = []
        nowPlaying?.clear()
    }

    // MARK: - Events

    private func handleEvent(_ event: PlaybackEvent) async {
        switch event {
        case .loading:
            playing = false
        case .canplay(let d):
            duration = d
            playing = true
            updateNowPlaying()
            if let heartbeat, let sid = await engine.currentSessionId() {
                let engineRef = engine
                await heartbeat.start(sessionId: sid) { engineRef.currentElapsedMs() }
            }
        case .timeUpdate(let elapsed, let d):
            currentTime = elapsed
            duration = d
            updateNowPlayingElapsed()
        case .ended:
            playing = false
            if let heartbeat { await heartbeat.stop(complete: true) }
            await advance()
        case .error:
            playing = false
            if let heartbeat { await heartbeat.stop(complete: false) }
        }
    }

    private func loadAndPlay(_ ref: TrackRef, meta: TrackMeta) async {
        if let heartbeat { await heartbeat.stop(complete: false) }
        await engine.load(track: ref, meta: meta)
        await engine.play()
    }

    private func advance() async {
        switch mode {
        case .ephemeral:
            if ephemeralIndex + 1 < ephemeralList.count {
                ephemeralIndex += 1
                let next = ephemeralList[ephemeralIndex]
                trackRef = next.ref
                track = next.meta
                Task { await self.loadAndPlay(next.ref, meta: next.meta) }
            } else {
                await stop()
            }
        case .queue:
            if currentIndex + 1 < items.count {
                currentIndex += 1
                let next = items[currentIndex]
                trackRef = next.ref
                track = next.meta
                Task { await self.loadAndPlay(next.ref, meta: next.meta) }
            } else {
                await stop()
            }
        case .idle:
            break
        }
    }

    // MARK: - Now Playing helpers

    private func updateNowPlaying() {
        nowPlaying?.update(track: track, elapsed: currentTime, duration: duration, isPlaying: playing)
    }

    private func updateNowPlayingElapsed() {
        nowPlaying?.update(track: track, elapsed: currentTime, duration: duration, isPlaying: playing)
    }

    // MARK: - Test seam

    #if DEBUG
    func setItemsForTest(_ newItems: [QueueItem]) {
        items = newItems
    }
    #endif

    // MARK: - Play (extensions)

    public func playAlbumEphemeral(_ tracks: [QueueItem], startIndex: Int) {
        guard !tracks.isEmpty, startIndex >= 0, startIndex < tracks.count else { return }
        mode = .ephemeral
        ephemeralList = tracks
        ephemeralIndex = startIndex
        let first = tracks[startIndex]
        trackRef = first.ref
        track = first.meta
        Task { await self.loadAndPlay(first.ref, meta: first.meta) }
    }

    public func playQueueAt(_ id: UUID?) {
        guard !items.isEmpty else { return }
        let idx: Int
        if let id, let found = items.firstIndex(where: { $0.id == id }) {
            idx = found
        } else {
            idx = 0
        }
        mode = .queue
        currentIndex = idx
        let item = items[idx]
        trackRef = item.ref
        track = item.meta
        Task { await self.loadAndPlay(item.ref, meta: item.meta) }
    }

    // MARK: - Queue mutation

    public func enqueue(_ item: QueueItem) {
        items.append(item)
        schedulePersist()
    }

    public func dequeue(_ id: UUID) {
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
        let wasCurrent = (mode == .queue && idx == currentIndex)
        items.remove(at: idx)
        if mode == .queue {
            if wasCurrent {
                if items.isEmpty {
                    let s = self
                    Task { await s.stop() }
                } else {
                    let nextIdx = min(idx, items.count - 1)
                    currentIndex = nextIdx
                    let next = items[nextIdx]
                    trackRef = next.ref; track = next.meta
                    Task { await self.loadAndPlay(next.ref, meta: next.meta) }
                }
            } else if idx < currentIndex {
                currentIndex -= 1
            }
        }
        schedulePersist()
    }

    public func move(_ id: UUID, to target: Int) {
        guard let from = items.firstIndex(where: { $0.id == id }) else { return }
        let dest = max(0, min(target, items.count - 1))
        let moved = items.remove(at: from)
        items.insert(moved, at: dest)
        if mode == .queue, let trackRef, let found = items.firstIndex(where: { $0.ref == trackRef }) {
            currentIndex = found
        }
        schedulePersist()
    }

    // MARK: - Transport

    public func togglePlayback() {
        if mode == .idle && !items.isEmpty {
            playQueueAt(items.first?.id)
            return
        }
        let engineRef = engine
        if playing {
            playing = false
            Task { await engineRef.pause() }
        } else if track != nil {
            playing = true
            Task { await engineRef.play() }
        }
    }

    public func next() {
        Task { await advance() }
    }

    public func prev() {
        switch mode {
        case .ephemeral:
            if ephemeralIndex > 0 {
                ephemeralIndex -= 1
                let p = ephemeralList[ephemeralIndex]
                trackRef = p.ref; track = p.meta
                Task { await self.loadAndPlay(p.ref, meta: p.meta) }
            } else {
                seek(0)
            }
        case .queue:
            if currentIndex > 0 {
                currentIndex -= 1
                let p = items[currentIndex]
                trackRef = p.ref; track = p.meta
                Task { await self.loadAndPlay(p.ref, meta: p.meta) }
            } else {
                seek(0)
            }
        case .idle:
            break
        }
    }

    public func seek(_ time: TimeInterval) {
        let engineRef = engine
        Task { await engineRef.seek(to: time) }
    }

    // MARK: - Persistence (called by other operations in Task 20)

    fileprivate func schedulePersist() {
        persistDebounce?.cancel()
        let persistRef = persistence
        let snapshot = items
        persistDebounce = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 200_000_000)
            guard let _ = self else { return }
            await persistRef.save(snapshot)
        }
    }
}
