#!/usr/bin/env bash
# Vexel installer for notebook VMs (Google Colab, Kaggle, Paperspace...).
#
#   bash tools/install_notebook.sh [vexel-dir]
#
# Installs Node >= 18 and Rust if missing, then installs the `vexel`
# CLI globally so later notebook cells can just call `!vexel ...`.
# Idempotent: safe to re-run in the same session.
set -euo pipefail

say() { printf '\n==> %s\n' "$*"; }

case "$(uname -s)" in
  Linux) ;;
  *) say "This helper targets Linux notebook VMs (Colab/Kaggle)."; exit 1 ;;
esac

# --- locate or clone the vexel source --------------------------------
if [ $# -ge 1 ]; then
  VEXEL_DIR="$1"
else
  SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
  if [ -f "$SCRIPT_DIR/../package.json" ]; then
    VEXEL_DIR="$SCRIPT_DIR/.."
  else
    VEXEL_DIR="vexel"
  fi
fi

if [ ! -f "$VEXEL_DIR/package.json" ]; then
  say "cloning https://github.com/coolgamer203695-cyber/vexel"
  git clone --depth 1 https://github.com/coolgamer203695-cyber/vexel.git "$VEXEL_DIR"
fi
cd "$VEXEL_DIR"

# --- Node >= 18 (official tarball lands in /usr/local/bin, which every
#     notebook cell sees; apt's node is too old on Ubuntu 22.04) --------
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  if [ "$NODE_MAJOR" -ge 18 ]; then NODE_OK=1; fi
fi
if [ "$NODE_OK" -eq 1 ]; then
  say "Node $(node -v) already available"
else
  say "installing Node 20 (official tarball)"
  case "$(uname -m)" in
    x86_64)          NODE_ARCH=x64 ;;
    aarch64 | arm64) NODE_ARCH=arm64 ;;
    *) echo "unsupported architecture: $(uname -m)"; exit 1 ;;
  esac
  NODE_VER=v20.18.0
  TMP=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-$NODE_ARCH.tar.xz" -o "$TMP/node.tar.xz"
  if [ "$(id -u)" -eq 0 ] || [ -w /usr/local ]; then
    tar -xJf "$TMP/node.tar.xz" -C /usr/local --strip-components=1
  else
    mkdir -p "$HOME/.local"
    tar -xJf "$TMP/node.tar.xz" -C "$HOME/.local" --strip-components=1
    mkdir -p "$HOME/bin"
    ln -sf "$HOME/.local/bin/node" "$HOME/bin/node"
    ln -sf "$HOME/.local/bin/npm"  "$HOME/bin/npm"
    ln -sf "$HOME/.local/bin/npx"  "$HOME/bin/npx"
    say "note: add \$HOME/bin to PATH if node is not found"
  fi
  rm -rf "$TMP"
  hash -r
fi
node -v
npm -v

# --- Rust (rustup gives the current stable, same as upstream dev) -----
if command -v rustc >/dev/null 2>&1 && command -v cargo >/dev/null 2>&1; then
  say "Rust already available: $(rustc --version)"
else
  say "installing Rust (rustup, minimal profile)"
  if curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path; then
    # Symlink the shims into /usr/local/bin: later notebook cells run
    # non-interactive shells that never read ~/.cargo/env.
    for b in rustc cargo rustup; do
      if [ -f "$HOME/.cargo/bin/$b" ]; then
        ln -sf "$HOME/.cargo/bin/$b" "/usr/local/bin/$b" 2>/dev/null || true
      fi
    done
  else
    say "rustup failed; falling back to apt"
    apt-get update -qq
    apt-get install -y -qq rustc cargo
  fi
fi
rustc --version

# --- the vexel CLI itself --------------------------------------------
say "installing the vexel CLI (npm install -g .)"
npm install -g .
hash -r

# --- self-test --------------------------------------------------------
say "self-test"
vexel version
TEST_DIR=$(mktemp -d)
printf 'print "vexel works on this VM!"\n' > "$TEST_DIR/hello.vxl"
say "compiling hello.vxl - the FIRST compile is silent and can take
     30-90s on notebook VMs (cold rustc cache). Let it finish."
START=$(date +%s)
if ! timeout 300 vexel run "$TEST_DIR/hello.vxl"; then
  echo ""
  echo "self-test failed or timed out after 300s."
  echo "Check manually:  !vexel run $TEST_DIR/hello.vxl"
  exit 1
fi
say "self-test passed in $(($(date +%s) - START))s (warm runs are much faster)"
rm -rf "$TEST_DIR"

say "done - try:  !vexel run vexel/main.vxl"
