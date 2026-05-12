// demos/react-native/app/queue.tsx
import DraggableFlatList, { type RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { TopNav } from '@/components/TopNav'
import { Cover } from '@/components/Cover'
import { usePlayer } from '@/lib/playerStore'

type Item = { id: string; ref: { cb: number; disc: number; track: number }; meta?: Record<string, unknown> }

export default function Queue() {
  const player = usePlayer()
  const items = player.items as ReadonlyArray<Item>

  return (
    <View style={s.root}>
      <TopNav title={`Queue · ${items.length}`} />
      {items.length === 0 ? (
        <View style={s.center}><Text style={s.muted}>queue is empty</Text></View>
      ) : (
        <DraggableFlatList
          data={items as Item[]}
          keyExtractor={(it) => it.id}
          onDragEnd={({ data, from, to }) => {
            if (from === to) return
            const moved = data[to]
            if (!moved) return
            player.moveItem(moved.id, to)
          }}
          renderItem={({ item, drag, isActive, getIndex }: RenderItemParams<Item>) => {
            const idx = getIndex() ?? -1
            const isCurrent = idx === player.currentIndex
            const title = (item.meta?.title as string | undefined) ?? `cb ${item.ref.cb}`
            return (
              <ScaleDecorator>
                <View style={[s.row, isCurrent && s.rowCurrent, isActive && s.rowDragging]}>
                  <Pressable
                    style={s.dragHandle}
                    onLongPress={drag}
                    delayLongPress={120}
                    accessibilityLabel="drag to reorder"
                  >
                    <Text style={s.dragIcon}>⠿</Text>
                  </Pressable>
                  <Pressable
                    style={s.body}
                    onPress={() => {
                      void player.playQueueAt(item.id)
                      router.back()
                    }}
                  >
                    <Cover cb={item.ref.cb} size={90} fallbackLabel={title} style={s.cover} />
                    <View style={s.text}>
                      <Text style={s.title} numberOfLines={1}>
                        {isCurrent ? '▶ ' : ''}{title}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    style={s.removeBtn}
                    onPress={() => player.dequeue(item.id)}
                    accessibilityLabel="remove"
                    hitSlop={8}
                  >
                    <Text style={s.removeIcon}>✕</Text>
                  </Pressable>
                </View>
              </ScaleDecorator>
            )
          }}
          contentContainerStyle={{ paddingBottom: 240 }}
        />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  muted: { color: '#666' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#111' },
  rowCurrent: { backgroundColor: '#101010' },
  rowDragging: { backgroundColor: '#1a1a1a' },
  dragHandle: { width: 36, height: 44, justifyContent: 'center', alignItems: 'center' },
  dragIcon: { color: '#666', fontSize: 18 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  cover: { width: 40, height: 40, borderRadius: 4 },
  text: { flex: 1 },
  title: { color: '#eee', flex: 1, fontSize: 14 },
  removeBtn: { width: 36, height: 44, justifyContent: 'center', alignItems: 'center' },
  removeIcon: { color: '#888', fontSize: 16 },
})
