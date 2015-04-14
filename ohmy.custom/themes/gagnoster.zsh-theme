# vim:ft=zsh ts=2 sw=2 sts=2
#
# gagnoster theme
# based on the fantastic agnoster one - https://gist.github.com/3712874
#
# # Features
#
# The prompt segment function as been generalised to work on both the prompt and on the TMUX status line.
# A rprompt segment function has been added to handle the right prompt.
# Exceptions have been added to properly handle two segments in a row with the same background.
# Added the pending actions status to the git prompt and removed the support for mercurial as I think is useless :P

source ~/.dotfiles/ohmy.custom/themes/lib.zsh-theme

### Prompt components
# Each component will draw itself, and hide itself if no information needs to be shown

# Context: user@hostname (who am I and where am I)
prompt_context() {
	if [[ "$USER" != "$DEFAULT_USER" || -n "$SSH_CLIENT" ]]; then
		prompt_segment black default "%(!.%{%F{yellow}%}.)$USER@%m"
	fi
}

# Checks if there are pending git actions (aheads and stashes)
parse_git_pending() {
	local pending
	pending=()
	[[ "$(git status 2> /dev/null | grep ahead | awk '{print $8;}')" != "" ]] && pending+='ahead'
	[[ "$(git stash list)" != "" ]] && pending+='stash'
	echo $pending
}

# Git: branch/detached head, dirty status
prompt_git() {
	local ref dirty mode repo_path
	repo_path=$(git rev-parse --git-dir 2>/dev/null)


	if $(git rev-parse --is-inside-work-tree >/dev/null 2>&1); then
		dirty=$(parse_git_dirty)
		pending=$(parse_git_pending)
		ref=$(git symbolic-ref HEAD 2> /dev/null) || ref="➦ $(git show-ref --head -s --abbrev |head -n1 2> /dev/null)"
		if [[ -n $dirty ]]; then
			prompt_segment yellow black
		elif [[ -n $pending ]]; then
			prompt_segment cyan black
		else
			prompt_segment green black
		fi

		if [[ -e "${repo_path}/BISECT_LOG" ]]; then
			mode=" <B>"
		elif [[ -e "${repo_path}/MERGE_HEAD" ]]; then
			mode=" >M<"
		elif [[ -e "${repo_path}/rebase" || -e "${repo_path}/rebase-apply" || -e "${repo_path}/rebase-merge" || -e "${repo_path}/../.dotest" ]]; then
			mode=" >R>"
		fi

		[[ "$(git status 2> /dev/null | grep ahead | awk '{print $8;}')" != "" ]] && ahead=" ⍆"

		[[ "$(git stash list)" != "" ]] && stash=" ︷"

		setopt promptsubst
		autoload -Uz vcs_info

		zstyle ':vcs_info:*' enable git
		zstyle ':vcs_info:*' get-revision true
		zstyle ':vcs_info:*' check-for-changes true
		zstyle ':vcs_info:*' stagedstr '✚'
		zstyle ':vcs_info:git:*' unstagedstr '●'
		zstyle ':vcs_info:*' formats ' %u%c'
		zstyle ':vcs_info:*' actionformats ' %u%c'
		vcs_info
		echo -n "${ref/refs\/heads\// }${vcs_info_msg_0_%% }${mode}${ahead}${stash}"
	fi
}

# Dir: current working directory
prompt_dir() {
	prompt_segment blue black '%~'
}

# Shows Running Vagrant Machines
prompt_vagrant() {
	vmc=$(ps ax | grep '[V]BoxHeadless' | wc -l)
	vagrants=$(echo -n ${(l:${vmc}::ᐯ:)})

	[[ -n "$vagrants" ]] && prompt_segment black cyan $vagrants
}

# Status:
# - was there an error
# - am I root
# - are there background jobs?
prompt_status() {
	local symbols
	symbols=()
	[[ $RETVAL -ne 0 ]] && symbols+="%{%F{red}%}✘"
	[[ $UID -eq 0 ]] && symbols+="%{%F{yellow}%}⚡"
	[[ $(jobs -l | wc -l) -gt 0 ]] && symbols+="%{%F{cyan}%}⚙"

	[[ -n "$symbols" ]] && prompt_segment black default "$symbols"
}

## Main prompt
build_prompt() {
	RETVAL=$?
	prompt_status
	prompt_context
	prompt_dir
	prompt_vagrant
	prompt_git
	prompt_end
}

build_rprompt() {}

PROMPT='%{%f%b%k%}$(build_prompt) %{%f%b%k%}'
RPROMPT='%{%f%b%k%}$(build_rprompt)%{%f%b%k%}'