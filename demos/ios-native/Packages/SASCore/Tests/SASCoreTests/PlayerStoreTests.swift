import XCTest
@testable import SASCore

@available(macOS 14.0, iOS 17.0, *)
@MainActor
final class PlayerStoreTests: XCTestCase {
    private func makeStore(persistence: FakeQueuePersistence? = nil) -> (PlayerStore, FakePlaybackEngine, FakeQueuePersistence) {
        let engine = FakePlaybackEngine()
        let persist = persistence ?? FakeQueuePersistence()
        let store = PlayerStore(engine: engine, persistence: persist, nowPlaying: nil, heartbeat: nil)
        return (store, engine, persist)
    }

    func test_initialState_isIdle() {
        let (store, _, _) = makeStore()
        XCTAssertEqual(store.mode, .idle)
        XCTAssertNil(store.track)
        XCTAssertFalse(store.playing)
        XCTAssertEqual(store.currentIndex, -1)
        XCTAssertTrue(store.items.isEmpty)
    }

    func test_hydrate_loadsItemsFromPersistence_modeStaysIdle() async {
        let persist = FakeQueuePersistence()
        let preloaded = [
            QueueItem(ref: TrackRef(cb: "C1", disc: 1, track: 1),
                      meta: TrackMeta(title: "A", artist: "X", coverURL: nil, durationMs: nil))
        ]
        await persist.preload(preloaded)
        let engine = FakePlaybackEngine()
        let store = PlayerStore(engine: engine, persistence: persist, nowPlaying: nil, heartbeat: nil)
        await store.hydrate()
        XCTAssertEqual(store.items.count, 1)
        XCTAssertEqual(store.mode, .idle)
    }

    func test_clearLocal_emptiesItemsAndPersistence() async {
        let persist = FakeQueuePersistence()
        let item = QueueItem(ref: TrackRef(cb: "C", disc: 1, track: 1),
                             meta: TrackMeta(title: "T", artist: "A", coverURL: nil, durationMs: nil))
        await persist.preload([item])
        let store = PlayerStore(engine: FakePlaybackEngine(), persistence: persist, nowPlaying: nil, heartbeat: nil)
        await store.hydrate()
        await store.clearLocal()
        XCTAssertTrue(store.items.isEmpty)
        let still = await persist.load()
        XCTAssertTrue(still.isEmpty)
    }

    func test_playSingle_setsEphemeralMode_andTriggersEngineLoad() async {
        let (store, engine, _) = makeStore()
        let item = QueueItem(ref: TrackRef(cb: "C", disc: 1, track: 1),
                             meta: TrackMeta(title: "T", artist: "A", coverURL: nil, durationMs: nil))
        store.playSingle(item)
        // Engine.load runs in a Task — wait briefly.
        try? await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(store.mode, .ephemeral)
        XCTAssertEqual(store.track?.title, "T")
        XCTAssertEqual(engine.loadCalls.count, 1)
        XCTAssertEqual(engine.loadCalls.first?.ref.cb, "C")
    }
}

extension PlayerStoreTests {
    func test_playAlbumEphemeral_startsAtIndex_advancesOnEnded() async {
        let engine = FakePlaybackEngine()
        let store = PlayerStore(engine: engine, persistence: FakeQueuePersistence(), nowPlaying: nil, heartbeat: nil)
        let tracks = (0..<3).map { i in
            QueueItem(ref: TrackRef(cb: "C", disc: 1, track: i),
                      meta: TrackMeta(title: "T\(i)", artist: "A", coverURL: nil, durationMs: nil))
        }
        store.playAlbumEphemeral(tracks, startIndex: 1)
        try? await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(store.track?.title, "T1")
        XCTAssertEqual(engine.loadCalls.first?.meta.title, "T1")

        engine.emit(.canplay(duration: 100))
        try? await Task.sleep(for: .milliseconds(20))
        engine.emit(.ended)
        try? await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(store.track?.title, "T2")

        engine.emit(.ended)
        try? await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(store.mode, .idle)
        XCTAssertNil(store.track)
    }

