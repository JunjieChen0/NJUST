#!/bin/sh
# NJUST_AI CLI Installer
# Usage: curl -fsSL https://github.com/NJUST-AI/NJUST_AI/releases/latest/download/install.sh | sh
#
# Environment variables:
#   NJUST_AI_INSTALL_DIR   - Installation directory (default: ~/.njust-ai/cli)
#   NJUST_AI_BIN_DIR       - Binary symlink directory (default: ~/.local/bin)
#   NJUST_AI_VERSION       - Specific version to install (default: latest)

set -e

# Configuration
INSTALL_DIR="${NJUST_AI_INSTALL_DIR:-$HOME/.njust-ai/cli}"
BIN_DIR="${NJUST_AI_BIN_DIR:-$HOME/.local/bin}"
REPO="NJUST-AI/NJUST_AI"
MIN_NODE_VERSION=20

# Color output (only if terminal supports it)
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    BOLD=''
    NC=''
fi

info() { printf "${GREEN}==>${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}Warning:${NC} %s\n" "$1"; }
error() { printf "${RED}Error:${NC} %s\n" "$1" >&2; exit 1; }

# Check Node.js version
check_node() {
    if ! command -v node >/dev/null 2>&1; then
        error "Node.js is not installed. Please install Node.js $MIN_NODE_VERSION or higher.

Install Node.js:
  - macOS: brew install node
  - Linux: https://nodejs.org/en/download/package-manager
  - Or use a version manager like fnm, nvm, or mise"
    fi

    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -lt "$MIN_NODE_VERSION" ]; then
        error "Node.js $MIN_NODE_VERSION+ required. Found: $(node -v)

Please upgrade Node.js to version $MIN_NODE_VERSION or higher."
    fi

    info "Found Node.js $(node -v)"
}

# Detect OS and architecture
detect_platform() {
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)

    case "$OS" in
        darwin) OS="darwin" ;;
        linux) OS="linux" ;;
        mingw*|msys*|cygwin*)
            error "Windows is not supported by this installer. Please use WSL or install manually."
            ;;
        *) error "Unsupported OS: $OS" ;;
    esac

    case "$ARCH" in
        x86_64|amd64) ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *) error "Unsupported architecture: $ARCH" ;;
    esac

    PLATFORM="${OS}-${ARCH}"
    info "Detected platform: $PLATFORM"
}

# Get latest release version or use specified version
get_version() {
    if [ -n "$NJUST_AI_VERSION" ]; then
        VERSION="$NJUST_AI_VERSION"
        info "Using specified version: $VERSION"
        return
    fi

    info "Fetching latest version..."

    # Try to get the latest cli release
    RELEASES_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases" 2>/dev/null) || {
        error "Failed to fetch releases from GitHub. Check your internet connection."
    }

    # Extract highest cli-v* tag by semantic version (do not rely on API ordering)
    VERSION=$(printf "%s" "$RELEASES_JSON" | node -e '
const fs = require("fs")
const input = fs.readFileSync(0, "utf8")
let releases
try {
  releases = JSON.parse(input)
} catch {
  process.exit(1)
}

function parseVersion(version) {
  const core = String(version).trim().split("+", 1)[0].split("-", 1)[0]
  if (!core) return null
  const parts = core.split(".")
  if (parts.length === 0 || parts.some((part) => !/^\d+$/.test(part))) {
    return null
  }
  return parts.map((part) => Number.parseInt(part, 10))
}

function compareVersions(a, b) {
  const maxLength = Math.max(a.length, b.length)
  for (let i = 0; i < maxLength; i++) {
    const aPart = a[i] ?? 0
    const bPart = b[i] ?? 0
    if (aPart > bPart) return 1
    if (aPart < bPart) return -1
  }
  return 0
}

let latestVersion = ""
let latestParts = null

if (Array.isArray(releases)) {
  for (const release of releases) {
    if (!release || typeof release.tag_name !== "string" || !release.tag_name.startsWith("cli-v")) {
      continue
    }
    const candidate = release.tag_name.slice("cli-v".length)
    const candidateParts = parseVersion(candidate)
    if (!candidateParts) continue
    if (!latestParts || compareVersions(candidateParts, latestParts) > 0) {
      latestVersion = candidate
      latestParts = candidateParts
    }
  }
}

if (latestVersion) {
  process.stdout.write(latestVersion)
}
')

    if [ -z "$VERSION" ]; then
        error "Could not find any CLI releases. The CLI may not have been released yet."
    fi

    info "Latest version: $VERSION"
}


