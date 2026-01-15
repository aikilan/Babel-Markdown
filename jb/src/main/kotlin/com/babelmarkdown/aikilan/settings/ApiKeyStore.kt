package com.babelmarkdown.aikilan.settings

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.components.Service

@Service(Service.Level.APP)
class ApiKeyStore {
  private val credentialAttributes = CredentialAttributes("BabelMarkdown.translationApiKey")

  fun getApiKey(): String? {
    return PasswordSafe.instance.getPassword(credentialAttributes)?.trim()?.ifEmpty { null }
  }

  fun setApiKey(value: String?) {
    val trimmed = value?.trim()?.ifEmpty { null }
    PasswordSafe.instance.setPassword(credentialAttributes, trimmed)
  }
}
