import Foundation

public actor CatalogClient {
    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func home() async throws -> HomeDTO {
        async let top: [AlbumDTO] = get("api/catalog/albums/top")
        async let news: [AlbumDTO] = get("api/catalog/albums/news")
        async let styles: [StyleRefDTO] = get("api/catalog/styles")
        return try await HomeDTO(top: top, news: news, styles: styles)
    }

    public func album(cb: String) async throws -> AlbumDTO {
        async let detail: AlbumDetailWrapper = get("api/catalog/albums/\(cb)")
        async let tracks: [AlbumTrackDTO] = get("api/catalog/albums/\(cb)/tracks")
        let d = try await detail
        var sorted = try await tracks
        sorted.sort { ($0.disc, $0.track) < ($1.disc, $1.track) }
        return AlbumDTO(
            cb: d.cb,
            title: d.title,
            artist: d.artist,
            coverURL: d.coverURL ?? Covers.url(cb: d.cb),
            tracks: sorted,
            artistId: d.artistId
        )
    }

    public func albumTracks(cb: String) async throws -> [AlbumTrackDTO] {
        var t: [AlbumTrackDTO] = try await get("api/catalog/albums/\(cb)/tracks")
        t.sort { ($0.disc, $0.track) < ($1.disc, $1.track) }
        return t
    }

    public func artist(id: Int) async throws -> ArtistDTO {
        async let base: ArtistBaseDTO = get("api/catalog/artists/\(id)")
        async let albumsResp: [AlbumDTO] = get("api/catalog/artists/\(id)/albums?limit=24")
        async let tracksWrap: ArtistTracksWrapper = get("api/catalog/artists/\(id)/tracks?limit=20")
        async let similar: [ArtistRefDTO] = get("api/catalog/artists/\(id)/similar?limit=12")
        let b = try await base
        let tracks = (try? await tracksWrap.tracks) ?? []
        let albums = (try? await albumsResp) ?? []
        let sim = (try? await similar) ?? []
        return ArtistDTO(id: b.id, name: b.name, bio: nil, albums: albums, topTracks: tracks, similar: sim)
    }

    public func style(id: Int) async throws -> StyleFeedDTO {
        let albums: [AlbumDTO] = try await get("api/catalog/albums/top?style_id=\(id)&limit=48")
        return StyleFeedDTO(id: id, name: "", albums: albums)
    }

    public func searchGlobal(query: String) async throws -> SearchResultsDTO {
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/catalog/search/global"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [.init(name: "q", value: query)]
        return try await get(url: comps.url!)
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await get(url: baseURL.appendingPathComponent(path))
    }

    private func get<T: Decodable>(url: URL) async throws -> T {
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        let (data, resp): (Data, URLResponse)
        do { (data, resp) = try await session.data(for: req) }
        catch { throw APIError.network(error) }
        let http = resp as! HTTPURLResponse
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: http.statusCode, body: data)
        }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.decode(error) }
    }
}

// MARK: - Internal response wrappers (worker passes through Sonar shapes)

/// Server returns `{ album: {...}, artists: [...] }` for /api/catalog/albums/:cb.
/// We unwrap into a flat AlbumDTO via this intermediate.
struct AlbumDetailWrapper: Decodable {
    let cb: String
    let title: String
    let artist: String
    let artistId: Int?
    let coverURL: URL?

    private enum TopKeys: String, CodingKey { case album, artists }
    private struct InnerAlbum: Decodable {
        let id: AnyScalar?
        let cb: AnyScalar?
        let title: String?
        let album: String?
        let coverURL: URL?
        let artists: [InnerArtist]?
        private enum CodingKeys: String, CodingKey {
            case id, cb, title, album, coverURL, cover_url, artists
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.id = try c.decodeIfPresent(AnyScalar.self, forKey: .id)
            self.cb = try c.decodeIfPresent(AnyScalar.self, forKey: .cb)
            self.title = try c.decodeIfPresent(String.self, forKey: .title)
            self.album = try c.decodeIfPresent(String.self, forKey: .album)
            self.coverURL = (try? c.decode(URL.self, forKey: .cover_url))
                ?? (try? c.decode(URL.self, forKey: .coverURL))
            self.artists = try c.decodeIfPresent([InnerArtist].self, forKey: .artists)
        }
    }
    private struct InnerArtist: Decodable { let id: Int?; let name: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: TopKeys.self)
        let inner = try c.decode(InnerAlbum.self, forKey: .album)
        let topArtists = (try? c.decode([InnerArtist].self, forKey: .artists)) ?? []
        let cbStr = inner.cb?.stringValue ?? inner.id?.stringValue ?? ""
        self.cb = cbStr
        self.title = inner.title ?? inner.album ?? ""
        let resolvedArtists = inner.artists ?? topArtists
        self.artist = resolvedArtists.first?.name ?? ""
        self.artistId = resolvedArtists.first?.id
        self.coverURL = inner.coverURL
    }
}

/// Server returns `{ artist: {...}, tracks: [...] }` for /api/catalog/artists/:id/tracks.
struct ArtistTracksWrapper: Decodable {
    let tracks: [AlbumTrackDTO]
}

/// /api/catalog/artists/:id base — only id + name guaranteed; biography lives elsewhere if at all.
struct ArtistBaseDTO: Decodable {
    let id: Int
    let name: String

    private enum CodingKeys: String, CodingKey { case id, name }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let n = try? c.decode(Int.self, forKey: .id) {
            self.id = n
        } else if let s = try? c.decode(String.self, forKey: .id), let n = Int(s) {
            self.id = n
        } else {
            self.id = 0
        }
        self.name = (try? c.decode(String.self, forKey: .name)) ?? ""
    }
}

/// Tolerates Int or String scalars at JSON boundaries (e.g. `cb` is sometimes number, sometimes string).
struct AnyScalar: Decodable {
    let stringValue: String
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) {
            self.stringValue = s
        } else if let n = try? c.decode(Int.self) {
            self.stringValue = String(n)
        } else if let d = try? c.decode(Double.self) {
            self.stringValue = String(Int(d))
        } else {
            self.stringValue = ""
        }
    }
}
