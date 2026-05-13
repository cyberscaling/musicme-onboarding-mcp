import Foundation

final class PrefetchCache: @unchecked Sendable {
    nonisolated(unsafe) static let shared = PrefetchCache()
    private let lock = NSLock()
    private var sources: [String: ByteSource] = [:]

    private init() {}

    func put(_ trackId: String, _ source: ByteSource) {
        lock.lock(); defer { lock.unlock() }
        sources[trackId]?.close()
        sources[trackId] = source
    }

    /// Returns + removes the cached source. Caller owns lifetime after this.
    func take(_ trackId: String) -> ByteSource? {
        lock.lock(); defer { lock.unlock() }
        return sources.removeValue(forKey: trackId)
    }

    func clear(except keepTrackId: String? = nil) {
        lock.lock(); defer { lock.unlock() }
        for (k, v) in sources where k != keepTrackId { v.close() }
        if let keep = keepTrackId, let kept = sources[keep] {
            sources = [keep: kept]
        } else {
            sources.removeAll()
        }
    }
}
