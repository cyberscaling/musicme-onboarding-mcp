import XCTest
@testable import SASCore

// Test helper for mutable clock without Sendable capture issues
private final class Clock: @unchecked Sendable {
    var current: Date
    init(initial: Date) { self.current = initial }
    func now() -> Date { current }
    func advance(by interval: TimeInterval) { current = current.addingTimeInterval(interval) }
}

@MainActor
final class JWTClientTests: XCTestCase {
    override func setUp() async throws { URLProtocolMock.reset() }

    func test_mint_returnsToken_on200() async throws {
        let body = try JSONEncoder().encode(JWTResponse(token: "abc.def.ghi"))
        URLProtocolMock.matchers = [{ req in
            req.url?.path == "/api/jwt" ? URLProtocolMock.Stub(status: 200, body: body) : nil
        }]
        let session = URLProtocolMock.session()
        let client = JWTClient(baseURL: URL(string: "https://w.example.com")!, session: session, now: { Date(timeIntervalSince1970: 0) })

        let token = try await client.mint()
        XCTAssertEqual(token, "abc.def.ghi")
    }

    func test_mint_caches_within4Minutes() async throws {
        let body = try JSONEncoder().encode(JWTResponse(token: "t1"))
        URLProtocolMock.matchers = [{ req in
            req.url?.path == "/api/jwt" ? URLProtocolMock.Stub(status: 200, body: body) : nil
        }]
        let clock = Clock(initial: Date(timeIntervalSince1970: 0))
        let client = JWTClient(baseURL: URL(string: "https://w.example.com")!, session: URLProtocolMock.session(), now: { clock.now() })

        _ = try await client.mint()
        clock.advance(by: 60 * 3)  // 3 min later
        _ = try await client.mint()

        let calls = URLProtocolMock.recorded.filter { $0.url?.path == "/api/jwt" }.count
        XCTAssertEqual(calls, 1, "second mint within 4 min must hit cache")
    }

    func test_mint_refreshes_after4Minutes() async throws {
        let body = try JSONEncoder().encode(JWTResponse(token: "t1"))
        URLProtocolMock.matchers = [{ req in
            req.url?.path == "/api/jwt" ? URLProtocolMock.Stub(status: 200, body: body) : nil
        }]
        let clock = Clock(initial: Date(timeIntervalSince1970: 0))
        let client = JWTClient(baseURL: URL(string: "https://w.example.com")!, session: URLProtocolMock.session(), now: { clock.now() })

        _ = try await client.mint()
        clock.advance(by: 60 * 5)  // 5 min later — past TTL
        _ = try await client.mint()

        let calls = URLProtocolMock.recorded.filter { $0.url?.path == "/api/jwt" }.count
        XCTAssertEqual(calls, 2)
    }

    func test_mint_throwsUnauthorized_on401() async throws {
        URLProtocolMock.matchers = [{ req in
            req.url?.path == "/api/jwt" ? URLProtocolMock.Stub(status: 401) : nil
        }]
        let client = JWTClient(baseURL: URL(string: "https://w.example.com")!, session: URLProtocolMock.session(), now: { Date() })
        do {
            _ = try await client.mint()
            XCTFail("expected throw")
        } catch let error as APIError {
            XCTAssertEqual(error, .unauthorized)
        }
    }
}
