import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
  kotlin("jvm") version "2.1.0"
  id("org.jetbrains.intellij.platform") version "2.0.0"
}

group = "com.babelmarkdown.aikilan"
version = "0.1.7"

repositories {
  mavenCentral()
  intellijPlatform {
    defaultRepositories()
  }
}

kotlin {
  jvmToolchain(21)
}

dependencies {
  intellijPlatform {
    intellijIdeaCommunity("2025.1")
    instrumentationTools()
  }
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("com.google.code.gson:gson:2.11.0")
  implementation("com.vladsch.flexmark:flexmark-all:0.64.8")
  implementation("org.jsoup:jsoup:1.17.2")
}

tasks {
  patchPluginXml {
    sinceBuild.set("251")
    untilBuild.set("252.*")
  }

  withType<KotlinCompile>().configureEach {
    compilerOptions.jvmTarget.set(JvmTarget.JVM_21)
  }

  buildSearchableOptions {
    enabled = false
  }
}
