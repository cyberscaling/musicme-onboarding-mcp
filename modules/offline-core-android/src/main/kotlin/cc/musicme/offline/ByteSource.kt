package cc.musicme.offline

interface ByteSource {
    val fileSize: Long
    val contentType: String
    suspend fun read(start: Long, endExclusive: Long): ByteArray
    fun close()
}
