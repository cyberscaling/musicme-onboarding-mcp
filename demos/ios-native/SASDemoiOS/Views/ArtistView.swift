import SwiftUI
import SASCore
import SASUI

struct ArtistView: View {
    @Environment(\.appContainer) private var container
    let store: PlayerStore
    let route: ArtistRoute

    @State private var artist: ArtistDTO?
    @State private var loading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                } else if let artist {
                    if let bio = artist.bio, !bio.isEmpty {
                        Text(bio).font(.callout).foregroundStyle(.secondary).padding(.horizontal)
                    }
                    if let albums = artist.albums, !albums.isEmpty {
                        Text("Albums").font(.title3.bold()).padding(.horizontal)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 16) {
                                ForEach(albums, id: \.cb) { a in
                                    NavigationLink(value: a.cb) {
                                        AlbumCard(title: a.title, artist: a.artist, coverURL: a.coverURL, onTap: {})
                                    }.buttonStyle(.plain)
                                }
                            }.padding(.horizontal)
                        }
                    }
                    if let top = artist.topTracks, !top.isEmpty {
                        Text("Top tracks").font(.title3.bold()).padding(.horizontal)
                        LazyVStack {
                            ForEach(Array(top.enumerated()), id: \.offset) { idx, t in
                                TrackRow(
                                    number: idx + 1, title: t.title, artist: t.artist,
                                    durationMs: t.durationMs, isPlaying: false,
                                    onTap: {}, onEnqueue: {}
                                )
                                .padding(.horizontal)
                                Divider()
                            }
                        }
                    }
                    if let similar = artist.similar, !similar.isEmpty {
                        Text("Artistes similaires").font(.title3.bold()).padding(.horizontal)
                        LazyVStack {
                            ForEach(similar, id: \.id) { s in
                                NavigationLink(value: ArtistRoute(id: s.id, name: s.name)) {
                                    ArtistRow(name: s.name, onTap: {})
                                }.buttonStyle(.plain).padding(.horizontal)
                            }
                        }
                    }
                }
            }
            .padding(.vertical)
        }
        .navigationTitle(route.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do {
                artist = try await container.api.catalog.artist(id: route.id)
            } catch { /* surface later */ }
            loading = false
        }
    }
}