# Download and extract
download_and_install() {
    TARBALL="njust-ai-cli-${PLATFORM}.tar.gz"

    # Create temp directory in install dir's parent to ensure same filesystem for atomic mv
    INSTALL_PARENT=$(dirname "$INSTALL_DIR")
    mkdir -p "$INSTALL_PARENT"
    TMP_DIR=$(mktemp -d "$INSTALL_PARENT/.njust-ai-install-XXXXXX")
    trap 'rm -rf "$TMP_DIR"' EXIT

    # Download and parse manifest (unified with TS upgrader)
    MANIFEST_URL="https://github.com/$REPO/releases/download/cli-v${VERSION}/cli-manifest.json"
    info "Fetching manifest from $MANIFEST_URL..."

    if ! curl -fsSL "$MANIFEST_URL" -o "$TMP_DIR/cli-manifest.json" 2>/dev/null; then
        error "Failed to download CLI manifest. Cannot proceed."
    fi

    # Parse and validate manifest (unified with TS upgrader)
    EXPECTED_FILENAME="njust-ai-cli-${PLATFORM}.tar.gz"
    EXPECTED_URL="https://github.com/$REPO/releases/download/cli-v${VERSION}/${EXPECTED_FILENAME}"
    ARTIFACT_INFO=$(VERSION="$VERSION" PLATFORM="$PLATFORM" MANIFEST_PATH="$TMP_DIR/cli-manifest.json" \
        EXPECTED_FILENAME="$EXPECTED_FILENAME" EXPECTED_URL="$EXPECTED_URL" \
        node -e '
const fs = require("fs");
const { VERSION, PLATFORM, MANIFEST_PATH, EXPECTED_FILENAME, EXPECTED_URL } = process.env;

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

// Validate manifest version
if (manifest.version !== VERSION) {
  console.error("Manifest version mismatch: expected " + VERSION + ", got " + manifest.version);
  process.exit(1);
}

// Validate publishedAt (must be a valid ISO date string)
if (!manifest.publishedAt || isNaN(Date.parse(manifest.publishedAt))) {
  console.error("Manifest publishedAt is missing or invalid");
  process.exit(1);
}

const artifact = manifest.artifacts[PLATFORM];
if (!artifact) {
  console.error("No artifact for platform " + PLATFORM);
  process.exit(1);
}

// Validate artifact.platform matches the key
if (artifact.platform !== PLATFORM) {
  console.error("Artifact platform mismatch: key says " + PLATFORM + ", artifact says " + artifact.platform);
  process.exit(1);
}

// Validate filename (prevent path traversal)
if (artifact.filename !== EXPECTED_FILENAME) {
  console.error("Filename mismatch: expected " + EXPECTED_FILENAME + ", got " + artifact.filename);
  process.exit(1);
}
if (artifact.filename.includes("..") || artifact.filename.includes("/")) {
  console.error("Filename contains path traversal characters");
  process.exit(1);
}

// Validate URL (strict equality with expected URL)
if (artifact.url !== EXPECTED_URL) {
  console.error("URL mismatch: expected " + EXPECTED_URL + ", got " + artifact.url);
  process.exit(1);
}
if (!artifact.url.startsWith("https://")) {
  console.error("URL must be HTTPS");
  process.exit(1);
}

// Validate size (positive integer, < 500MB)
if (!Number.isInteger(artifact.size) || artifact.size <= 0) {
  console.error("Invalid size: must be positive integer");
  process.exit(1);
}
if (artifact.size > 500 * 1024 * 1024) {
  console.error("Size exceeds 500MB limit");
  process.exit(1);
}

// Validate SHA-256 (64 lowercase hex characters)
if (!/^[0-9a-f]{64}$/.test(artifact.sha256)) {
  console.error("Invalid SHA-256 format");
  process.exit(1);
}

console.log(JSON.stringify({
  url: artifact.url,
  filename: artifact.filename,
  size: artifact.size,
  sha256: artifact.sha256
}));
') || error "Failed to parse or validate manifest"

    URL=$(echo "$ARTIFACT_INFO" | node -e "const d=require('fs').readFileSync(0,'utf8');console.log(JSON.parse(d).url)")
    TARBALL=$(echo "$ARTIFACT_INFO" | node -e "const d=require('fs').readFileSync(0,'utf8');console.log(JSON.parse(d).filename)")
    EXPECTED_SIZE=$(echo "$ARTIFACT_INFO" | node -e "const d=require('fs').readFileSync(0,'utf8');console.log(JSON.parse(d).size)")
    EXPECTED_SHA256=$(echo "$ARTIFACT_INFO" | node -e "const d=require('fs').readFileSync(0,'utf8');console.log(JSON.parse(d).sha256)")

    info "Downloading from $URL..."

    # Download with progress indicator
    HTTP_CODE=$(curl -fsSL -w "%{http_code}" "$URL" -o "$TMP_DIR/$TARBALL" 2>/dev/null) || {
        if [ "$HTTP_CODE" = "404" ]; then
            error "Release not found for platform $PLATFORM version $VERSION.

Available at: https://github.com/$REPO/releases"
        fi
        error "Download failed. HTTP code: $HTTP_CODE"
    }

    # Verify we got something
    if [ ! -s "$TMP_DIR/$TARBALL" ]; then
        error "Downloaded file is empty. Please try again."
    fi

    # Verify file size matches manifest
    ACTUAL_SIZE=$(wc -c < "$TMP_DIR/$TARBALL" | tr -d ' ')
    if [ "$ACTUAL_SIZE" != "$EXPECTED_SIZE" ]; then
        error "File size mismatch: expected $EXPECTED_SIZE bytes, got $ACTUAL_SIZE bytes"
    fi
    info "File size verified: $ACTUAL_SIZE bytes"

    # Verify checksum using sha256 from manifest
    if command -v sha256sum >/dev/null 2>&1; then
        ACTUAL_HASH=$(sha256sum "$TMP_DIR/$TARBALL" | cut -d' ' -f1)
    elif command -v shasum >/dev/null 2>&1; then
        ACTUAL_HASH=$(shasum -a 256 "$TMP_DIR/$TARBALL" | cut -d' ' -f1)
    else
        error "Neither sha256sum nor shasum is available. Verification cannot proceed."
    fi

    if [ "$ACTUAL_HASH" != "$EXPECTED_SHA256" ]; then
        error "Checksum mismatch!
Expected: $EXPECTED_SHA256
Actual:   $ACTUAL_HASH

The downloaded file may be corrupted or tampered with."
    fi
    info "✓ Checksum verified"

    # Path traversal check: inspect tarball contents before extraction
    info "Checking tarball contents for path traversal..."
    UNSAFE_PATHS=$(tar -tzf "$TMP_DIR/$TARBALL" | grep -E '(^/|\.\./)' || true)
    if [ -n "$UNSAFE_PATHS" ]; then
        error "Tarball contains unsafe paths (absolute or ..):\n$UNSAFE_PATHS"
    fi

    # Create staging directory for atomic swap
    STAGING_DIR="$TMP_DIR/staging"
    mkdir -p "$STAGING_DIR"

    # Extract to staging directory
    info "Extracting to staging directory..."
    tar -xzf "$TMP_DIR/$TARBALL" -C "$STAGING_DIR" --strip-components=1 || {
        error "Failed to extract tarball. The download may be corrupted."
    }

    # Save ripgrep binary before npm install (npm install will overwrite node_modules)
    RIPGREP_BIN=""
    if [ -f "$STAGING_DIR/node_modules/@vscode/ripgrep/bin/rg" ]; then
        RIPGREP_BIN="$TMP_DIR/rg"
        cp "$STAGING_DIR/node_modules/@vscode/ripgrep/bin/rg" "$RIPGREP_BIN"
    fi

    # Install npm dependencies in staging directory
    info "Installing dependencies..."
    cd "$STAGING_DIR"
    npm install --production --ignore-scripts --silent 2>/dev/null || {
        warn "npm install failed, trying with --legacy-peer-deps..."
        npm install --production --ignore-scripts --legacy-peer-deps --silent 2>/dev/null || {
            error "Failed to install dependencies. Make sure npm is available."
        }
    }
    cd - > /dev/null

    # Restore ripgrep binary after npm install
    if [ -n "$RIPGREP_BIN" ] && [ -f "$RIPGREP_BIN" ]; then
        mkdir -p "$STAGING_DIR/node_modules/@vscode/ripgrep/bin"
        cp "$RIPGREP_BIN" "$STAGING_DIR/node_modules/@vscode/ripgrep/bin/rg"
        chmod +x "$STAGING_DIR/node_modules/@vscode/ripgrep/bin/rg"
    fi

    # Make executable
    chmod +x "$STAGING_DIR/bin/njust-ai"

    # Also make ripgrep executable if it exists
    if [ -f "$STAGING_DIR/bin/rg" ]; then
        chmod +x "$STAGING_DIR/bin/rg"
    fi

    # Atomic swap: backup old install -> move staging to install dir -> cleanup backup
    BACKUP_DIR="${INSTALL_DIR}.backup.$(date +%s)"
    if [ -d "$INSTALL_DIR" ]; then
        info "Backing up previous installation..."
        mv "$INSTALL_DIR" "$BACKUP_DIR"
    fi

    mkdir -p "$(dirname "$INSTALL_DIR")"

    if ! mv "$STAGING_DIR" "$INSTALL_DIR" 2>/dev/null; then
        warn "Failed to move staging directory to install location."
        if [ -d "$BACKUP_DIR" ]; then
            warn "Rolling back to previous installation..."
            mv "$BACKUP_DIR" "$INSTALL_DIR"
        fi
        error "Atomic swap failed. Previous installation restored."
    fi

    # Health check BEFORE cleanup — verify new binary runs and reports correct version
    if [ -x "$INSTALL_DIR/bin/njust-ai" ]; then
        info "Running health check..."
        ACTUAL_VERSION=$("$INSTALL_DIR/bin/njust-ai" --version 2>/dev/null) || ACTUAL_VERSION=""
        if [ -z "$ACTUAL_VERSION" ]; then
            warn "Health check failed — new binary does not run."
            if [ -d "$BACKUP_DIR" ]; then
                warn "Rolling back to previous installation..."
                rm -rf "$INSTALL_DIR"
                mv "$BACKUP_DIR" "$INSTALL_DIR"
                error "Installation failed health check. Previous version restored."
            else
                warn "Removing failed installation..."
                rm -rf "$INSTALL_DIR"
                error "Installation failed health check. Please retry."
            fi
        fi
        # Verify version matches expected target — failure triggers rollback
        if ! echo "$ACTUAL_VERSION" | grep -qF "$VERSION"; then
            warn "Version mismatch: expected $VERSION, got $ACTUAL_VERSION."
            if [ -d "$BACKUP_DIR" ]; then
                warn "Rolling back to previous installation..."
                rm -rf "$INSTALL_DIR"
                mv "$BACKUP_DIR" "$INSTALL_DIR"
                error "Installation version mismatch. Previous version restored."
            else
                warn "Removing failed installation..."
                rm -rf "$INSTALL_DIR"
                error "Installation version mismatch. Please retry."
            fi
        fi
        info "Health check passed ($ACTUAL_VERSION)."
    fi

    # Clean up backup on success
    if [ -d "$BACKUP_DIR" ]; then
        info "Cleaning up backup..."
        rm -rf "$BACKUP_DIR"
    fi
}

# Create symlink in bin directory
setup_bin() {
    mkdir -p "$BIN_DIR"

    # Remove old symlink if exists
    if [ -L "$BIN_DIR/njust-ai" ] || [ -f "$BIN_DIR/njust-ai" ]; then
        rm -f "$BIN_DIR/njust-ai"
    fi

    ln -sf "$INSTALL_DIR/bin/njust-ai" "$BIN_DIR/njust-ai"
    info "Created symlink: $BIN_DIR/njust-ai"
}

# Check if bin dir is in PATH and provide instructions
check_path() {
    case ":$PATH:" in
        *":$BIN_DIR:"*)
            # Already in PATH
            return 0
            ;;
    esac

    warn "$BIN_DIR is not in your PATH"
    echo ""
    echo "Add this line to your shell profile:"
    echo ""

    # Detect shell and provide specific instructions
    SHELL_NAME=$(basename "$SHELL")
    case "$SHELL_NAME" in
        zsh)
            echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc"
            echo "  source ~/.zshrc"
            ;;
        bash)
            if [ -f "$HOME/.bashrc" ]; then
                echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bashrc"
                echo "  source ~/.bashrc"
            else
                echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bash_profile"
                echo "  source ~/.bash_profile"
            fi
            ;;
        fish)
            echo "  set -Ux fish_user_paths $BIN_DIR \$fish_user_paths"
            ;;
        *)
            echo "  export PATH=\"$BIN_DIR:\$PATH\""
            ;;
    esac
    echo ""
}

