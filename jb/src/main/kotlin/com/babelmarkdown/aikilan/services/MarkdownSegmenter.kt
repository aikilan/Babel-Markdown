package com.babelmarkdown.aikilan.services

class MarkdownSegmenter {
  fun split(markdown: String): List<String> {
    val lines = markdown.split("\n")
    val paragraphs = mutableListOf<String>()
    val buffer = mutableListOf<String>()
    var inFence = false
    val minChars = 500

    fun flushParagraph() {
      if (buffer.isEmpty()) {
        return
      }
      val paragraph = buffer.joinToString("\n")
      buffer.clear()
      if (paragraph.trim().isNotEmpty()) {
        paragraphs.add(paragraph)
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
        flushParagraph()
        continue
      }

      buffer.add(line)
    }

    flushParagraph()

    if (paragraphs.isEmpty()) {
      return if (markdown.trim().isNotEmpty()) listOf(markdown) else emptyList()
    }

    val segments = mutableListOf<String>()
    var current = StringBuilder()

    fun appendParagraph(paragraph: String) {
      if (current.isNotEmpty()) {
        current.append("\n\n")
      }
      current.append(paragraph)
    }

    for (paragraph in paragraphs) {
      val paragraphLength = paragraph.length
      if (current.isEmpty() && paragraphLength >= minChars) {
        segments.add(paragraph)
        continue
      }

      if (current.isEmpty()) {
        current.append(paragraph)
        continue
      }

      if (current.length < minChars) {
        appendParagraph(paragraph)
        if (current.length >= minChars) {
          segments.add(current.toString())
          current = StringBuilder()
        }
        continue
      }

      segments.add(current.toString())
      current = StringBuilder()
      if (paragraphLength >= minChars) {
        segments.add(paragraph)
      } else {
        current.append(paragraph)
      }
    }

    if (current.isNotEmpty()) {
      if (current.length < minChars && segments.isNotEmpty()) {
        segments[segments.lastIndex] = segments.last() + "\n\n" + current.toString()
      } else {
        segments.add(current.toString())
      }
    }

    return segments
  }
}
