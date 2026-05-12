import Foundation

// MARK: - /api/me

public struct MeDTO: Codable, Sendable {
    public let username: String
}

// MARK: - /api/config

public struct ConfigDTO: Sendable, Decodable {
    public let streamWorkerUrl: String

    enum CodingKeys: String, CodingKey {
        case streamWorkerUrl
        case stream_worker_url
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let s = try? c.decode(String.self, forKey: .streamWorkerUrl) {
            self.streamWorkerUrl = s
        } else {
            self.streamWorkerUrl = try c.decode(String.self, forKey: .stream_worker_url)
        }
    }
}

// MARK: - /api/jwt

public struct JWTResponse: Codable, Sendable {
    public let token: String
}

// MARK: - Covers

public enum Covers {
    public static func url(cb: String, size: Int = 250) -> URL? {
        let padded = cb.count >= 13 ? cb : String(repeating: "0", count: 13 - cb.count) + cb
        return URL(string: "https://covers-ng4.hosting-media.net/jpgr\(size)/u\(padded).jpg")
    }
}

// MARK: - Album DTO (raw shape: { cb, album, artists?, ... } from Sonar passthrough)

public struct AlbumDTO: Sendable, Decodable, Hashable {
    public let cb: String
    public let title: String
    public let artist: String
    public let coverURL: URL?
    public let tracks: [AlbumTrackDTO]?
    public let artistId: Int?

    private enum CodingKeys: String, CodingKey {
        case cb, id
        case title, album, name
        case artist, artist_name, artists
        case cover_url, coverURL
        case tracks
    }

    private struct ArtistRef: Decodable { let id: Int?; let name: String }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let rawCb: String?
        if let s = try? c.decode(String.self, forKey: .cb) { rawCb = s }
        else if let n = try? c.decode(Int.self, forKey: .cb) { rawCb = String(n) }
        else if let s = try? c.decode(String.self, forKey: .id) { rawCb = s }
        else if let n = try? c.decode(Int.self, forKey: .id) { rawCb = String(n) }
        else { rawCb = nil }
        self.cb = rawCb ?? ""

        if let t = try? c.decode(String.self, forKey: .title) {
            self.title = t
        } else if let t = try? c.decode(String.self, forKey: .album) {
            self.title = t
        } else if let t = try? c.decode(String.self, forKey: .name) {
            self.title = t
        } else {
            self.title = ""
        }

        let artists = try? c.decode([ArtistRef].self, forKey: .artists)
        if let a = try? c.decode(String.self, forKey: .artist_name) {
            self.artist = a
        } else if let a = try? c.decode(String.self, forKey: .artist) {
            self.artist = a
        } else if let a = artists?.first?.name {
            self.artist = a
        } else {
            self.artist = ""
        }
        self.artistId = artists?.first?.id

        if let u = try? c.decode(URL.self, forKey: .cover_url) {
            self.coverURL = u
        } else if let u = try? c.decode(URL.self, forKey: .coverURL) {
            self.coverURL = u
        } else if !self.cb.isEmpty {
            self.coverURL = Covers.url(cb: self.cb)
        } else {
            self.coverURL = nil
        }

        self.tracks = try? c.decode([AlbumTrackDTO].self, forKey: .tracks)
    }

    /// Convenience constructor used by tests + adapters.
    public init(cb: String, title: String, artist: String, coverURL: URL?, tracks: [AlbumTrackDTO]?, artistId: Int? = nil) {
        self.cb = cb
        self.title = title
        self.artist = artist
        self.coverURL = coverURL
        self.tracks = tracks
        self.artistId = artistId
    }
}

// MARK: - Album track DTO

public struct AlbumTrackDTO: Sendable, Decodable, Hashable {
    public let disc: Int
    public let track: Int
    public let title: String
    public let artist: String
    public let durationMs: Int?
    public let mid: String?
    public let cb: String?

