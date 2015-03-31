# vim:ft=zsh ts=2 sw=2 sts=2
#
# agnoster's Theme - https://gist.github.com/3712874
# A Powerline-inspired theme for ZSH
#
# # README
#
# In order for this theme to render correctly, you will need a
# [Powerline-patched font](https://github.com/Lokaltog/powerline-fonts).
#
# In addition, I recommend the
# [Solarized theme](https://github.com/altercation/solarized/) and, if you're
# using it on Mac OS X, [iTerm 2](http://www.iterm2.com/) over Terminal.app -
# it has significantly better color fidelity.
#
# # Goals
#
# The aim of this theme is to only show you *relevant* information. Like most
# prompts, it will only show git information when in a git working directory.
# However, it goes a step further: everything from the current user and
# hostname to whether the last call exited with an error to whether background
# jobs are running in this shell will all be displayed automatically when
# appropriate.

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

		if [[ "$(git status 2> /dev/null | grep ahead | awk '{print $8;}')" != "" ]]; then
			ahead=" ⍆"
		fi

		if [[ "$(git stash list)" != "" ]]; then
			stash=" ︷"
		fi

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

# Battery widget for Mac
rprompt_battery() {
	if [[ "$OSTYPE" = darwin* ]]; then
		local smart_battery_status="$(ioreg -rc "AppleSmartBattery")"
		local plugged charge symbol

		typeset -F maxcapacity=$(echo $smart_battery_status | grep '^.*"MaxCapacity"\ =\ ' | sed -e 's/^.*"MaxCapacity"\ =\ //')
		typeset -F currentcapacity=$(echo $smart_battery_status | grep '^.*"CurrentCapacity"\ =\ ' | sed -e 's/^.*CurrentCapacity"\ =\ //')
		plugged=$(echo $smart_battery_status | grep '^.*"ExternalConnected"\ =\ ' | sed -e 's/^.*"ExternalConnected"\ =\ //')
		integer charge=$(((currentcapacity/maxcapacity) * 100))

		if [[ $plugged != "Yes" ]]; then
			symbol='🔋 '
		else
			symbol="🔌 "
		fi

		if [[ $charge -gt 50 ]]; then
			color='green'
		elif [[ $charge -gt 25 ]]; then
			color='yellow'
		else
			color='red'
		fi

		if [[ $color != 'red' ]]; then
			bar=${(l.($charge/10)..━.)}${(l.(10-$charge/10)..┄.)}
		else
			bar="$charge%%"
		fi

		rprompt_segment $color black "$symbol $bar"
	fi
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

build_rprompt() {
	rprompt_battery
	rprompt_end
}

PROMPT='%{%f%b%k%}$(build_prompt) '
RPROMPT='$(build_rprompt)'
