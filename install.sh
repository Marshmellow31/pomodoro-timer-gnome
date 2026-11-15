#!/usr/bin/env bash
# Install, link or remove the Pomodoro Timer GNOME Shell extension.
#
#   ./install.sh              copy the extension into ~/.local/share/gnome-shell/extensions
#   ./install.sh --link       symlink instead (handy while developing)
#   ./install.sh --uninstall  remove it
set -euo pipefail

UUID="pomodoro-timer@local"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/$UUID"
DEST_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
DEST="$DEST_ROOT/$UUID"

case "${1:-}" in
  --uninstall)
    gnome-extensions disable "$UUID" 2>/dev/null || true
    rm -rf "$DEST"
    echo "Removed $UUID"
    exit 0
    ;;
  ""|--link) ;;
  *) echo "Usage: $0 [--link|--uninstall]" >&2; exit 2 ;;
esac

command -v glib-compile-schemas >/dev/null || {
  echo "glib-compile-schemas not found (install libglib2.0-bin or glib2)." >&2
  exit 1
}

glib-compile-schemas "$SRC/schemas"
mkdir -p "$DEST_ROOT"
rm -rf "$DEST"

if [ "${1:-}" = "--link" ]; then
  ln -s "$SRC" "$DEST"
  echo "Linked $DEST -> $SRC"
else
  cp -r "$SRC" "$DEST"
  echo "Copied to $DEST"
fi

if gnome-extensions enable "$UUID" 2>/dev/null; then
  echo "Enabled $UUID."
else
  echo "Could not enable yet: the shell has not discovered it."
fi
echo "Log out and back in (needed on Wayland), then run: gnome-extensions enable $UUID"
