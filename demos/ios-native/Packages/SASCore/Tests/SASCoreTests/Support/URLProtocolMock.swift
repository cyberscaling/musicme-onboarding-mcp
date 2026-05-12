import Foundation

@MainActor
final class URLProtocolMock: URLProtocol {
    struct Stub {
        let status: Int
        let headers: [String: String]
        let body: Data
        let delay: TimeInterval

        init(status: Int = 200, headers: [String: String] = [:], body: Data = Data(), delay: TimeInterval = 0) {
            self.status = status
            self.headers = headers
            self.body = body
            self.delay = delay
        }
    }

    /// Matchers: predicate over the URLRequest → optional stub. First match wins.
    static var matchers: [(URLRequest) -> Stub?] = []
    /// All intercepted requests (in arrival order) for assertions.
    static private(set) var recorded: [URLRequest] = []

    static func reset() {
        matchers = []
        recorded = []
    }

    static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolMock.self]
        // Delegate rejects auth challenges so URLSession delivers raw 4xx responses
        // instead of silently retrying via its credential-storage mechanism.
        return URLSession(configuration: config, delegate: MockSessionDelegate(), delegateQueue: nil)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        URLProtocolMock.recorded.append(request)
        // Use an explicit loop instead of lazy.compactMap.first to avoid the
        // Swift 6 bug where accessing @MainActor matchers from a nonisolated
        // context causes lazy evaluation to call the closure multiple times.
        var stub: Stub?
        for m in URLProtocolMock.matchers {
            if let s = m(self.request) { stub = s; break }
        }
        guard let stub else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
            return
        }
        let delay = max(0, stub.delay)
        // Use global queue for zero-delay delivery to avoid a Swift 6 Sendable
        // error when capturing @MainActor-isolated self in a DispatchQueue.main closure.
        let queue: DispatchQueue = delay > 0 ? .main : .global(qos: .userInitiated)
        queue.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self else { return }
            let resp = HTTPURLResponse(
                url: self.request.url!,
                statusCode: stub.status,
                httpVersion: "HTTP/1.1",
                headerFields: stub.headers
            )!
            self.client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: stub.body)
            self.client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() { /* noop */ }
}

/// Session-level delegate that cancels authentication challenges, ensuring
/// URLSession delivers raw 401/407 responses rather than retrying with credentials.
private final class MockSessionDelegate: NSObject, URLSessionDelegate {
    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        completionHandler(.cancelAuthenticationChallenge, nil)
    }
}
