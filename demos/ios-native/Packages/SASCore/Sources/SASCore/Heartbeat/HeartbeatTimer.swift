import Foundation

public actor HeartbeatTimer {
    private let streamWorkerURL: URL
    private let session: URLSession
    private let interval: TimeInterval

    private var task: Task<Void, Never>?
    private var sessionId: String?
    private var elapsedProvider: (@Sendable () -> Int)?

    public init(streamWorkerURL: URL, session: URLSession = .shared, interval: TimeInterval = 10) {
        self.streamWorkerURL = streamWorkerURL
        self.session = session
        self.interval = interval
    }

    public func start(sessionId: String, elapsedMs: @escaping @Sendable () -> Int) async {
        await stop(complete: false)
        self.sessionId = sessionId
        self.elapsedProvider = elapsedMs
        let interval = self.interval  // capture locally to avoid weak self access in closure
        self.task = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                if Task.isCancelled { return }
                await self?.tick(complete: false)
            }
        }
    }

    public func stop(complete: Bool) async {
        task?.cancel()
        task = nil
        if let sid = sessionId {
            await post(sessionId: sid, durationMs: elapsedProvider?() ?? 0, complete: complete)
        }
        sessionId = nil
        elapsedProvider = nil
    }

    private func tick(complete: Bool) async {
        guard let sid = sessionId else { return }
        await post(sessionId: sid, durationMs: elapsedProvider?() ?? 0, complete: complete)
    }

    private func post(sessionId: String, durationMs: Int, complete: Bool) async {
        let bodyDict: [String: Any] = ["duration_ms": durationMs, "complete": complete]
        guard let bodyData = try? JSONSerialization.data(withJSONObject: bodyDict) else {
            return
        }

        var req = URLRequest(url: streamWorkerURL.appendingPathComponent("heartbeat/\(sessionId)"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = bodyData

        _ = try? await session.data(for: req)  // best-effort
    }
}
