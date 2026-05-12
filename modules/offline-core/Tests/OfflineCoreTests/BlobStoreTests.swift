import XCTest
@testable import OfflineCore

final class BlobStoreTests: XCTestCase {
    var rootURL: URL!

    override func setUp() {
        super.setUp()
        rootURL = FileManager.default.temporaryDirectory.appendingPathComponent("blobs-\(UUID().uuidString)")
    }
    override func tearDown() {
        try? FileManager.default.removeItem(at: rootURL)
        super.tearDown()
    }

    func testPersistAndPread() throws {
        let store = try BlobStore(rootDirectory: rootURL)
        let content = Data((0..<512).map { UInt8($0 & 0xFF) })
        let path = try store.persist(trackId: "100:0:5", from: writeTempFile(content))
        XCTAssertTrue(FileManager.default.fileExists(atPath: path))

        let slice = try store.pread(path: path, offset: 16, length: 32)
        XCTAssertEqual(slice, content.subdata(in: 16..<48))
    }

    func testDelete() throws {
        let store = try BlobStore(rootDirectory: rootURL)
        let path = try store.persist(trackId: "x", from: writeTempFile(Data([1, 2, 3])))
        try store.delete(trackId: "x")
        XCTAssertFalse(FileManager.default.fileExists(atPath: path))
    }

    func testWipeAll() throws {
        let store = try BlobStore(rootDirectory: rootURL)
        _ = try store.persist(trackId: "a", from: writeTempFile(Data([1])))
        _ = try store.persist(trackId: "b", from: writeTempFile(Data([2])))
        try store.wipeAll()
        let contents = (try? FileManager.default.contentsOfDirectory(at: rootURL, includingPropertiesForKeys: nil)) ?? []
        XCTAssertEqual(contents.count, 0)
    }

    private func writeTempFile(_ data: Data) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try data.write(to: url)
        return url
    }
}