# Verify installation (already done in download_and_install)
verify_install() {
    # Health check is now performed in download_and_install before backup cleanup.
    # This function only confirms the symlink is accessible.
    if [ -x "$BIN_DIR/njust-ai" ]; then
        info "Symlink verified: $BIN_DIR/njust-ai"
    else
        warn "Symlink exists but binary is not executable. Check permissions."
    fi
}

# Print success message
print_success() {
    echo ""
    printf "${GREEN}${BOLD}✓ NJUST_AI CLI installed successfully!${NC}\n"
    echo ""
    echo "  Installation: $INSTALL_DIR"
    echo "  Binary: $BIN_DIR/njust-ai"
    echo "  Version: $VERSION"
    echo ""
    echo "  ${BOLD}Get started:${NC}"
    echo "    njust-ai --help"
    echo ""
    echo "  ${BOLD}Example:${NC}"
    echo "    export OPENROUTER_API_KEY=sk-or-v1-..."
    echo "    cd ~/my-project && njust-ai \"What is this project?\""
    echo ""
}

# Main
main() {
    echo ""
    printf "${BLUE}${BOLD}"
    echo "  ╭─────────────────────────────────╮"
    echo "  │     NJUST_AI CLI Installer      │"
    echo "  ╰─────────────────────────────────╯"
    printf "${NC}"
    echo ""

    check_node
    detect_platform
    get_version
    download_and_install
    setup_bin
    check_path
    verify_install
    print_success
}

main "$@"
