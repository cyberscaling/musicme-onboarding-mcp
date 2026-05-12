import SwiftUI
import SASCore
import SASUI

struct AlbumView: View {
    @Environment(\.appContainer) private var container
    let store: PlayerStore
    let cb: String

    @State private var album: AlbumDTO?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if loading {
                    ProgressView().padding(.top, 60)
                } else if let error {
                    Text(error).foregroundStyle(.red).padding()
                } else if let album {
                    Cover(url: album.coverURL, size: 220)
                        .shadow(radius: 8)
                    Text(album.title).font(.title2.bold()).multilineTextAlignment(.center)
                    Text(album.artist).foregroundStyle(.secondary)
                    Button {
                        playAll()
                    } label: {
                        Label("Play all", systemImage: "play.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .padding(.horizontal)

                    LazyVStack(spacing: 0) {
                        if let tracks = album.tracks {
                            ForEach(Array(tracks.enumerated()), id: \.offset) { idx, t in
                                TrackRow(
                                    number: idx + 1,
                                    title: t.title, artist: t.artist,
                                    durationMs: t.durationMs,
                                    isPlaying: isPlaying(track: t),
                                    onTap: { playSingle(t, atIndex: idx, in: tracks) },
                                    onEnqueue: { enqueue(t) }
                                )
                                .padding(.horizontal)
                                Divider()
                            }
                        }
                    }
                }
            }
            .padding(.top)
        }
        .navigationTitle(album?.title ?? "Album")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await load()
            await warmup()
        }
    }

    private func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            album = try await container.api.catalog.album(cb: cb)
        } catch APIError.unauthorized {
            error = "Session expirée"
        } catch {
            self.error = "Échec du chargement"
        }
    }

    private func warmup() async {
        guard let workerURL = container.streamWorkerURL else { return }
        await container.api.makeWarmupClient(streamWorkerURL: workerURL).warmupAlbum(cb: cb)
    }

    private func isPlaying(track t: AlbumTrackDTO) -> Bool {
        store.track?.title == t.title && store.track?.artist == t.artist
    }

    private func playAll() {
        guard let tracks = album?.tracks else { return }
        store.playAlbumEphemeral(items(from: tracks), startIndex: 0)
    }

    private func playSingle(_ t: AlbumTrackDTO, atIndex idx: Int, in tracks: [AlbumTrackDTO]) {
        store.playAlbumEphemeral(items(from: tracks), startIndex: idx)
    }

    private func enqueue(_ t: AlbumTrackDTO) {
        let ref = TrackRef(cb: cb, disc: t.disc, track: t.track)
        let meta = TrackMeta(title: t.title, artist: t.artist, coverURL: album?.coverURL, durationMs: t.durationMs)
        store.enqueue(QueueItem(ref: ref, meta: meta))
    }

    private func items(from tracks: [AlbumTrackDTO]) -> [QueueItem] {
        tracks.map { t in
            QueueItem(
                ref: TrackRef(cb: cb, disc: t.disc, track: t.track),
                meta: TrackMeta(title: t.title, artist: t.artist, coverURL: album?.coverURL, durationMs: t.durationMs)
            )
        }
    }
}
