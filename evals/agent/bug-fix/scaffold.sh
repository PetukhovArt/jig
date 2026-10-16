#!/usr/bin/env bash
set -euo pipefail
case_dir="$(cd "$(dirname "$0")" && pwd)"
evals_dir="$(cd "$case_dir/../.." && pwd)"
source_dir="$case_dir"
toolchain="$evals_dir/_toolchain/node_modules"
if [ ! -d "$toolchain" ]; then
  echo "missing $toolchain: run npm run eval:prepare in the jig repo" >&2
  exit 1
fi
shopt -s dotglob
for entry in "$evals_dir/_fixture-base"/*; do
  if [ "$(basename "$entry")" != node_modules ]; then
    cp -r "$entry" .
  fi
done
cp -r "$source_dir/fixture/." .
link_toolchain() {
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      MSYS=winsymlinks:nativestrict ln -s "$toolchain" node_modules 2>/dev/null ||
        MSYS2_ARG_CONV_EXCL='*' cmd /c mklink /J node_modules "$(cygpath -w "$toolchain")" >/dev/null 2>&1
      ;;
    *)
      ln -s "$toolchain" node_modules 2>/dev/null
      ;;
  esac
}
link_toolchain || cp -r "$toolchain" node_modules
git init -q -b main
git add -A
git -c user.email=eval@jig -c user.name=eval commit -qm base
