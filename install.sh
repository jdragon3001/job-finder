#!/bin/sh
# Job Finder installer (macOS / Linux). Re-run any time to update: profile/, data/ and .env are never touched.
#   curl -fsSL https://raw.githubusercontent.com/jdragon3001/job-finder/main/install.sh | sh
set -e
REPO="jdragon3001/job-finder"
DIR="${JOB_FINDER_DIR:-$HOME/job-finder}"
RT="$DIR/.runtime"
export PATH="$RT/bin:$RT/node/bin:$HOME/.local/bin:$PATH"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "Downloading Job Finder to $DIR"
mkdir -p "$DIR" "$RT/bin"
curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.tar.gz" | tar -xz -C "$DIR" --strip-components=1

if ! node -e "require('node:sqlite')" >/dev/null 2>&1; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) P=darwin-arm64 ;; Darwin-x86_64) P=darwin-x64 ;;
    Linux-x86_64) P=linux-x64 ;; Linux-aarch64 | Linux-arm64) P=linux-arm64 ;;
    *) echo "Unsupported system: $(uname -sm)"; exit 1 ;;
  esac
  say "Installing Node (private copy, no admin needed)"
  F=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | awk "/-$P\\.tar\\.gz\$/{print \$2}")
  rm -rf "$RT/node" && mkdir -p "$RT/node"
  curl -fsSL "https://nodejs.org/dist/latest-v24.x/$F" | tar -xz -C "$RT/node" --strip-components=1
fi

# ponytail: scripts are stdlib-only and pass on 3.9, so any system python3 >= 3.9 is enough
if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
  say "Installing Python (private copy)"
  curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$RT/bin" sh >/dev/null
  "$RT/bin/uv" python install 3.12 >/dev/null
  ln -sf "$("$RT/bin/uv" python find 3.12)" "$RT/bin/python3"
fi

if ! command -v claude >/dev/null 2>&1; then
  say "Installing Claude Code"
  curl -fsSL https://claude.ai/install.sh | bash
fi
if ! claude auth status --json 2>/dev/null | grep -q '"loggedIn": *true'; then
  say "Log in to Claude (uses your own Claude subscription)"
  claude auth login </dev/tty
fi

say "Building the app (a minute or two)"
cd "$DIR"
for f in profile.yaml facts.md; do [ -f "profile/$f" ] || cp "profile/${f%.*}.example.${f##*.}" "profile/$f"; done
npm ci --omit=dev --no-audit --no-fund --loglevel=error
npm run build >/dev/null

# .command opens in Terminal when double-clicked in Finder; Linux file managers run .sh files
START="$DIR/Start Job Finder.command"; [ "$(uname -s)" = Darwin ] || START="$DIR/start.sh"
cat >"$START" <<EOF
#!/bin/sh
export PATH="$RT/bin:$RT/node/bin:\$HOME/.local/bin:\$PATH"
cd "$DIR"
(sleep 4; open http://localhost:3456 2>/dev/null || xdg-open http://localhost:3456) >/dev/null 2>&1 &
exec npm start
EOF
chmod +x "$START"

say "Done. Double-click '$(basename "$START")' in $DIR to run it."
echo "First, fill in $DIR/profile/ (profile.yaml, facts.md, resume.docx, cover.docx) — see README.md."
if [ "$(uname -s)" = Darwin ]; then open "$DIR"; fi
