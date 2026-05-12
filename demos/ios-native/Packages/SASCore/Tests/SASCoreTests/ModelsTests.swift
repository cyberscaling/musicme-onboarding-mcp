import XCTest
@testable import SASCore

final class ModelsTests: XCTestCase {
    func test_queueItemHasStableId() {
        let ref = TrackRef(cb: "5400863209100", disc: 1, track: 3)
        let meta = TrackMeta(title: "Song", artist: "Artist", coverURL: nil, durationMs: 200_000)
        let a = QueueItem(ref: ref, meta: meta)
        let b = QueueItem(ref: ref, meta: meta)
        XCTAssertNotEqual(a.id, b.id, "each enqueue must produce a unique stable id")
    }

    func test_queueItemEncodesAndDecodes() throws {
        let item = QueueItem(
            ref: TrackRef(cb: "5400863209100", disc: 1, track: 3),
            meta: TrackMeta(title: "Song", artist: "Artist", coverURL: nil, durationMs: 200_000)
        )
        let data = try JSONEncoder().encode(item)
        let decoded = try JSONDecoder().decode(QueueItem.self, from: data)
        XCTAssertEqual(decoded.id, item.id)
        XCTAssertEqual(decoded.ref.cb, "5400863209100")
        XCTAssertEqual(decoded.meta.title, "Song")
    }
}
