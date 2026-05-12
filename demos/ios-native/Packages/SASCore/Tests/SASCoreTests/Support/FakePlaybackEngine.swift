import Foundation
@testable import SASCore

final class FakePlaybackEngine: PlaybackEngineProtocol, @unchecked Sendable {
    private let continuation: AsyncStream<PlaybackEvent>.Continuation
    let events: AsyncStream<PlaybackEvent>

    private(set) var loadCalls: [(ref: TrackRef, meta: TrackMeta)] = []
    private(set) var playCount = 0
    private(set) var pauseCount = 0
    private(set) var stopCount = 0
    private(set) var seekCalls: [TimeInterval] = []
    var elapsedMs: Int = 0
    var fakeSessionId: String?

    init() {
        var c: AsyncStream<PlaybackEvent>.Continuation!
        events = AsyncStream { c = $0 }
        continuation = c
    }

    func load(track: TrackRef, meta: TrackMeta) async {
        loadCalls.append((track, meta))
    }
    func play() async { playCount += 1 }
    func pause() async { pauseCount += 1 }
    func seek(to time: TimeInterval) async { seekCalls.append(time) }
    func stop() async { stopCount += 1 }
    func currentElapsedMs() -> Int { elapsedMs }
    func currentSessionId() async -> String? { fakeSessionId }

    /// Drive an event from a test.
    func emit(_ event: PlaybackEvent) {
        continuation.yield(event)
    }
}
