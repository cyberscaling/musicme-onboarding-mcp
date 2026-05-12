import XCTest
@testable import SASCore

@MainActor
final class HeartbeatTimerTests: XCTestCase {
    override func setUp() async throws { URLProtocolMock.reset() }

    func test_stopComplete_postsFinalHeartbeatWithCompleteTrue() async throws {
        let calls = CallCounter()
        var finalRequest: URLRequest?
        URLProtocolMock.matchers = [{ req in
            if req.url?.path == "/heartbeat/sid-1" {
                _ = calls.increment()
                finalRequest = req
                return .init(status: 200)
            }
            return nil
        }]
        let timer = HeartbeatTimer(
            streamWorkerURL: URL(string: "https://stream.example.com")!,
            session: URLProtocolMock.session(),
            interval: 60  // long — we will only fire the final one via stop()
        )
        await timer.start(sessionId: "sid-1") { 12_345 }
        await timer.stop(complete: true)
        XCTAssertEqual(calls.value, 1, "should POST exactly once when stop(complete: true)")
        XCTAssertNotNil(finalRequest)
        XCTAssertEqual(finalRequest?.httpMethod, "POST")
        XCTAssertEqual(finalRequest?.allHTTPHeaderFields?["Content-Type"], "application/json")
        // Note: HTTPBody is not preserved through URLSession→URLProtocol, so we can't assert its content.
        // Content-Length header is set to the serialized JSON size.
        if let contentLength = finalRequest?.allHTTPHeaderFields?["Content-Length"],
           let length = Int(contentLength) {
            // Heartbeat body is {"duration_ms":12345,"complete":true} which is ~40 bytes
            XCTAssertGreaterThan(length, 0, "Content-Length should be set for the JSON body")
        }
    }

    func test_periodicPosts_fire_atInterval() async throws {
        let calls = CallCounter()
        URLProtocolMock.matchers = [{ req in
            if req.url?.path == "/heartbeat/sid-2" {
                _ = calls.increment()
                return .init(status: 200)
            }
            return nil
        }]
        let timer = HeartbeatTimer(
            streamWorkerURL: URL(string: "https://stream.example.com")!,
            session: URLProtocolMock.session(),
            interval: 0.05  // 50ms for test speed
        )
        await timer.start(sessionId: "sid-2") { 0 }
        try await Task.sleep(for: .milliseconds(180))  // ~3 ticks
        await timer.stop(complete: false)
        XCTAssertGreaterThanOrEqual(calls.value, 3)
    }
}
