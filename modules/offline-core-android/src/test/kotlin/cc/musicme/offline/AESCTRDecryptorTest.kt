package cc.musicme.offline

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AESCTRDecryptorTest {

    @Test
    fun counterForBlockBigEndianCarry() {
        val iv = ByteArray(16).apply { this[15] = 0xFF.toByte() }
        val c = AESCTRDecryptor.counterForBlock(iv, 1)
        assertEquals(0x00.toByte(), c[15])
        assertEquals(0x01.toByte(), c[14])
    }

    @Test
    fun counterForBlockSimple() {
        val iv = ByteArray(16)
        val c = AESCTRDecryptor.counterForBlock(iv, 5)
        assertEquals(0x05.toByte(), c[15])
        for (i in 0..14) assertEquals(0x00.toByte(), c[i])
    }

    @Test
    fun decryptRoundTripAlignedAtZero() {
        val key = ByteArray(32) { 0x11 }
        val iv = ByteArray(16) { 0x22 }
        val plaintext = ByteArray(1024) { (it and 0xFF).toByte() }
        val ciphertext = AESCTRDecryptor.decrypt(plaintext, key, iv, 0)
        val decrypted = AESCTRDecryptor.decrypt(ciphertext, key, iv, 0)
        assertArrayEquals(plaintext, decrypted)
    }

    @Test
    fun decryptUnalignedRange() {
        val key = ByteArray(32) { 0x33 }
        val iv = ByteArray(16) { 0x44 }
        val plaintext = ByteArray(64) { it.toByte() }
        val wire = AESCTRDecryptor.decrypt(plaintext.copyOfRange(0, 26), key, iv, 0)
        val decrypted = AESCTRDecryptor.decrypt(wire, key, iv, 0)
        val userSlice = decrypted.copyOfRange(5, 26)
        assertArrayEquals(plaintext.copyOfRange(5, 26), userSlice)
    }
}
