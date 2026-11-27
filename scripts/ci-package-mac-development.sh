#!/usr/bin/env bash
set -euo pipefail

arch="${1:?Missing macOS architecture}"
if [[ -z "${EIZHU_MAC_DEVELOPMENT_P12:-}" || -z "${EIZHU_MAC_DEVELOPMENT_PASSWORD:-}" ]]; then
  echo "::error::配置 EIZHU_MAC_DEVELOPMENT_P12 和 EIZHU_MAC_DEVELOPMENT_PASSWORD 后重新运行。"
  exit 1
fi

umask 077
signing_dir="$(mktemp -d "${RUNNER_TEMP:?Missing runner temp directory}/eizhu-signing.XXXXXXXX")"
keychain="$signing_dir/eizhu.keychain-db"
certificate="$signing_dir/eizhu.cer"
p12="$signing_dir/eizhu.p12"
system_keychain=/Library/Keychains/System.keychain

cleanup() {
  if [[ -e "$keychain" ]]; then
    /usr/bin/security delete-keychain "$keychain" ||
      echo "::warning::未能注销运行器上的临时签名钥匙串。"
  fi
  rm -rf -- "$signing_dir"
}
trap cleanup EXIT

printf '%s' "$EIZHU_MAC_DEVELOPMENT_P12" | /usr/bin/base64 --decode > "$p12"
keychain_password="$(/usr/bin/openssl rand -hex 24)"
echo "::add-mask::$keychain_password"
/usr/bin/security create-keychain -p "$keychain_password" "$keychain"
/usr/bin/security set-keychain-settings -lut 21600 "$keychain"
/usr/bin/security unlock-keychain -p "$keychain_password" "$keychain"
/usr/bin/security import "$p12" -f pkcs12 -P "$EIZHU_MAC_DEVELOPMENT_PASSWORD" -T /usr/bin/codesign -k "$keychain"
/usr/bin/security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" >/dev/null
rm -- "$p12"
unset EIZHU_MAC_DEVELOPMENT_P12 EIZHU_MAC_DEVELOPMENT_PASSWORD keychain_password

# Use the Apple WWDR G3 intermediate bundled with the runner's Xcode.
wwdr_certificate="$(dirname "$(/usr/bin/xcode-select --print-path)")/SharedFrameworks/DVTFoundation.framework/Versions/A/Resources/AppleWWDRCA-2030.cer"
if [[ ! -f "$wwdr_certificate" ]]; then
  echo "::error::当前 Xcode 缺少 Apple WWDR G3 中间证书。"
  exit 1
fi
wwdr_fingerprint="$(/usr/bin/openssl x509 -inform DER -in "$wwdr_certificate" -noout -fingerprint -sha256 | /usr/bin/sed 's/^.*=//;s/://g')"
system_certificates="$(/usr/bin/security find-certificate -a -Z -c 'Apple Worldwide Developer Relations Certification Authority' "$system_keychain" || true)"
if ! /usr/bin/grep -Fqi "SHA-256 hash: $wwdr_fingerprint" <<< "$system_certificates"; then
  sudo -n /usr/bin/security import "$wwdr_certificate" -k "$system_keychain"
fi

if ! /usr/bin/security find-certificate -c 'Apple Development:' -p "$keychain" > "$certificate"; then
  echo "::error::P12 中缺少 Apple Development 证书。"
  exit 1
fi
fingerprint="$(/usr/bin/openssl x509 -in "$certificate" -noout -fingerprint -sha1 | /usr/bin/sed 's/^.*=//;s/://g')"
if [[ ! "$fingerprint" =~ ^[A-Fa-f0-9]{40}$ ]]; then
  echo "::error::无法识别 Apple Development 证书指纹。"
  exit 1
fi
certificate_sha256="$(/usr/bin/openssl x509 -in "$certificate" -noout -fingerprint -sha256 | /usr/bin/sed 's/^.*=//;s/://g')"
keychains=("$keychain")
while IFS= read -r entry; do
  if [[ "$entry" == *\"*\"* ]]; then
    entry="${entry#*\"}"
    keychains+=("${entry%\"}")
  fi
done < <(/usr/bin/security list-keychains -d user)
/usr/bin/security list-keychains -d user -s "${keychains[@]}"

identity_name="$(/usr/bin/security find-identity -v -p codesigning "$keychain" |
  /usr/bin/sed -nE "s/^[[:space:]]*[[:digit:]]+\\)[[:space:]]+$fingerprint \"(Apple Development: .+)\"$/\\1/p")"
if [[ -z "$identity_name" ]]; then
  echo "::error::Apple Development 签名身份无效。请检查证书有效期、签名链及对应私钥。"
  exit 1
fi
printf '::add-mask::%s\n' "$identity_name"

EIZHU_MAC_DEVELOPMENT_SIGN=1 CSC_KEYCHAIN="$keychain" CSC_NAME="$fingerprint" \
  npm run desktop:package -- --platform=darwin --arch="$arch"
/usr/bin/security delete-keychain "$keychain"

version="$(node -p 'require("./apps/desktop/out/build-info.json").version')"
installer="artifacts/desktop/eizhu-$version-mac-$arch.dmg"
if [[ ! -f "$installer" ]]; then
  echo "::error::找不到本次构建的 macOS 安装包 $installer"
  exit 1
fi
EIZHU_MAC_DEVELOPMENT_CERT_SHA256="$certificate_sha256" node scripts/smoke-package.mjs "$installer" --duration=60000
