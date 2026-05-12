import Foundation

public actor JWTClient {
    private let baseURL: URL
    private let session: URLSession
    private let now: @Sendable () -> Date
    private let ttl: TimeInterval = 60 * 4   // 4 min cache (worker TTL = 5)

    private var cachedToken: String?
    private var cachedAt: Date?

    public init(baseURL: URL, session: URLSession = .shared, now: @escaping @Sendable () -> Date = Date.init) {
        self.baseURL = baseURL
        self.session = session
        self.now = now
    }

    public func mint() async throws -> String {
        if let token = cachedToken, let at = cachedAt, now().timeIntervalSince(at) < ttl {
            return token
        }
        var req = URLRequest(url: baseURL.appendingPathComponent("api/jwt"))
        req.httpMethod = "POST"
        let (data, resp) = try await dataOrNetworkError(for: req)
        let http = resp as! HTTPURLResponse
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: http.statusCode, body: data)
        }
        do {
            let parsed = try JSONDecoder().decode(JWTResponse.self, from: data)
            cachedToken = parsed.token
            cachedAt = now()
            return parsed.token
        } catch {
            throw APIError.decode(error)
        }
    }

    public func invalidate() {
        cachedToken = nil
        cachedAt = nil
    }

    private func dataOrNetworkError(for req: URLRequest) async throws -> (Data, URLResponse) {
        do { return try await session.data(for: req) }
        catch { throw APIError.network(error) }
    }
}
