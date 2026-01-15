package com.babelmarkdown.aikilan.util

import com.intellij.openapi.vfs.VirtualFile

private val markdownExtensions = setOf("md", "markdown")

fun isMarkdownFile(file: VirtualFile): Boolean {
  val extension = file.extension?.lowercase() ?: return false
  return markdownExtensions.contains(extension)
}
