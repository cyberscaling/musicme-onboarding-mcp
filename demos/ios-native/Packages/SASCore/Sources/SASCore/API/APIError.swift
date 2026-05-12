import Foundation

public enum APIError: Error, Equatable {
    case http(status: Int, body: Data?)
    case decode(Error)
    case network(Error)
    case unauthorized   // 401 specifically — surfaced for auth flow routing

    public static func == (lhs: APIError, rhs: APIError) -> Bool {
        switch (lhs, rhs) {
        case (.unauthorized, .unauthorized): return true
        case (.http(let a, _), .http(let b, _)): return a == b
        case (.decode, .decode), (.network, .network): return true
        default: return false
        }
    }
}
