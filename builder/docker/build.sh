#!/usr/bin/env bash

set -o errexit
set -o nounset

target_dir="${1:?First argument must be the target directory}"

cd "${target_dir}"
echo "Starting build in $(pwd)"

set -x
eval $(fnm env --shell bash)
pnpm install --frozen-lockfile --force
pnpm build
