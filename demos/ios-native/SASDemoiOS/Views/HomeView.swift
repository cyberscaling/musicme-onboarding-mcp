import SwiftUI
import SASCore
import SASUI

struct HomeView: View {
    @Environment(\.appContainer) private var container
    let store: PlayerStore

    @State private var home: HomeDTO?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if loading {
                    ProgressView().padding(.top, 40).frame(maxWidth: .infinity)
                } else if let error {
                    Text(error).foregroundStyle(.red).padding()
                } else if let home {
                    section("Top albums") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 16) {
                                ForEach(home.top, id: \.cb) { a in
                                    NavigationLink(value: a.cb) {
                                        AlbumCard(title: a.title, artist: a.artist, coverURL: a.coverURL, onTap: {})
                                    }
                                    .buttonStyle(.plain)
                                }
                            }.padding(.horizontal)
                        }
                    }
                    section("Nouveautés") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 16) {
                                ForEach(home.news, id: \.cb) { a in
                                    NavigationLink(value: a.cb) {
                                        AlbumCard(title: a.title, artist: a.artist, coverURL: a.coverURL, onTap: {})
                                    }
                                    .buttonStyle(.plain)
                                }
                            }.padding(.horizontal)
                        }
                    }
                    section("Styles") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ForEach(home.styles, id: \.id) { s in
                                    NavigationLink(value: StyleRoute(id: s.id, name: s.name)) {
                                        StyleChip(name: s.name, onTap: {})
                                    }
                                    .buttonStyle(.plain)
                                }
                            }.padding(.horizontal)
                        }
                    }
                }
            }
            .padding(.vertical)
        }
        .navigationTitle("Accueil")
        .navigationDestination(for: String.self) { cb in
            AlbumView(store: store, cb: cb)
        }
        .navigationDestination(for: StyleRoute.self) { route in
            StyleView(store: store, route: route)
        }
        .navigationDestination(for: ArtistRoute.self) { route in
            ArtistView(store: store, route: route)
        }
        .task {
            await load()
        }
    }

    @ViewBuilder
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title3.bold()).padding(.horizontal)
            content()
        }
    }

    private func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            home = try await container.api.catalog.home()
        } catch APIError.unauthorized {
            error = "Session expirée"
        } catch {
            self.error = "Échec du chargement"
        }
    }
}

struct StyleRoute: Hashable { let id: Int; let name: String }
struct ArtistRoute: Hashable { let id: Int; let name: String }
