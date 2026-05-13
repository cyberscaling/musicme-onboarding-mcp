import XCTest
@testable import OfflineCore

final class StreamSessionTests: XCTestCase {

    private let workerURL = URL(string: "https://demo-stream.test")!

    override func setUp() {
        super.setUp()
        URLProtocol.registerClass(StubURLProtocol.self)
        StubURLProtocol.handlers = []
        StubURLProtocol.nextIndex = 0
        StubURLProtocol.initCalls = 0
    }
    override func tearDown() {
        URLProtocol.unregisterClass(StubURLProtocol.self)
        StubURLProtocol.handlers = []
        super.tearDown()
    }

    func testBootstrapReturnsSessionKeyIvFileSize() async throws {
        StubURLProtocol.handlers = [
            { req in
                XCTAssertEqual(req.url?.path, "/init-stream")
                XCTAssertEqual(req.httpMethod, "POST")
                let json = okInitJson()
                return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil,
                                        headerFields: ["Content-Type":"application/json"])!, json)
            },
        ]
        let session = StreamSession(workerUrl: workerURL,
                                    tokenProvider: { "tok-1" },
                                    trackRef: .init(cb: 1, disc: 0, track: 1),
                                    urlSession: StubURLProtocol.session())
        let boot = try await session.bootstrap()
        XCTAssertEqual(boot.sessionId, "sid-1")
        XCTAssertEqual(boot.fileSize, 16)
        XCTAssertEqual(boot.contentType, "audio/mp4")
        XCTAssertEqual(boot.key.count, 32)
        XCTAssertEqual(boot.iv.count, 16)
    }

    func test401OnBootstrapRefreshesTokenAndRetriesOnce() async throws {
        StubURLProtocol.handlers = [
            { req in
                let auth = req.value(forHTTPHeaderField: "Authorization") ?? ""
                if auth.hasSuffix("expired") {
                    return (HTTPURLResponse(url: req.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!, Data())
                }
                let json = okInitJson()
                return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil,
                                        headerFields: ["Content-Type":"application/json"])!, json)
            },
        ]
        let tokens = TokenBox(values: ["expired", "fresh"])
        let session = StreamSession(workerUrl: workerURL,
                                    tokenProvider: { tokens.next() },
                                    trackRef: .init(cb: 1, disc: 0, track: 1),
                                    urlSession: StubURLProtocol.session())
        _ = try await session.bootstrap()
        XCTAssertTrue(tokens.exhausted)
    }

    func testSecond401PropagatesAsSessionUnauthorized() async {
        StubURLProtocol.handlers = [{ req in
            (HTTPURLResponse(url: req.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!, Data())
        }]
        let session = StreamSession(workerUrl: workerURL,
                                    tokenProvider: { "bad" },
                                    trackRef: .init(cb: 1, disc: 0, track: 1),
                                    urlSession: StubURLProtocol.session())
        do { _ = try await session.bootstrap(); XCTFail("expected throw") }
        catch let e as OfflineError {
            XCTAssertEqual(e, .sessionUnauthorized)
        } catch { XCTFail("unexpected \(error)") }
    }

    func test410OnReadReinitializesSessionAndRetries() async throws {
        let initJsonOld = okInitJson(sessionId: "sid-old")
        let initJsonNew = okInitJson(sessionId: "sid-new")
        StubURLProtocol.handlers = [{ req in
            let path = req.url?.path ?? ""
            if path == "/init-stream" {
                // First init returns sid-old, second returns sid-new.
                let body: Data
                if StubURLProtocol.initCalls == 0 { body = initJsonOld } else { body = initJsonNew }
                StubURLProtocol.initCalls += 1
                return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil,
                                        headerFields: ["Content-Type":"application/json"])!, body)
            }
            if path.hasPrefix("/stream/sid-old") {
                return (HTTPURLResponse(url: req.url!, statusCode: 410, httpVersion: nil, headerFields: nil)!, Data())
            }
            if path.hasPrefix("/stream/sid-new") {
                let ct = Data(repeating: 0, count: 16)
                return (HTTPURLResponse(url: req.url!, statusCode: 206, httpVersion: nil,
                                        headerFields: ["Content-Range":"bytes 0-15/16",
                                                       "X-Counter-Start":"0",
                                                       "X-Skip-Bytes":"0"])!, ct)
            }
            fatalError("unexpected path \(path)")
        }]
        StubURLProtocol.initCalls = 0
        let session = StreamSession(workerUrl: workerURL,
                                    tokenProvider: { "tok" },
                                    trackRef: .init(cb: 1, disc: 0, track: 1),
                                    urlSession: StubURLProtocol.session())
        _ = try await session.bootstrap()
        let data = try await session.read(range: 0..<16)
        XCTAssertEqual(data.count, 16)
        XCTAssertEqual(StubURLProtocol.initCalls, 2)
    }

    func test403OnReadIsFatal() async throws {
        StubURLProtocol.handlers = [{ req in
            let path = req.url?.path ?? ""
            if path == "/init-stream" {
                return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil,
                                        headerFields: ["Content-Type":"application/json"])!, okInitJson())
            }
            return (HTTPURLResponse(url: req.url!, statusCode: 403, httpVersion: nil, headerFields: nil)!, Data())
        }]
        let session = StreamSession(workerUrl: workerURL,
                                    tokenProvider: { "tok" },
                                    trackRef: .init(cb: 1, disc: 0, track: 1),
                                    urlSession: StubURLProtocol.session())
        _ = try await session.bootstrap()
        do { _ = try await session.read(range: 0..<16); XCTFail("expected throw") }
        catch let e as OfflineError {
            XCTAssertEqual(e, .sessionFingerprintMismatch)
        } catch { XCTFail("unexpected \(error)") }
    }

    func testHeartbeat200ReturnsTrue() async throws {
        StubURLProtocol.handlers = [
            { req in
                if req.url?.path == "/init-stream" {
                    return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil,
                                            headerFields: ["Content-Type":"application/json"])!, okInitJson())
                }
                let body = "{\"ok\":true,\"duration_ms\":0,\"event_emitted\":null}".data(using: .utf8)!
                return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil,
                                        headerFields: ["Content-Type":"application/json"])!, body)
            },
        ]
        let session = StreamSession(workerUrl: workerURL,
                                    tokenProvider: { "tok" },
                                    trackRef: .init(cb: 1, disc: 0, track: 1),
                                    urlSession: StubURLProtocol.session())
        _ = try await session.bootstrap()
        let alive = try await session.heartbeat()
        XCTAssertTrue(alive)
    }

    func testHeartbeat410ReturnsFalse() async throws {
        StubURLProtocol.handlers = [{ req in
            if req.url?.path == "/init-stream" {
                return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil,
                                        headerFields: ["Content-Type":"application/json"])!, okInitJson())
            }
            return (HTTPURLResponse(url: req.url!, statusCode: 410, httpVersion: nil, headerFields: nil)!, Data())
        }]
        let session = StreamSession(workerUrl: workerURL,
                                    tokenProvider: { "tok" },
                                    trackRef: .init(cb: 1, disc: 0, track: 1),
                                    urlSession: StubURLProtocol.session())
        _ = try await session.bootstrap()
        let alive = try await session.heartbeat()
        XCTAssertFalse(alive)
    }

    func testMetricsCapturedAfterBootstrapAndRead() async throws {
        StubURLProtocol.handlers = [{ req in
            let path = req.url?.path ?? ""
            if path == "/init-stream" {
                return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil,
                                        headerFields: ["Content-Type":"application/json"])!, okInitJson())
            }
            let ct = Data(repeating: 0, count: 16)
            return (HTTPURLResponse(url: req.url!, statusCode: 206, httpVersion: nil,
                                    headerFields: ["Content-Range":"bytes 0-15/16",
                                                   "X-Counter-Start":"0",
                                                   "X-Skip-Bytes":"0"])!, ct)
        }]
        let session = StreamSession(workerUrl: workerURL,
                                    tokenProvider: { "tok" },
                                    trackRef: .init(cb: 1, disc: 0, track: 1),
                                    urlSession: StubURLProtocol.session())
        _ = try await session.bootstrap()
        _ = try await session.read(range: 0..<16)
        let m = await session.metrics()
        XCTAssertNotNil(m.bootstrapMs)
        XCTAssertNotNil(m.firstRangeMs)
        XCTAssertNotNil(m.firstDecryptMs)
        XCTAssertEqual(m.fileSizeBytes, 16)
        XCTAssertEqual(m.sessionRotations, 0)
    }

    func testSessionRotationsIncrementsOn410() async throws {
        StubURLProtocol.initCalls = 0
        StubURLProtocol.handlers = [{ req in
            let path = req.url?.path ?? ""
            if path == "/init-stream" {
                let sid = StubURLProtocol.initCalls == 0 ? "sid-old" : "sid-new"
                StubURLProtocol.initCalls += 1
                return (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil,
                                        headerFields: ["Content-Type":"application/json"])!,
                        okInitJson(sessionId: sid))
            }
            if path.hasPrefix("/stream/sid-old") {
                return (HTTPURLResponse(url: req.url!, statusCode: 410, httpVersion: nil, headerFields: nil)!, Data())
            }
            let ct = Data(repeating: 0, count: 16)
            return (HTTPURLResponse(url: req.url!, statusCode: 206, httpVersion: nil,
                                    headerFields: ["Content-Range":"bytes 0-15/16",
                                                   "X-Counter-Start":"0",
                                                   "X-Skip-Bytes":"0"])!, ct)
        }]
        let session = StreamSession(workerUrl: workerURL,
                                    tokenProvider: { "tok" },
                                    trackRef: .init(cb: 1, disc: 0, track: 1),
                                    urlSession: StubURLProtocol.session())
        _ = try await session.bootstrap()
        _ = try await session.read(range: 0..<16)
        let m = await session.metrics()
        XCTAssertEqual(m.sessionRotations, 1)
    }
}

