package com.babelmarkdown.aikilan.util

import java.security.MessageDigest

fun sha256Hex(input: String): String {
  val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
  val builder = StringBuilder(digest.size * 2)
  for (byte in digest) {
    val value = byte.toInt() and 0xff
    if (value < 16) {
      builder.append('0')
    }
    builder.append(value.toString(16))
  }
  return builder.toString()
}
