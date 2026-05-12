import SwiftUI
import SASCore
import SASUI

struct StyleView: View {
    @Environment(\.appContainer) private var container
    let store: PlayerStore
    let route: StyleRoute

    @State private var feed: StyleFeedDTO?
    @State private var loading = true

    var body: some View {
        ScrollView {
            if loading {
                ProgressView().padding(.top, 60)
            } else if let feed {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 16)], spacing: 20) {
                    ForEach(feed.albums, id: \.cb) { a in
                        NavigationLink(value: a.cb) {
                            AlbumCard(title: a.title, artist: a.artist, coverURL: a.coverURL, onTap: {})
                        }.buttonStyle(.plain)
                    }
                }
                .padding()
            }
        }
        .navigationTitle(route.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { feed = try await container.api.catalog.style(id: route.id) }
            catch { /* surface later */ }
            loading = false
        }
    }
}
