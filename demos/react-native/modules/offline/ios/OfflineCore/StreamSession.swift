import Foundation

public final class StreamSession: Sendable {
    public struct TrackRef: Equatable, Sendable {
        public let cb: Int
        public let disc: Int
        public let track: Int
        public init(cb: Int, disc: Int, track: Int) {
            self.cb = cb; self.disc = disc; self.track = track
        }
    }

    public struct Bootstrap: Sendable {
        public let sessionId: String
        public let fileSize: Int64
        public let key: Data
        public let iv: Data
        public let contentType: String
    }

    public struct SessionMetrics: Sendable {
        public let bootstrapMs: Double?
        public let firstRangeMs: Double?
        public let firstDecryptMs: Double?
        public let fileSizeBytes: Int64?
        public let sessionRotations: Int
    }

    private let workerUrl: URL
    private let tokenProvider: @Sendable () async throws -> String
    private let trackRef: TrackRef
    private let urlSession: URLSession
    private let cache = BootstrapCache()
    private let metricsRec = MetricsRecorder()

    public init(workerUrl: URL,
                tokenProvider: @escaping @Sendable () async throws -> String,
                trackRef: TrackRef,
                urlSession: URLSession = .shared) {
        self.workerUrl = workerUrl
        self.tokenProvider = tokenProvider
        self.trackRef = trackRef
        self.urlSession = urlSession
    }

    public func bootstrap() async throws -> Bootstrap {
        if let b = await cache.get() { return b }
        let b = try await runBootstrap(allowRetry: true)
        await cache.set(b)
        return b
    }

    public func read(range: Range<Int64>) async throws -> Data {
        let boot = try await bootstrap()
        do {
            return try await runRead(range: range, boot: boot)
        } catch OfflineError.streamRangeFailed(let status) where status == 410 {
            await metricsRec.incRotation()
            await cache.clear()
            let fresh = try await bootstrap()
            return try await runRead(range: range, boot: fresh)
        }
    }

    public func heartbeat() async throws -> Bool {
        guard let boot = await cache.get() else { return false }
        let url = workerUrl.appendingPathComponent("heartbeat/\(boot.sessionId)")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = "{\"duration_ms\":0}".data(using: .utf8)
        let (_, resp) = try await urlSession.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status == 200 { return true }
        if status == 410 { return false }
        throw OfflineError.streamRangeFailed(status: status)
    }

    public func close() async {
        await cache.clear()
    }

    public func metrics() async -> SessionMetrics {
        await metricsRec.snapshot()
    }

    // MARK: - Private

