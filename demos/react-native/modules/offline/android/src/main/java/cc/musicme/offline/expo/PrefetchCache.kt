package cc.musicme.offline.expo

import cc.musicme.offline.ByteSource

object PrefetchCache {
    private val sources = HashMap<String, ByteSource>()

    @Synchronized
    fun put(trackId: String, source: ByteSource) {
        sources[trackId]?.close()
        sources[trackId] = source
    }

    @Synchronized
    fun take(trackId: String): ByteSource? = sources.remove(trackId)

    @Synchronized
    fun clear(except: String? = null) {
        sources.filterKeys { it != except }.values.forEach { it.close() }
        if (except != null) {
            val kept = sources[except]
            sources.clear()
            if (kept != null) sources[except] = kept
        } else {
            sources.clear()
        }
    }
}
