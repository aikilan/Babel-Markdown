package com.babelmarkdown.aikilan.util

import com.vladsch.flexmark.html.HtmlRenderer
import com.vladsch.flexmark.parser.Parser
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.safety.Safelist

class MarkdownRenderer {
  private val parser = Parser.builder().build()
  private val renderer = HtmlRenderer.builder().build()
  private val safelist = Safelist.relaxed()
    .addTags(
      "img",
      "figure",
      "figcaption",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
      "pre",
      "code",
    )
    .addAttributes("a", "href", "name", "target", "rel", "title")
    .addAttributes("img", "src", "alt", "title", "width", "height")
    .addProtocols("a", "href", "http", "https", "mailto")
    .addProtocols("img", "src", "http", "https", "data")

  @Synchronized
  fun render(markdown: String): String {
    val document = parser.parse(markdown)
    val html = renderer.render(document)
    val settings = Document.OutputSettings().prettyPrint(false)
    return Jsoup.clean(html, "", safelist, settings)
  }
}