    func test_playQueueAt_setsQueueMode_resolvesCurrentIndexById() async {
        let engine = FakePlaybackEngine()
        let store = PlayerStore(engine: engine, persistence: FakeQueuePersistence(), nowPlaying: nil, heartbeat: nil)
        let items = (0..<3).map { i in
            QueueItem(ref: TrackRef(cb: "C", disc: 1, track: i),
                      meta: TrackMeta(title: "T\(i)", artist: "A", coverURL: nil, durationMs: nil))
        }
        store.setItemsForTest(items)
        store.playQueueAt(items[1].id)
        try? await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(store.mode, .queue)
        XCTAssertEqual(store.currentIndex, 1)
        XCTAssertEqual(engine.loadCalls.last?.meta.title, "T1")
    }

    func test_enqueue_appends_andPersists() async {
        let persist = FakeQueuePersistence()
        let store = PlayerStore(engine: FakePlaybackEngine(), persistence: persist, nowPlaying: nil, heartbeat: nil)
        let item = QueueItem(ref: TrackRef(cb: "C", disc: 1, track: 1),
                             meta: TrackMeta(title: "T", artist: "A", coverURL: nil, durationMs: nil))
        store.enqueue(item)
        try? await Task.sleep(for: .milliseconds(300))   // wait past 200ms debounce
        let calls = await persist.saveCalls
        XCTAssertGreaterThan(calls, 0)
        XCTAssertEqual(store.items.count, 1)
    }

    func test_dequeue_currentTrackInQueueMode_advancesToNext() async {
        let engine = FakePlaybackEngine()
        let store = PlayerStore(engine: engine, persistence: FakeQueuePersistence(), nowPlaying: nil, heartbeat: nil)
        let items = (0..<2).map { i in
            QueueItem(ref: TrackRef(cb: "C", disc: 1, track: i),
                      meta: TrackMeta(title: "T\(i)", artist: "A", coverURL: nil, durationMs: nil))
        }
        store.setItemsForTest(items)
        store.playQueueAt(items[0].id)
        try? await Task.sleep(for: .milliseconds(20))
        store.dequeue(items[0].id)
        try? await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(store.items.count, 1)
        XCTAssertEqual(engine.loadCalls.last?.meta.title, "T1")
    }

    func test_move_reorders_currentIndexFollowsTrackId() async {
        let engine = FakePlaybackEngine()
        let store = PlayerStore(engine: engine, persistence: FakeQueuePersistence(), nowPlaying: nil, heartbeat: nil)
        let items = (0..<3).map { i in
            QueueItem(ref: TrackRef(cb: "C", disc: 1, track: i),
                      meta: TrackMeta(title: "T\(i)", artist: "A", coverURL: nil, durationMs: nil))
        }
        store.setItemsForTest(items)
        store.playQueueAt(items[1].id)
        try? await Task.sleep(for: .milliseconds(20))
        store.move(items[1].id, to: 0)
        XCTAssertEqual(store.items.first?.id, items[1].id)
        XCTAssertEqual(store.currentIndex, 0)
    }

    func test_togglePlayback_idleWithItems_startsQueueFromFirst() async {
        let engine = FakePlaybackEngine()
        let store = PlayerStore(engine: engine, persistence: FakeQueuePersistence(), nowPlaying: nil, heartbeat: nil)
        let items = [QueueItem(ref: TrackRef(cb: "C", disc: 1, track: 1),
                               meta: TrackMeta(title: "T", artist: "A", coverURL: nil, durationMs: nil))]
        store.setItemsForTest(items)
        store.togglePlayback()
        try? await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(store.mode, .queue)
        XCTAssertEqual(engine.loadCalls.count, 1)
    }

    func test_seek_forwardsToEngine() async {
        let engine = FakePlaybackEngine()
        let store = PlayerStore(engine: engine, persistence: FakeQueuePersistence(), nowPlaying: nil, heartbeat: nil)
        store.seek(42)
        try? await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(engine.seekCalls, [42])
    }
}

extension PlayerStoreTests {
    func test_heartbeat_canplayThenEnded_returnsToIdle_smoke() async {
        let engine = FakePlaybackEngine()
        let store = PlayerStore(engine: engine, persistence: FakeQueuePersistence(), nowPlaying: nil, heartbeat: nil)
        engine.fakeSessionId = "sid-test"
        engine.emit(.canplay(duration: 120))
        try? await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(store.duration, 120)
        XCTAssertTrue(store.playing)
        engine.emit(.ended)
        try? await Task.sleep(for: .milliseconds(20))
        // mode was idle (no items loaded via play*), advance() takes idle → no-op
        // The smoke check is: no crash, state coherent.
        XCTAssertFalse(store.playing)
    }
}
