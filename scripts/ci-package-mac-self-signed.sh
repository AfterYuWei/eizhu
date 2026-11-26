#!/usr/bin/env bash
set -euo pipefail

arch="${1:?Missing macOS architecture}"
if [[ -z "${EIZHU_MAC_SELF_SIGN_P12:-}" || -z "${EIZHU_MAC_SELF_SIGN_PASSWORD:-}" ]]; then
  echo "::error::配置 EIZHU_MAC_SELF_SIGN_P12 和 EIZHU_MAC_SELF_SIGN_PASSWORD 后重新运行。"
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

printf '%s' "$EIZHU_MAC_SELF_SIGN_P12" | /usr/bin/base64 --decode > "$p12"
keychain_password="$(/usr/bin/openssl rand -hex 24)"
echo "::add-mask::$keychain_password"
/usr/bin/security create-keychain -p "$keychain_password" "$keychain"
/usr/bin/security set-keychain-settings -lut 21600 "$keychain"
/usr/bin/security unlock-keychain -p "$keychain_password" "$keychain"
/usr/bin/security import "$p12" -f pkcs12 -P "$EIZHU_MAC_SELF_SIGN_PASSWORD" -T /usr/bin/codesign -k "$keychain"
/usr/bin/security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" >/dev/null
rm -- "$p12"
unset EIZHU_MAC_SELF_SIGN_P12 EIZHU_MAC_SELF_SIGN_PASSWORD keychain_password

/usr/bin/security find-certificate -c 'eizhu Local Code Signing' -p "$keychain" > "$certificate"
fingerprint="$(/usr/bin/openssl x509 -in "$certificate" -noout -fingerprint -sha1 | /usr/bin/sed 's/^.*=//;s/://g')"
if [[ ! "$fingerprint" =~ ^[A-Fa-f0-9]{40}$ ]]; then
  echo "::error::无法识别 eizhu Local Code Signing 证书指纹。"
  exit 1
fi
certificate_sha256="$(/usr/bin/openssl x509 -in "$certificate" -noout -fingerprint -sha256 | /usr/bin/sed 's/^.*=//;s/://g')"
# The GitHub-hosted runner discards this public trust anchor at the end of the job.
sudo -n /usr/bin/security add-trusted-cert -d -r trustRoot -p codeSign -k "$system_keychain" "$certificate"

keychains=("$keychain")
while IFS= read -r entry; do
  if [[ "$entry" == *\"*\"* ]]; then
    entry="${entry#*\"}"
    keychains+=("${entry%\"}")
  fi
done < <(/usr/bin/security list-keychains -d user)
/usr/bin/security list-keychains -d user -s "${keychains[@]}"

EIZHU_MAC_SELF_SIGN=1 CSC_KEYCHAIN="$keychain" CSC_NAME="$fingerprint" \
  npm run desktop:package -- --platform=darwin --arch="$arch"
/usr/bin/security delete-keychain "$keychain"

version="$(node -p 'require("./apps/desktop/out/build-info.json").version')"
installer="artifacts/desktop/eizhu-$version-mac-$arch.dmg"
if [[ ! -f "$installer" ]]; then
  echo "::error::找不到本次构建的 macOS 安装包 $installer"
  exit 1
fi
EIZHU_MAC_SELF_SIGN_CERT_SHA256="$certificate_sha256" node scripts/smoke-package.mjs "$installer" --duration=60000
