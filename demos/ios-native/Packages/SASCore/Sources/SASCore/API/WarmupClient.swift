import Foundation

public actor WarmupClient {
    private let streamWorkerURL: URL
    private let session: URLSession
    private let jwt: JWTClient

    public init(streamWorkerURL: URL, session: URLSession = .shared, jwt: JWTClient) {
        self.streamWorkerURL = streamWorkerURL
        self.session = session
        self.jwt = jwt
    }

    public func warmupAlbum(cb: String) async {
        do {
            let token = try await jwt.mint()
            var req = URLRequest(url: streamWorkerURL.appendingPathComponent("warmup-album"))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            req.httpBody = try JSONSerialization.data(withJSONObject: ["cb": cb])
            _ = try? await session.data(for: req)  // fire-and-forget
        } catch {
            // silent — warmup failure means cold cache, not user-facing
        }
    }
}
