import Foundation

public protocol ByteSource: AnyObject {
    var fileSize: Int64 { get }
    var contentType: String { get }
    func read(range: Range<Int64>) async throws -> Data
    func close()
}