    private enum CodingKeys: String, CodingKey {
        case disc, track
        case num_disc, num_track, disc_number, track_number
        case title
        case artist, artist_name
        case timing, duration_ms, durationMs
        case mid, id, cb
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.disc = (try? c.decode(Int.self, forKey: .disc))
            ?? (try? c.decode(Int.self, forKey: .num_disc))
            ?? (try? c.decode(Int.self, forKey: .disc_number))
            ?? 0
        self.track = (try? c.decode(Int.self, forKey: .track))
            ?? (try? c.decode(Int.self, forKey: .num_track))
            ?? (try? c.decode(Int.self, forKey: .track_number))
            ?? 0
        self.title = (try? c.decode(String.self, forKey: .title)) ?? ""
        self.artist = (try? c.decode(String.self, forKey: .artist_name))
            ?? (try? c.decode(String.self, forKey: .artist))
            ?? ""
        if let ms = try? c.decode(Int.self, forKey: .duration_ms) {
            self.durationMs = ms
        } else if let ms = try? c.decode(Int.self, forKey: .durationMs) {
            self.durationMs = ms
        } else if let s = try? c.decode(Int.self, forKey: .timing) {
            self.durationMs = s * 1000
        } else {
            self.durationMs = nil
        }
        if let m = try? c.decode(String.self, forKey: .mid) {
            self.mid = m
        } else if let m = try? c.decode(String.self, forKey: .id) {
            self.mid = m
        } else {
            self.mid = nil
        }
        if let s = try? c.decode(String.self, forKey: .cb) {
            self.cb = s
        } else if let n = try? c.decode(Int.self, forKey: .cb) {
            self.cb = String(n)
        } else {
            self.cb = nil
        }
    }

    public init(disc: Int, track: Int, title: String, artist: String, durationMs: Int?, mid: String?, cb: String? = nil) {
        self.disc = disc
        self.track = track
        self.title = title
        self.artist = artist
        self.durationMs = durationMs
        self.mid = mid
        self.cb = cb
    }
}

// MARK: - Artist DTO

public struct ArtistDTO: Sendable, Hashable {
    public let id: Int
    public let name: String
    public let bio: String?
    public let albums: [AlbumDTO]?
    public let topTracks: [AlbumTrackDTO]?
    public let similar: [ArtistRefDTO]?

    public init(id: Int, name: String, bio: String?, albums: [AlbumDTO]?, topTracks: [AlbumTrackDTO]?, similar: [ArtistRefDTO]?) {
        self.id = id; self.name = name; self.bio = bio
        self.albums = albums; self.topTracks = topTracks; self.similar = similar
    }
}

public struct ArtistRefDTO: Sendable, Decodable, Hashable {
    public let id: Int
    public let name: String

    private enum CodingKeys: String, CodingKey { case id, name }
    public init(from decoder: Decoder) throws {
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

    public init(id: Int, name: String) { self.id = id; self.name = name }
}

// MARK: - Home aggregate

public struct HomeDTO: Sendable {
    public let top: [AlbumDTO]
    public let news: [AlbumDTO]
    public let styles: [StyleRefDTO]
    public init(top: [AlbumDTO], news: [AlbumDTO], styles: [StyleRefDTO]) {
        self.top = top; self.news = news; self.styles = styles
    }
}

// MARK: - Style

public struct StyleRefDTO: Sendable, Decodable, Hashable {
    public let id: Int
    public let name: String

    private enum CodingKeys: String, CodingKey { case id, name }
    public init(from decoder: Decoder) throws {
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

    public init(id: Int, name: String) { self.id = id; self.name = name }
}

public struct StyleFeedDTO: Sendable {
    public let id: Int
    public let name: String
    public let albums: [AlbumDTO]
    public init(id: Int, name: String, albums: [AlbumDTO]) {
        self.id = id; self.name = name; self.albums = albums
    }
}

// MARK: - Search

public struct SearchResultsDTO: Sendable, Decodable {
    public let albums: [AlbumDTO]
    public let artists: [ArtistRefDTO]

    private enum CodingKeys: String, CodingKey { case albums, artists }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.albums = (try? c.decode([AlbumDTO].self, forKey: .albums)) ?? []
        self.artists = (try? c.decode([ArtistRefDTO].self, forKey: .artists)) ?? []
    }
}

// MARK: - Stream worker

public struct InitStreamRequest: Codable, Sendable {
    public let cb: Int
    public let disc: Int
    public let track: Int
    public init(cb: Int, disc: Int, track: Int) {
        self.cb = cb; self.disc = disc; self.track = track
    }
}

public struct InitStreamResponse: Codable, Sendable {
    public let sessionId: String
    public let fileSize: Int
    public let keyB64: String
    public let ivB64: String
}