// MARK: - Helpers

private func okInitJson(sessionId: String = "sid-1") -> Data {
    let key = Data(repeating: 0xAA, count: 32).base64EncodedString()
    let iv = Data(repeating: 0xBB, count: 16).base64EncodedString()
    return """
    {"sessionId":"\(sessionId)","fileSize":16,"contentType":"audio/mp4",
     "streamUrl":"/stream/\(sessionId)","keyUrl":"/key/\(sessionId)","expiresAt":0,
     "keyB64":"\(key)","ivB64":"\(iv)"}
    """.data(using: .utf8)!
}

final class TokenBox: @unchecked Sendable {
    private var values: [String]
    private let lock = NSLock()
    init(values: [String]) { self.values = values }
    func next() -> String {
        lock.lock(); defer { lock.unlock() }
        return values.removeFirst()
    }
    var exhausted: Bool {
        lock.lock(); defer { lock.unlock() }
        return values.isEmpty
    }
}

final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handlers: [@Sendable (URLRequest) -> (HTTPURLResponse, Data)] = []
    nonisolated(unsafe) static var nextIndex = 0
    nonisolated(unsafe) static var initCalls = 0
    static func session() -> URLSession {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [StubURLProtocol.self] + (cfg.protocolClasses ?? [])
        return URLSession(configuration: cfg)
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let h = Self.handlers.count == 1
            ? Self.handlers[0]
            : Self.handlers[Self.nextIndex % max(Self.handlers.count, 1)]
        Self.nextIndex += 1
        let (resp, data) = h(request)
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        if !data.isEmpty { client?.urlProtocol(self, didLoad: data) }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
