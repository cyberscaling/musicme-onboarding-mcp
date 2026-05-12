package cc.musicme.offline

import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.File
import java.util.UUID

class BlobStoreTest {
    private lateinit var root: File

    @Before
    fun setUp() {
        root = File(System.getProperty("java.io.tmpdir"), "blobs-${UUID.randomUUID()}")
    }
    @After
    fun tearDown() {
        root.deleteRecursively()
    }

    private fun writeTempFile(data: ByteArray): File {
        val f = File(System.getProperty("java.io.tmpdir"), UUID.randomUUID().toString())
        f.writeBytes(data)
        return f
    }

    @Test
    fun persistAndPread() {
        val store = BlobStore(root)
        val content = ByteArray(512) { (it and 0xFF).toByte() }
        val path = store.persist("100:0:5", writeTempFile(content))
        assertTrue(File(path).exists())
        val slice = store.pread(path, 16L, 32)
        assertArrayEquals(content.copyOfRange(16, 48), slice)
    }

    @Test
    fun delete() {
        val store = BlobStore(root)
        val path = store.persist("x", writeTempFile(byteArrayOf(1, 2, 3)))
        store.delete("x")
        assertFalse(File(path).exists())
    }

    @Test
    fun wipeAll() {
        val store = BlobStore(root)
        store.persist("a", writeTempFile(byteArrayOf(1)))
        store.persist("b", writeTempFile(byteArrayOf(2)))
        store.wipeAll()
        assertEquals(0, root.listFiles()?.size ?: 0)
    }
}
