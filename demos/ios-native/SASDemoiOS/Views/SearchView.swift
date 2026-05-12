import SwiftUI
import SASCore
import SASUI

struct SearchView: View {
    @Environment(\.appContainer) private var container
    let store: PlayerStore

    @State private var query = ""
    @State private var results: SearchResultsDTO?
    @State private var searching = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Rechercher albums, artistes", text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit { Task { await runSearch() } }
            }
            .padding(10)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
            .padding()

            if searching {
                ProgressView().padding(.top, 40)
            } else if let results {
                List {
                    if !results.albums.isEmpty {
                        Section("Albums") {
                            ForEach(results.albums, id: \.cb) { a in
                                NavigationLink(value: a.cb) {
                                    HStack {
                                        Cover(url: a.coverURL, size: 48)
                                        VStack(alignment: .leading) {
                                            Text(a.title)
                                            Text(a.artist).font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if !results.artists.isEmpty {
                        Section("Artistes") {
                            ForEach(results.artists, id: \.id) { a in
                                NavigationLink(value: ArtistRoute(id: a.id, name: a.name)) {
                                    ArtistRow(name: a.name, onTap: {})
                                }
                            }
                        }
                    }
                }
            }
            Spacer()
        }
        .navigationTitle("Recherche")
    }

    private func runSearch() async {
        guard query.count >= 2 else { results = nil; return }
        searching = true
        defer { searching = false }
        do { results = try await container.api.catalog.searchGlobal(query: query) }
        catch { /* surface later */ }
    }
}
