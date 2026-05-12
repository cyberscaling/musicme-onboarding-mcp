import XCTest
@testable import SASCore

@MainActor
final class AuthClientTests: XCTestCase {
    override func setUp() async throws { URLProtocolMock.reset() }

    func test_login_postsCredentials_returns200() async throws {
        URLProtocolMock.matchers = [{ req in
            req.url?.path == "/api/auth/login" ? URLProtocolMock.Stub(status: 200) : nil
        }]
        let client = AuthClient(baseURL: URL(string: "https://w.example.com")!, session: URLProtocolMock.session())
        try await client.login(username: "alice", password: "wonderland")

        let loginReq = URLProtocolMock.recorded.first { $0.url?.path == "/api/auth/login" }
        XCTAssertNotNil(loginReq)
        XCTAssertEqual(loginReq?.httpMethod, "POST")
        XCTAssertEqual(loginReq?.value(forHTTPHeaderField: "Content-Type"), "application/json")
    }

    func test_login_401_throwsUnauthorized() async {
        URLProtocolMock.matchers = [{ req in
            req.url?.path == "/api/auth/login" ? URLProtocolMock.Stub(status: 401) : nil
        }]
        let client = AuthClient(baseURL: URL(string: "https://w.example.com")!, session: URLProtocolMock.session())
        do {
            try await client.login(username: "x", password: "y")
            XCTFail()
        } catch let e as APIError {
            XCTAssertEqual(e, .unauthorized)
        } catch {
            XCTFail("wrong error: \(error)")
        }
    }

    func test_probe_returnsTrueOn200() async throws {
        let body = try JSONEncoder().encode(MeDTO(username: "alice"))
        URLProtocolMock.matchers = [{ req in
            req.url?.path == "/api/me" ? URLProtocolMock.Stub(status: 200, body: body) : nil
        }]
        let client = AuthClient(baseURL: URL(string: "https://w.example.com")!, session: URLProtocolMock.session())
        let ok = try await client.probe()
        XCTAssertTrue(ok)
    }

    func test_probe_returnsFalseOn401() async throws {
        URLProtocolMock.matchers = [{ req in
            req.url?.path == "/api/me" ? URLProtocolMock.Stub(status: 401) : nil
        }]
        let client = AuthClient(baseURL: URL(string: "https://w.example.com")!, session: URLProtocolMock.session())
        let ok = try await client.probe()
        XCTAssertFalse(ok)
    }

    func test_logout_hits_logoutEndpoint() async throws {
        URLProtocolMock.matchers = [{ req in
            req.url?.path == "/api/auth/logout" ? URLProtocolMock.Stub(status: 200) : nil
        }]
        let client = AuthClient(baseURL: URL(string: "https://w.example.com")!, session: URLProtocolMock.session())
        try await client.logout()
        let hit = URLProtocolMock.recorded.contains { $0.url?.path == "/api/auth/logout" }
        XCTAssertTrue(hit)
    }
}