import Foundation

public final class BlobStore {
    public let rootDirectory: URL

    public init(rootDirectory: URL) throws {
        self.rootDirectory = rootDirectory
        try FileManager.default.createDirectory(at: rootDirectory, withIntermediateDirectories: true)
    }

    public func blobPath(for trackId: String) -> String {
        let safe = trackId.replacingOccurrences(of: "/", with: "_")
        return rootDirectory.appendingPathComponent("\(safe).bin").path
    }

    /// Move `tmpURL` into the blob directory under `<trackId>.bin`.
    @discardableResult
    public func persist(trackId: String, from tmpURL: URL) throws -> String {
        let dest = blobPath(for: trackId)
        let destURL = URL(fileURLWithPath: dest)
        try? FileManager.default.removeItem(at: destURL)
        try FileManager.default.moveItem(at: tmpURL, to: destURL)
        return dest
    }

    public func delete(trackId: String) throws {
        let path = blobPath(for: trackId)
        try? FileManager.default.removeItem(atPath: path)
    }

    public func wipeAll() throws {
        let fm = FileManager.default
        let entries = try fm.contentsOfDirectory(at: rootDirectory, includingPropertiesForKeys: nil)
        for entry in entries {
            try fm.removeItem(at: entry)
        }
    }

    /// Read `length` bytes starting at byte `offset` from the blob file. Uses Darwin `pread(2)`
    /// for thread-safe positional read without modifying the file descriptor offset.
    public func pread(path: String, offset: Int64, length: Int) throws -> Data {
        let fd = open(path, O_RDONLY)
        guard fd >= 0 else { throw OfflineError.ioError("open failed: \(String(cString: strerror(errno)))") }
        defer { close(fd) }

        var buf = Data(count: length)
        let n = buf.withUnsafeMutableBytes { ptr -> Int in
            return Darwin.pread(fd, ptr.baseAddress, length, off_t(offset))
        }
        if n < 0 {
            throw OfflineError.ioError("pread failed: \(String(cString: strerror(errno)))")
        }
        if n < length {
            return buf.prefix(n)
        }
        return buf
    }
}
