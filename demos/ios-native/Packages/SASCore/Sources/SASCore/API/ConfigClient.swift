import Foundation

public actor ConfigClient {
    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func streamWorkerURL() async throws -> URL {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/config"))
        req.httpMethod = "GET"
        let (data, resp): (Data, URLResponse)
        do { (data, resp) = try await session.data(for: req) }
        catch { throw APIError.network(error) }
        let http = resp as! HTTPURLResponse
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: http.statusCode, body: data)
        }
        do {
            let cfg = try JSONDecoder().decode(ConfigDTO.self, from: data)
            guard let url = URL(string: cfg.streamWorkerUrl) else {
                throw APIError.decode(NSError(domain: "config", code: 0, userInfo: [NSLocalizedDescriptionKey: "invalid streamWorkerUrl"]))
            }
            return url
        } catch let e as APIError { throw e }
        catch { throw APIError.decode(error) }
    }
}
