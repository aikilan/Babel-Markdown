#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

ENV_FILE="$ROOT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

missing=()

if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -x "/usr/libexec/java_home" ]]; then
    JAVA_HOME_DETECTED=$(/usr/libexec/java_home -v 21 2>/dev/null || true)
    if [[ -n "$JAVA_HOME_DETECTED" ]]; then
      export JAVA_HOME="$JAVA_HOME_DETECTED"
    fi
  fi
fi

if [[ -z "${JAVA_HOME:-}" ]]; then
  missing+=("JAVA_HOME (JDK 21)")
else
  if [[ ! -x "$JAVA_HOME/bin/java" ]]; then
    echo "JAVA_HOME is set but java was not found: $JAVA_HOME"
    echo "Run: $ROOT_DIR/scripts/setup-env.sh"
    exit 1
  fi
  java_version=$("$JAVA_HOME/bin/java" -version 2>&1 | head -n 1)
  if ! echo "$java_version" | grep -q '"21'; then
    echo "JAVA_HOME must point to JDK 21."
    echo "Detected: $java_version"
    echo "Run: $ROOT_DIR/scripts/setup-env.sh"
    exit 1
  fi
fi

GRADLE_BIN_RESOLVED=""
if [[ -n "${GRADLE_BIN:-}" && -x "$GRADLE_BIN" ]]; then
  GRADLE_BIN_RESOLVED="$GRADLE_BIN"
elif [[ -x "$ROOT_DIR/gradlew" ]]; then
  GRADLE_BIN_RESOLVED="$ROOT_DIR/gradlew"
elif [[ -n "${GRADLE_HOME:-}" && -x "$GRADLE_HOME/bin/gradle" ]]; then
  GRADLE_BIN_RESOLVED="$GRADLE_HOME/bin/gradle"
elif [[ -x "$ROOT_DIR/.tools/gradle-8.8/bin/gradle" ]]; then
  GRADLE_BIN_RESOLVED="$ROOT_DIR/.tools/gradle-8.8/bin/gradle"
else
  missing+=("Gradle 8.8")
fi

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing build tools:"
  for item in "${missing[@]}"; do
    echo "  - $item"
  done
  echo ""
  echo "Run setup script:"
  echo "  $ROOT_DIR/scripts/setup-env.sh"
  echo ""
  echo "Then run:"
  echo "  $ROOT_DIR/scripts/build-plugin.sh"
  exit 1
fi

if [[ -z "${JAVA_TOOL_OPTIONS:-}" ]]; then
  proxy_url="${HTTPS_PROXY:-${HTTP_PROXY:-}}"
  if [[ -n "$proxy_url" ]]; then
    proxy="${proxy_url#*://}"
    proxy="${proxy%%/*}"
    proxy_host="${proxy%%:*}"
    proxy_port="${proxy##*:}"
    if [[ -n "$proxy_host" && "$proxy_host" != "$proxy_port" ]]; then
      export JAVA_TOOL_OPTIONS="-Djava.net.useSystemProxies=true -Dhttp.proxyHost=$proxy_host -Dhttp.proxyPort=$proxy_port -Dhttps.proxyHost=$proxy_host -Dhttps.proxyPort=$proxy_port"
    fi
  fi
fi

cd "$ROOT_DIR"
"$GRADLE_BIN_RESOLVED" --no-daemon buildPlugin

dist_dir="$ROOT_DIR/build/distributions"
if [[ -d "$dist_dir" ]]; then
  echo ""
  echo "Build output:"
  ls -1 "$dist_dir" | sed 's/^/  /'
fi
