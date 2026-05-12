package cc.musicme.offline

import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.Base64

data class LicenseClaims(
    val trackId: String,
    val mid: Long,
    val deviceId: String,
    val userId: String,
    val key: ByteArray,     // 32 bytes AES-256
    val iv: ByteArray,      // 16 bytes AES-CTR base IV
    val exp: Long,          // unix seconds
    val iat: Long,
    val v: String
) {
    companion object {
        const val SUPPORTED_VERSION = "offline-v1"

        fun decode(jwt: String): LicenseClaims {
            val parts = jwt.split(".")
            if (parts.size != 3) throw OfflineError.MalformedLicense

            val bodyBytes = try {
                base64UrlDecode(parts[1])
            } catch (e: IllegalArgumentException) {
                throw OfflineError.MalformedLicense
            }
            val json = try {
                JSONObject(String(bodyBytes, StandardCharsets.UTF_8))
            } catch (e: Exception) {
                throw OfflineError.MalformedLicense
            }

            try {
                val trackId = json.getString("trackId")
                val mid = json.getLong("mid")
                val deviceId = json.getString("deviceId")
                val userId = json.getString("userId")
                val keyB64 = json.getString("key")
                val ivB64 = json.getString("iv")
                val exp = json.getLong("exp")
                val iat = json.getLong("iat")
                val v = json.getString("v")

                val key = Base64.getDecoder().decode(keyB64)
                val iv = Base64.getDecoder().decode(ivB64)
                if (key.size != 32) throw OfflineError.MalformedLicense
                if (iv.size != 16) throw OfflineError.MalformedLicense
                if (v != SUPPORTED_VERSION) throw OfflineError.UnsupportedLicenseVersion

                return LicenseClaims(trackId, mid, deviceId, userId, key, iv, exp, iat, v)
            } catch (e: OfflineError) {
                throw e
            } catch (e: Exception) {
                throw OfflineError.MalformedLicense
            }
        }
    }
}

internal fun base64UrlDecode(input: String): ByteArray {
    val padded = input.replace('-', '+').replace('_', '/').let {
        when (it.length % 4) {
            0 -> it
            else -> it + "=".repeat(4 - it.length % 4)
        }
    }
    return Base64.getDecoder().decode(padded)
}
