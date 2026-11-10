#!/bin/bash
# Links the AI agents configuration from the dotfiles into the places the
# agents read from. Safe to re-run: run it again after adding or removing a skill.
#
#   pi/models.json, pi/settings.json, pi/pi-jefferson.json -> ~/.pi/agent/
#   agents/skills/<name>/            -> ~/.agents/skills/<name>  (pi, other agents)
#                                    -> ~/.claude/skills/<name>  (Claude Code)
#
# Anything real (not a symlink) that is in the way is moved aside, not deleted.

set -eu

dotfiles="${DOTFILES:-$HOME/.dotfiles}"
now=$(date +%Y%m%d-%H%M%S)

link() {
	local src="$1" dst="$2"
	mkdir -p "$(dirname "$dst")"
	if [ -e "$dst" ] && [ ! -L "$dst" ]; then
		mv "$dst" "$dst.orig.$now"
		echo "  moved aside: $dst -> $dst.orig.$now"
	fi
	ln -sfn "$src" "$dst"
	echo "  linked: $dst -> $src"
}

echo "Linking pi configuration"
for f in models.json settings.json pi-jefferson.json; do
	link "$dotfiles/pi/$f" "$HOME/.pi/agent/$f"
done

echo "Linking skills"
shopt -s nullglob
skill_targets=("$HOME/.agents/skills" "$HOME/.claude/skills")

for dir in "$dotfiles"/agents/skills/*/; do
	dir="${dir%/}"
	[ -f "$dir/SKILL.md" ] || continue
	for target in "${skill_targets[@]}"; do
		link "$dir" "$target/$(basename "$dir")"
	done
done

# Drop links to skills that were removed from the dotfiles
for target in "${skill_targets[@]}"; do
	for l in "$target"/*; do
		if [ -L "$l" ] && [ ! -e "$l" ]; then
			case "$(readlink "$l")" in
				"$dotfiles"/agents/skills/*) rm "$l" && echo "  removed stale link: $l" ;;
			esac
		fi
	done
done
