import Foundation

public final class StreamSource: ByteSource {
    public private(set) var fileSize: Int64 = 0
    public private(set) var contentType: String = "audio/mp4"

    private let session: StreamSession
    private var bootstrapped = false

    public init(workerUrl: URL,
                tokenProvider: @escaping @Sendable () async throws -> String,
                trackRef: StreamSession.TrackRef,
                urlSession: URLSession = .shared) {
        self.session = StreamSession(
            workerUrl: workerUrl, tokenProvider: tokenProvider,
            trackRef: trackRef, urlSession: urlSession)
    }

    /// Forces bootstrap; populates fileSize + contentType. Idempotent.
    public func prepare() async throws {
        if bootstrapped { return }
        let boot = try await session.bootstrap()
        fileSize = boot.fileSize
        contentType = boot.contentType
        bootstrapped = true
    }

    public func read(range: Range<Int64>) async throws -> Data {
        if !bootstrapped { try await prepare() }
        return try await session.read(range: range)
    }

    public func close() {
        let s = session
        Task { await s.close() }
    }

    /// Exposed so the player can drive heartbeats on a timer.
    public func heartbeat() async throws -> Bool { try await session.heartbeat() }

    public func sessionMetrics() async -> StreamSession.SessionMetrics {
        await session.metrics()
    }
}
