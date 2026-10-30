#!/usr/bin/env bash
set -euo pipefail

# AI AGENT SAFETY: Do not execute this script unless the repository owner has
# explicitly authorized publishing this exact version to this exact repository.
# Creating or reviewing this script is not authorization. This script publishes
# a release tag externally and must never be used for development/coding pushes.
#
# Human release use: only publish a stable release version to kinemi-app/Kinemi.
# This script pushes a tag only; it does not push a branch or use a configured
# coding-repository remote.

readonly OFFICIAL_REPOSITORY='https://github.com/kinemi-app/Kinemi.git'

usage() {
  cat <<'EOF'
Usage: scripts/publish-official-release.sh vMAJOR.MINOR.PATCH

Publishes an existing, clean, stable release tag to kinemi-app/Kinemi after an
interactive confirmation. The tag must match package.json and point at HEAD.
The repository owner must authorize this exact publication before the script
is run. Development branches and the coding repository are not valid targets.
EOF
}

fail() {
  printf 'Refusing to publish: %s\n' "$1" >&2
  exit 1
}

if [[ "${1:-}" == '--help' || "${1:-}" == '-h' ]]; then
  usage
  exit 0
fi

[[ $# -eq 1 ]] || { usage >&2; exit 2; }
release_tag=$1
[[ "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || \
  fail 'the version must be a stable tag in vMAJOR.MINOR.PATCH form.'

[[ -t 0 && -t 1 ]] || fail 'an interactive terminal is required for owner confirmation.'

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || \
  fail 'run this from inside the coding repository checkout.'
cd "$repo_root"

[[ -f package.json ]] || fail 'package.json is missing from the repository root.'
package_version=$(node -p "require('./package.json').version") || \
  fail 'could not read the package version.'
[[ "$release_tag" == "v$package_version" ]] || \
  fail "$release_tag does not match package.json version $package_version."

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  fail 'the working tree must be clean before release publication.'
fi

git show-ref --verify --quiet "refs/tags/$release_tag" || \
  fail "local release tag $release_tag does not exist."
tag_commit=$(git rev-parse "refs/tags/$release_tag^{commit}")
head_commit=$(git rev-parse HEAD)
[[ "$tag_commit" == "$head_commit" ]] || \
  fail "tag $release_tag must point at the checked-out HEAD."

# Internal planning and local-only paths never reach the public release.
# `TODO.md`, `todo/` and `AGENTS.md` are local work, never release source. `docs/` holds the
# human docs, which ship; the research docs inside it are refused through `.gitignore`, which names
# each of them. `.gitignore` is allowed: this repository's own rules match it (`/.gitignore`
# inside `.gitignore`), so the check below would otherwise refuse a release that carries it.
is_internal_path() {
  [[ "$1" == '.gitignore' ]] && return 1
  case "$1" in
    TODO.md|todo|todo/*|AGENTS.md|\
      .env|.env*.local|temp|temp/*|wl-copy|tests/screenshots|tests/screenshots/*)
      return 0
      ;;
  esac
  git check-ignore --no-index --quiet -- "$1"
}

while IFS= read -r release_path; do
  if is_internal_path "$release_path"; then
    fail "the release contains internal path '$release_path'; remove it from the release commit first."
  fi
done < <(git ls-tree -r --name-only "$tag_commit")

printf '\nTarget repository: %s\nRelease tag:       %s\nCommit:            %s\n' \
  "$OFFICIAL_REPOSITORY" "$release_tag" "$tag_commit"
printf '\nThe owner must already have explicitly approved this exact release.\n'
printf 'To continue, type: PUBLISH %s to kinemi-app/Kinemi\n> ' "$release_tag"
IFS= read -r confirmation
[[ "$confirmation" == "PUBLISH $release_tag to kinemi-app/Kinemi" ]] || \
  fail 'the confirmation did not match.'

remote_tag=$(git ls-remote --tags "$OFFICIAL_REPOSITORY" \
  "refs/tags/$release_tag" "refs/tags/$release_tag^{}") || \
  fail 'could not inspect the official repository; no push was attempted.'
[[ -z "$remote_tag" ]] || \
  fail "tag $release_tag already exists in the official repository; refusing to replace it."

git push "$OFFICIAL_REPOSITORY" "refs/tags/$release_tag:refs/tags/$release_tag"
printf 'Published release tag %s to kinemi-app/Kinemi.\n' "$release_tag"
