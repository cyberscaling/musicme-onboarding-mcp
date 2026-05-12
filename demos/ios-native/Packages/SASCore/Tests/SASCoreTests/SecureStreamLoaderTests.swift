import XCTest
import AVFoundation
import OfflineCore
@testable import SASCore

@MainActor
final class SecureStreamLoaderTests: XCTestCase {
    override func setUp() async throws { URLProtocolMock.reset() }

    private let workerURL = URL(string: "https://stream.example.com")!
    private let session = try! StreamSession(
        sessionId: "sid-1", fileSize: 4096,
        key: Data(repeating: 0, count: 32),
        baseIv: Data(repeating: 0, count: 16)
    )

    func test_fetchRange_decrypts_andStripsSkipBytes() async throws {
        // Use OfflineCore.AESCTRDecryptor (CTR is symmetric — encrypts by decrypting).
        let plain = Data(repeating: 0xAA, count: 32)
        let cipher = try OfflineCore.AESCTRDecryptor.decrypt(
            ciphertext: plain, key: session.key, baseIv: session.baseIv, blockIndex: 0
        )
        URLProtocolMock.matchers = [{ req in
            req.url?.path.contains("/stream/sid-1") == true ?
                .init(status: 206,
                      headers: ["X-Counter-Start": "0", "X-Skip-Bytes": "4"],
                      body: cipher) : nil
        }]
        let result = try await SecureStreamLoader.fetchRange(
            start: 0, end: 31,
            session: session, jwt: "tok",
            streamWorkerURL: workerURL,
            urlSession: URLProtocolMock.session(),
            refreshJWT: { "tok" }
        )
        XCTAssertEqual(result.count, 28, "skipBytes=4 must drop 4 leading bytes")
        XCTAssertEqual(result, plain.subdata(in: 4..<32))
    }

    func test_fetchRange_on401_refreshesJWT_retriesOnce() async throws {
        let calls = CallCounter()
        URLProtocolMock.matchers = [{ req in
            let count = calls.increment()
            if count == 1 { return .init(status: 401) }
            return .init(status: 206, headers: ["X-Counter-Start": "0", "X-Skip-Bytes": "0"], body: Data())
        }]
        let refreshed = RefreshFlag()
        _ = try await SecureStreamLoader.fetchRange(
            start: 0, end: 0,
            session: session, jwt: "old",
            streamWorkerURL: workerURL,
            urlSession: URLProtocolMock.session(),
            refreshJWT: { refreshed.set(); return "new" }
        )
        XCTAssertTrue(refreshed.value)
        XCTAssertEqual(calls.value, 2)
    }

    func test_fetchRange_two401_throwsSessionExpired() async {
        URLProtocolMock.matchers = [{ _ in .init(status: 401) }]
        do {
            _ = try await SecureStreamLoader.fetchRange(
                start: 0, end: 0,
                session: session, jwt: "tok",
                streamWorkerURL: workerURL,
                urlSession: URLProtocolMock.session(),
                refreshJWT: { "tok-new" }
            )
            XCTFail()
        } catch PlaybackError.sessionExpired {
            // ok
        } catch {
            XCTFail("wrong error: \(error)")
        }
    }

    func test_fetchRange_5xx_throwsStreamFetch() async {
        URLProtocolMock.matchers = [{ _ in .init(status: 503) }]
        do {
            _ = try await SecureStreamLoader.fetchRange(
                start: 0, end: 0,
                session: session, jwt: "tok",
                streamWorkerURL: workerURL,
                urlSession: URLProtocolMock.session(),
                refreshJWT: { "tok" }
            )
            XCTFail()
        } catch PlaybackError.streamFetch {
            // ok
        } catch {
            XCTFail("wrong error: \(error)")
        }
    }

    func test_fetchRange_setsRangeAndAuthHeaders() async throws {
        URLProtocolMock.matchers = [{ _ in .init(status: 206, headers: ["X-Counter-Start": "0", "X-Skip-Bytes": "0"], body: Data()) }]
        _ = try await SecureStreamLoader.fetchRange(
            start: 100, end: 199,
            session: session, jwt: "TOK",
            streamWorkerURL: workerURL,
            urlSession: URLProtocolMock.session(),
            refreshJWT: { "TOK" }
        )
        let req = URLProtocolMock.recorded.first!
        XCTAssertEqual(req.value(forHTTPHeaderField: "Range"), "bytes=100-199")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer TOK")
    }
}

/// Sendable counter for tracking calls across @Sendable closures in tests.
final class CallCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var _value = 0
    var value: Int { lock.lock(); defer { lock.unlock() }; return _value }
    func increment() -> Int { lock.lock(); defer { lock.unlock() }; _value += 1; return _value }
}

final class RefreshFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var _value = false
    var value: Bool { lock.lock(); defer { lock.unlock() }; return _value }
    func set() { lock.lock(); _value = true; lock.unlock() }
}
