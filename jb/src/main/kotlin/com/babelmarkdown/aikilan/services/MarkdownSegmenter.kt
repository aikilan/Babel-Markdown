package com.babelmarkdown.aikilan.services

class MarkdownSegmenter {
  fun split(markdown: String): List<String> {
    val lines = markdown.split("\n")
    val segments = mutableListOf<String>()
    val buffer = mutableListOf<String>()
    var inFence = false

    fun flush() {
      if (buffer.isNotEmpty()) {
        segments.add(buffer.joinToString("\n"))
        buffer.clear()
      }
    }

    for (rawLine in lines) {
      val line = rawLine.removeSuffix("\r")
      val trimmed = line.trim()
      if (trimmed.startsWith("```")) {
        buffer.add(line)
        inFence = !inFence
        continue
      }

      if (!inFence && trimmed.isEmpty()) {
        flush()
        continue
      }

      buffer.add(line)
    }

    flush()

    return if (segments.isEmpty() && markdown.trim().isNotEmpty()) {
      listOf(markdown)
    } else {
      segments
    }
  }
}
