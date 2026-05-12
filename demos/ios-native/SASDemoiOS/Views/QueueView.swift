import SwiftUI
import SASCore
import SASUI

struct QueueView: View {
    let store: PlayerStore

    var body: some View {
        Group {
            if store.items.isEmpty {
                ContentUnavailableView("File vide", systemImage: "music.note.list",
                                       description: Text("Ajoute des titres depuis un album."))
            } else {
                List {
                    ForEach(Array(store.items.enumerated()), id: \.element.id) { idx, item in
                        HStack(spacing: 12) {
                            if store.mode == .queue && idx == store.currentIndex {
                                Image(systemName: "waveform").foregroundStyle(.tint).frame(width: 24)
                            } else {
                                Text("\(idx + 1)").frame(width: 24).foregroundStyle(.secondary).font(.callout)
                            }
                            Cover(url: item.meta.coverURL, size: 40)
                            VStack(alignment: .leading) {
                                Text(item.meta.title).lineLimit(1)
                                Text(item.meta.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                        }
                        .contentShape(Rectangle())
                        .onTapGesture {
                            store.playQueueAt(item.id)
                        }
                        .swipeActions {
                            Button(role: .destructive) {
                                store.dequeue(item.id)
                            } label: { Label("Supprimer", systemImage: "trash") }
                        }
                    }
                    .onMove { from, to in
                        // SwiftUI provides IndexSet from + Int to. Convert to (id, target).
                        guard let f = from.first else { return }
                        let id = store.items[f].id
                        // SwiftUI's "to" is the insertion index after removal. Convert:
                        let target = to > f ? to - 1 : to
                        store.move(id, to: target)
                    }
                }
                .toolbar { EditButton() }
            }
        }
        .navigationTitle("File d'attente")
        .navigationBarTitleDisplayMode(.inline)
    }
}
