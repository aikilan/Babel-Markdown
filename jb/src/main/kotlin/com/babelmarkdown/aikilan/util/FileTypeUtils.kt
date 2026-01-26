package com.babelmarkdown.aikilan.util

import com.intellij.openapi.vfs.VirtualFile

private val markdownExtensions = setOf("md", "markdown", "mdown", "mkd", "mkdn", "mdwn")
private const val markdownTypeName = "Markdown"

fun isMarkdownFile(file: VirtualFile): Boolean {
  if (file.isDirectory) {
    return false
  }
  val extension = file.extension?.lowercase()
  if (extension != null && markdownExtensions.contains(extension)) {
    return true
  }
  return file.fileType.name.equals(markdownTypeName, ignoreCase = true)
}
