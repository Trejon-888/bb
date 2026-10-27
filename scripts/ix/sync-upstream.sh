#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
target="${1:-origin/main}"
upstream_remote="${IX_UPSTREAM_REMOTE:-origin}"
fork_remote="${IX_FORK_REMOTE:-fork}"
branch="${IX_BRANCH:-ix}"

echo "== fetching $upstream_remote"
git fetch --tags "$upstream_remote"
if [ "$(git branch --show-current)" != "$branch" ]; then
  git checkout "$branch"
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is dirty; commit or stash first" >&2
  exit 1
fi
base_before="$(git merge-base "$branch" "$target")"
echo "== rebasing $branch onto $target (patch series: $(git rev-list --count "$base_before".."$branch") commits)"
if ! git rebase "$target"; then
  echo
  echo "rebase stopped; conflicts in:"
  git diff --name-only --diff-filter=U
  echo "resolve, then: git rebase --continue && scripts/ix/sync-upstream.sh $target"
  exit 2
fi
echo "== markers"
scripts/ix/check-markers.sh
echo "== install"
pnpm install --frozen-lockfile >/dev/null
echo "== typecheck"
pnpm exec turbo run typecheck --filter=@bb/server --filter=@bb/app --filter=@get-bb/plugin-sdk
echo "== tests"
pnpm exec turbo run test --filter=@bb/server --filter=@get-bb/plugin-sdk
version="$(node -e 'console.log(require("./packages/bb-app/package.json").version)')"
echo
echo "synced $branch onto $target (bb-app $version)."
echo "next: git tag -a ix-v$version -m 'ix patch on bb $version' && git push --force-with-lease $fork_remote $branch && git push $fork_remote ix-v$version"
