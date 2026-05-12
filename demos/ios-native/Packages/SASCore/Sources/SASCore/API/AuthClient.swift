import Foundation

public actor AuthClient {
    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func login(username: String, password: String) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/auth/login"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["username": username, "password": password])
        let (data, resp) = try await sessionData(req)
        let http = resp as! HTTPURLResponse
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: http.statusCode, body: data)
        }
    }

    public func logout() async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/auth/logout"))
        req.httpMethod = "POST"
        _ = try await sessionData(req)
        // Best effort: regardless of status, the local cookie jar will be flushed
        // by the caller (logoutFlow in PlayerStore).
    }

    public func probe() async throws -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/me"))
        req.httpMethod = "GET"
        do {
            let (_, resp) = try await sessionData(req)
            return (resp as! HTTPURLResponse).statusCode == 200
        } catch APIError.network {
            return false  // fail closed at boot
        }
    }

    private func sessionData(_ req: URLRequest) async throws -> (Data, URLResponse) {
        do { return try await session.data(for: req) }
        catch { throw APIError.network(error) }
    }
}