    private func runBootstrap(allowRetry: Bool) async throws -> Bootstrap {
        let t0 = Date()
        let url = workerUrl.appendingPathComponent("init-stream")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let token = try await tokenProvider()
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        // `context` declares the listening mode for royalty declaratifs and is
        // required by the integration contract (offline downloads are on-demand).
        let body: [String: Any] = [
            "cb": trackRef.cb, "disc": trackRef.disc, "track": trackRef.track,
            "context": "on_demand",
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await urlSession.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 {
            if allowRetry { return try await runBootstrap(allowRetry: false) }
            throw OfflineError.sessionUnauthorized
        }
        guard status == 200 else { throw OfflineError.sessionInitFailed(status: status) }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let sid = json["sessionId"] as? String,
              let fileSize = (json["fileSize"] as? NSNumber)?.int64Value,
              let contentType = json["contentType"] as? String,
              let keyB64 = json["keyB64"] as? String,
              let ivB64 = json["ivB64"] as? String,
              let key = Data(base64Encoded: keyB64),
              let iv = Data(base64Encoded: ivB64)
        else { throw OfflineError.streamMalformedResponse("init-stream") }
        let boot = Bootstrap(sessionId: sid, fileSize: fileSize, key: key, iv: iv, contentType: contentType)
        await metricsRec.recordBootstrap(Date().timeIntervalSince(t0) * 1000.0)
        await metricsRec.recordFileSize(boot.fileSize)
        return boot
    }

    private func runRead(range: Range<Int64>, boot: Bootstrap) async throws -> Data {
        let aligned = (range.lowerBound / 16) * 16
        let endInclusive = range.upperBound - 1
        let url = workerUrl.appendingPathComponent("stream/\(boot.sessionId)")
        var req = URLRequest(url: url)
        req.setValue("bytes=\(aligned)-\(endInclusive)", forHTTPHeaderField: "Range")

        var lastError: Error?
        for attempt in 0..<3 {
            do {
                let tStart = Date()
                let (cipher, resp) = try await urlSession.data(for: req)
                let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
                if status == 410 { throw OfflineError.streamRangeFailed(status: 410) }
                if status == 403 { throw OfflineError.sessionFingerprintMismatch }
                if status >= 500 || status == 429 {
                    throw OfflineError.streamRangeFailed(status: status)
                }
                guard status == 200 || status == 206 else {
                    throw OfflineError.streamRangeFailed(status: status)
                }
                let http = resp as! HTTPURLResponse
                let skip = Int(http.value(forHTTPHeaderField: "X-Skip-Bytes") ?? "0") ?? 0
                let counterStart = Int(http.value(forHTTPHeaderField: "X-Counter-Start") ?? "0") ?? Int(aligned / 16)
                await metricsRec.recordFirstRange(Date().timeIntervalSince(tStart) * 1000.0)
                let tDec = Date()
                let plain = try AESCTRDecryptor.decrypt(
                    ciphertext: cipher, key: boot.key, baseIv: boot.iv, blockIndex: counterStart)
                await metricsRec.recordFirstDecrypt(Date().timeIntervalSince(tDec) * 1000.0)
                let wantedLen = Int(range.upperBound - range.lowerBound)
                let from = skip
                let to = min(from + wantedLen, plain.count)
                return plain.subdata(in: from..<to)
            } catch OfflineError.streamRangeFailed(let s) where s == 410 || s == 403 {
                throw OfflineError.streamRangeFailed(status: s)
            } catch OfflineError.sessionFingerprintMismatch {
                throw OfflineError.sessionFingerprintMismatch
            } catch {
                lastError = error
                let delay: UInt64 = [500, 1_000, 2_000][attempt] * 1_000_000
                try? await Task.sleep(nanoseconds: delay)
            }
        }
        throw OfflineError.streamNetworkExhausted(String(describing: lastError ?? URLError(.cannotConnectToHost)))
    }
}

// MARK: - Actor-based cache (Swift 6 concurrency safe)

private actor BootstrapCache {
    private var value: StreamSession.Bootstrap?
    func get() -> StreamSession.Bootstrap? { value }
    func set(_ b: StreamSession.Bootstrap) { value = b }
    func clear() { value = nil }
}

// MARK: - Metrics recorder

private actor MetricsRecorder {
    var bootstrapMs: Double?
    var firstRangeMs: Double?
    var firstDecryptMs: Double?
    var fileSizeBytes: Int64?
    var sessionRotations: Int = 0

    func recordBootstrap(_ ms: Double) { if bootstrapMs == nil { bootstrapMs = ms } }
    func recordFirstRange(_ ms: Double) { if firstRangeMs == nil { firstRangeMs = ms } }
    func recordFirstDecrypt(_ ms: Double) { if firstDecryptMs == nil { firstDecryptMs = ms } }
    func recordFileSize(_ n: Int64) { fileSizeBytes = n }
    func incRotation() { sessionRotations += 1 }
    func snapshot() -> StreamSession.SessionMetrics {
        StreamSession.SessionMetrics(
            bootstrapMs: bootstrapMs, firstRangeMs: firstRangeMs,
            firstDecryptMs: firstDecryptMs, fileSizeBytes: fileSizeBytes,
            sessionRotations: sessionRotations)
    }
}
