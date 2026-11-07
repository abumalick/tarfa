#!/bin/sh
# tarfa-cli-wrapper (managed by tarfa): written by `tarfa setup` and `tarfa apply`, replaced when
# it differs. Runs the installed @tarfa/cli from the caller's own folder, so `tarfa spawn .` means
# the caller's project, whatever mise config that folder holds.
#
# The install and its node are looked up from $HOME: a mise shim would take the caller's folder's
# mise.toml, which dies with a trust error in an untrusted folder and runs Tarfa under that
# project's node in a trusted one.
set -u

mise_bin=""
for candidate in "$HOME/.local/bin/mise" /opt/homebrew/bin/mise /usr/local/bin/mise; do
  if [ -x "$candidate" ]; then
    mise_bin="$candidate"
    break
  fi
done
if [ -z "$mise_bin" ]; then
  mise_bin="$(command -v mise 2>/dev/null || true)"
fi

if [ -n "$mise_bin" ]; then
  install="$("$mise_bin" --cd "$HOME" where npm:@tarfa/cli 2>/dev/null || true)"
  node_home="$("$mise_bin" --cd "$HOME" where node 2>/dev/null || true)"
  if [ -n "$install" ] && [ -n "$node_home" ] && [ -x "$node_home/bin/node" ] && [ -f "$install/bin/tarfa" ]; then
    exec "$node_home/bin/node" "$install/bin/tarfa" "$@"
  fi
fi

# No mise, or it knows no install: the next tarfa on PATH that is not this file.
if [ -n "${TARFA_CLI_WRAPPER:-}" ]; then
  echo "tarfa: no installed @tarfa/cli found (mise use -g npm:@tarfa/cli)" >&2
  exit 1
fi
TARFA_CLI_WRAPPER=1
export TARFA_CLI_WRAPPER
old_ifs="$IFS"
IFS=:
for dir in $PATH; do
  candidate="${dir:-.}/tarfa"
  if [ -f "$candidate" ] && [ -x "$candidate" ] && ! [ "$candidate" -ef "$0" ]; then
    IFS="$old_ifs"
    exec "$candidate" "$@"
  fi
done
IFS="$old_ifs"
echo "tarfa: no installed @tarfa/cli found (mise use -g npm:@tarfa/cli)" >&2
exit 1
