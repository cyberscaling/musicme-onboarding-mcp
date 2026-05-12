package cc.musicme.offline

import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

object AESCTRDecryptor {
    const val BLOCK_SIZE = 16

    /**
     * Big-endian counter = baseIv (interpreted as 128-bit BE integer) + blockIndex.
     * Mirrors `counterForBlock` in worker/src/lib/crypto.ts and the iOS counterpart.
     */
    fun counterForBlock(baseIv: ByteArray, blockIndex: Int): ByteArray {
        require(baseIv.size == BLOCK_SIZE) { "baseIv must be 16 bytes" }
        val out = baseIv.copyOf()
        var carry = blockIndex
        var i = BLOCK_SIZE - 1
        while (i >= 0 && carry > 0) {
            val sum = (out[i].toInt() and 0xff) + (carry and 0xff)
            out[i] = (sum and 0xff).toByte()
            carry = (carry ushr 8) + (sum ushr 8)
            i -= 1
        }
        return out
    }

    /**
     * AES-CTR symmetric encrypt/decrypt. `blockIndex` indicates the counter offset
     * for the first byte of `input`. Output has the same length as input.
     */
    fun decrypt(input: ByteArray, key: ByteArray, baseIv: ByteArray, blockIndex: Int): ByteArray {
        require(key.size == 32) { "key must be 32 bytes (AES-256)" }
        require(baseIv.size == BLOCK_SIZE) { "baseIv must be 16 bytes" }
        val counter = counterForBlock(baseIv, blockIndex)
        return try {
            val cipher = Cipher.getInstance("AES/CTR/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(counter))
            cipher.doFinal(input)
        } catch (e: Exception) {
            throw OfflineError.IoError("AES-CTR failed: ${e.message}")
        }
    }
}
