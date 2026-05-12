import Foundation

public struct APIBundle: Sendable {
    public let auth: AuthClient
    public let catalog: CatalogClient
    public let jwt: JWTClient
    public let config: ConfigClient
    public let session: URLSession

    public init(webappBaseURL: URL, session: URLSession = .shared) {
        self.auth = AuthClient(baseURL: webappBaseURL, session: session)
        self.catalog = CatalogClient(baseURL: webappBaseURL, session: session)
        self.jwt = JWTClient(baseURL: webappBaseURL, session: session)
        self.config = ConfigClient(baseURL: webappBaseURL, session: session)
        self.session = session
    }

    public func makeWarmupClient(streamWorkerURL: URL) -> WarmupClient {
        WarmupClient(streamWorkerURL: streamWorkerURL, session: session, jwt: jwt)
    }
}
