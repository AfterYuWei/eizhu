#!/usr/bin/env bash
set -euo pipefail

arch="${1:?Missing macOS architecture}"
installer="${2:?Missing macOS installer path}"
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
fingerprint=
runner_trust_added=false

cleanup() {
  if [[ "$runner_trust_added" == true ]]; then
    sudo -n /usr/bin/security remove-trusted-cert -d "$certificate" ||
      echo "::warning::未能移除运行器上的临时代码签名信任。"
    sudo -n /usr/bin/security delete-certificate -Z "$fingerprint" "$system_keychain" ||
      echo "::warning::未能从运行器移除临时公钥证书。"
  fi
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
# The runner needs a trust anchor to sign with a self-signed certificate.
sudo -n /usr/bin/security add-trusted-cert -d -r trustRoot -p codeSign -k "$system_keychain" "$certificate"
runner_trust_added=true

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
EIZHU_MAC_SELF_SIGN_CERT_SHA1="$fingerprint" node scripts/smoke-package.mjs "$installer" --duration=60000
