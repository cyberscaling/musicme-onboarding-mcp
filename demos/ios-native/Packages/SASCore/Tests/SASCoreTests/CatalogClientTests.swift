import XCTest
@testable import SASCore

@MainActor
final class CatalogClientTests: XCTestCase {
    override func setUp() async throws {
        URLProtocolMock.reset()
    }

    func test_home_decodesTopNewsStyles() async throws {
        // Worker has separate routes: /albums/top, /albums/news, /styles.
        // CatalogClient fans out 3 parallel GETs and stitches a HomeDTO.
        // Server returns Sonar raw shapes (album/cb/artists for albums, id/name for styles).
        let topBody = #"[{"cb":"1","album":"T","artists":[{"id":42,"name":"A"}]}]"#.data(using: .utf8)!
        let newsBody = "[]".data(using: .utf8)!
        let stylesBody = #"[{"id":1,"name":"Rock"}]"#.data(using: .utf8)!
        URLProtocolMock.matchers = [{ req in
            switch req.url?.path {
            case "/api/catalog/albums/top": return .init(status: 200, body: topBody)
            case "/api/catalog/albums/news": return .init(status: 200, body: newsBody)
            case "/api/catalog/styles": return .init(status: 200, body: stylesBody)
            default: return nil
            }
        }]
        let c = CatalogClient(baseURL: URL(string: "https://w.example.com")!, session: URLProtocolMock.session())
        let home = try await c.home()
        XCTAssertEqual(home.top.count, 1)
        XCTAssertEqual(home.top.first?.title, "T")
        XCTAssertEqual(home.top.first?.artist, "A")
        XCTAssertEqual(home.styles.first?.name, "Rock")
        XCTAssertEqual(home.styles.first?.id, 1)
    }

    func test_album_unwraps_andCombinesWithTracks() async throws {
        // /api/catalog/albums/:cb returns wrapped { album: {...}, artists: [...] }
        // /api/catalog/albums/:cb/tracks returns flat array of raw tracks.
        let detailBody = #"""
        {"album":{"id":5026854427355,"title":"Fete","artists":[{"id":29044,"name":"Maé"}]}}
        """#.data(using: .utf8)!
        let tracksBody = #"""
        [{"id":"5026854427355_1_1","disc_number":1,"track_number":1,"title":"Song1","timing":200}]
        """#.data(using: .utf8)!
        URLProtocolMock.matchers = [{ req in
            switch req.url?.path {
            case "/api/catalog/albums/5026854427355": return .init(status: 200, body: detailBody)
            case "/api/catalog/albums/5026854427355/tracks": return .init(status: 200, body: tracksBody)
            default: return nil
            }
        }]
        let c = CatalogClient(baseURL: URL(string: "https://w.example.com")!, session: URLProtocolMock.session())
        let album = try await c.album(cb: "5026854427355")
        XCTAssertEqual(album.title, "Fete")
        XCTAssertEqual(album.artist, "Maé")
        XCTAssertEqual(album.tracks?.count, 1)
        XCTAssertEqual(album.tracks?.first?.title, "Song1")
        XCTAssertEqual(album.tracks?.first?.durationMs, 200_000)  // server timing in seconds → ms
    }

    func test_anyCatalog401_throwsUnauthorized() async {
        URLProtocolMock.matchers = [{ _ in .init(status: 401) }]
        let c = CatalogClient(baseURL: URL(string: "https://w.example.com")!, session: URLProtocolMock.session())
        do {
            _ = try await c.home()
            XCTFail()
        } catch let e as APIError {
            XCTAssertEqual(e, .unauthorized)
        } catch {
            XCTFail("wrong error: \(error)")
        }
    }
}
