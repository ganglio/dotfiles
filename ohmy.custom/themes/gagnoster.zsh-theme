#!/bin/zsh
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
source ~/.dotfiles/ohmy.custom/themes/colors.zsh-theme

export ZSH_THEME_TERM_TITLE_IDLE="%~"

### Prompt components
# Each component will draw itself, and hide itself if no information needs to be shown

# Context: user@hostname (who am I and where am I)
prompt_context() {
	if [[ ( "$USER" != "root" && "$USER" != "$DEFAULT_USER" ) || ( -n "$SSH_CLIENT" && "$USER" != "vagrant" && "$USER" != "$DEFAULT_USER" ) || ( "$SUDO_USER" != "$DEFAULT_USER" && -n "$SUDO_USER" ) ]]; then
		prompt_segment $duotone_uno_03 $duotone_low_01 "%(!.%{%F{yellow}%}.)$USER@%m"
	fi
}

# Checks if there are pending git actions (aheads and stashes)
parse_git_pending() {
	pending=()

	upstream=$(git rev-parse --symbolic-full-name --abbrev-ref @{upstream} 2> /dev/null)
	current_commit_hash=$(git rev-parse HEAD 2> /dev/null)

	has_upstream=0
	[[ -n "${upstream}" && "${upstream}" != "@{upstream}" ]] && has_upstream=1

	if [[ $has_upstream -gt 0 ]]; then

		commits_diff="$(git log --pretty=oneline --topo-order --left-right ${current_commit_hash}...${upstream} 2> /dev/null)"
		commits_ahead=$(grep -c "^<" <<< $commits_diff)
		commits_behind=$(grep -c "^>" <<< $commits_diff)
		number_of_stashes=$(git stash list -n1 2> /dev/null | wc -l | bc)


		[[ $commits_behind -gt 0 ]]    && pending+=" ${commits_behind}⍅"
		[[ $commits_ahead -gt 0 ]]     && pending+=" ${commits_ahead}⍆"
		[[ $number_of_stashes -gt 0 ]] && pending+=" ${number_of_stashes}"
		echo $pending
	fi
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
			prompt_segment $duotone_duo_04 $duotone_low_01
		elif [[ -n $pending ]]; then
			prompt_segment $duotone_extra $duotone_low_01
		else
			prompt_segment $duotone_uno_06 $duotone_low_01
		fi

		if [[ -e "${repo_path}/BISECT_LOG" ]]; then
			mode=" <B>"
		elif [[ -e "${repo_path}/MERGE_HEAD" ]]; then
			mode=" >M<"
		elif [[ -e "${repo_path}/rebase" || -e "${repo_path}/rebase-apply" || -e "${repo_path}/rebase-merge" || -e "${repo_path}/../.dotest" ]]; then
			mode=" >R>"
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
		echo -n "${ref/refs\/heads\// }${vcs_info_msg_0_%% }${mode}${pending}"
	fi
}

# Dir: current working directory
prompt_dir() {
	prompt_segment $duotone_uno_04 $duotone_low_01 '%2c'
}

# Shows Running Vagrant Machines
prompt_vagrant() {
	# check if there are any runnign vagrants
	vmc=$(ps ax | grep '[V]BoxHeadless' | wc -l)
	if [ $vmc -gt 0 ]; then
		vagrants=$(echo -n ${(l:${vmc}::ᐯ:)})
		[[ -n "$vagrants" ]] && prompt_segment $duotone_uno_05 $duotone_low_01 $vagrants
	else
		if [[ -f /var/log/dmesg ]]; then # we are on linux
			invm=$(cat /var/log/dmesg | grep -i paravirtualized | grep -i "bare hardware" | wc -l)
			if [ $invm -gt 0 ]; then # and we are inside a VM
				prompt_segment $duotone_uno_05 $duotone_low_01 "ᐱ"
			fi
		fi
	fi


}

# Status:
# - was there an error
# - am I root
# - are there background jobs?
prompt_status() {
	local symbols
	symbols=()
	[[ $RETVAL -ne 0 ]] && symbols+="%{%F{$duotone_duo_01}%}"
	[[ $UID -eq 0 ]] && symbols+="%{%F{$duotone_uno_06}%}"

	BGJOBS=$(jobs -l | wc -l)
	[[ $BGJOBS -gt 0 ]] && symbols+="%{%F{cyan}%}"${(l:${BGJOBS}:::)}

	[[ -n "$symbols" ]] && prompt_segment $duotone_uno_01 $duotone_low_01 "$symbols"
}

function prompt_info() {
	local symbols
	symbols=()

	# ssh
	[[ -n "$SSH_CLIENT" ]] && symbols+=""

	# marks
	local marks_found
	marks_found=0
	if [[ -d ~/.marks ]]; then
		for mark in $(ls -l ~/.marks | awk -F " -> " '{print $2}'); do
			[[ $(pwd | grep $mark | wc -l) -gt 0 ]] && let marks_found=$marks_found+1
		done
		[[ $marks_found -gt 0 ]] && symbols+=""
	fi

	# direnv
	type direnv 2>&1 > /dev/null
	if [[ $? -eq 0 ]]; then
		is_enved=$(direnv status 2>/dev/null | grep "Found" | wc -l)
		[[ $is_enved -gt 0 ]] && symbols+=""
	fi

	type docker 2>&1 > /dev/null
	if [[ $? -eq 0 ]]; then
		dockerps=$(docker ps -a 2>/dev/null)
		is_dockered=$(echo $dockerps | tail -n+2 | wc -l | bc)
		docker_up=$(echo $dockerps | grep "Up" | wc -l | bc)
		docker_created=$(echo $dockerps | grep "Created" | wc -l | bc)
		docker_exit=$(echo $dockerps | grep "Exited" | wc -l | bc)
		[[ $docker_up -gt 0 ]] && symbols+=${(l:${docker_up}:::)}
		[[ $docker_created -gt 0 ]] && symbols+="%{%F{blue}%}"${(l:${docker_created}:::)}
		[[ $docker_exit -gt 0 ]] && symbols+="%{%F{red}%}"${(l:${docker_exit}:::)}
	fi

	[[ -n "$symbols" ]] && prompt_segment cyan $duotone_low_01 "$symbols"
}

## Main prompt
build_prompt() {
	RETVAL=$?
	prompt_status
	prompt_info
	prompt_context
	prompt_dir
	prompt_vagrant
	prompt_git
	prompt_end
}

rprompt_itunes() {
	itunes_running=$(ps ax | grep "[i]Tunes$" | wc -l)
	type osascript 2>&1 > /dev/null
	if [[ $? -eq 0 && itunes_running -gt 0 ]]; then
		state=$(osascript -e 'tell application "iTunes" to player state as string')
		if [ $state = 'playing' ]; then
			artist=$(osascript -e 'tell application "iTunes" to artist of current track as string' 2> /dev/null)
			track=$(osascript -e 'tell application "iTunes" to name of current track as string' 2> /dev/null)
			short_track=$track[1,15]
			[[ ${#track} -gt ${#short_track} ]] && short_track=$short_track"…"
			[[ -n $short_track && -n $artist ]] && rprompt_segment $duotone_extra $duotone_low_01 "  $artist - $short_track"
		fi
	fi
}

rprompt_tmuxes() {
	local tmuxes
	tmuxes=$(tmux list-sessions 2> /dev/null | grep -v "attached" | wc -l | bc)
	[[ $tmuxes -gt 0 ]] && rprompt_segment $duotone_duo_04 $duotone_low_01 "  $tmuxes"
}

rprompt_rbenv() {
	type rbenv 2>&1 > /dev/null
	if [[ $? -eq 0 ]]; then
		version=$(rbenv local 2> /dev/null)
		[[ -n "$version" ]] && rprompt_segment $duotone_duo_03 $duotone_low_01 "  $version"
	fi
}

rprompt_pyenv() {
	type pyenv 2>&1 > /dev/null
	if [[ $? -eq 0 ]]; then
		version=$(pyenv local 2>/dev/null | tr "\n" "+" | sed "s/\+$//g")
		[[ -n "$version" ]] && rprompt_segment $duotone_duo_02 $duotone_low_01 "  $version"
	fi
}

rprompt_githash() {
	hh=$(git log --pretty=format:'%h' -n 1 2> /dev/null)
	[[ -n "$hh" ]] && rprompt_segment $duotone_duo_01 $duotone_low_01 " $hh"
}

rprompt_temp() {
	tt=$(sysctl machdep.xcpm.cpu_thermal_level | awk '{print $2}')
	[[ -n "$tt" ]] && rprompt_segment $duotone_duo_01 $duotone_low_01 "🌡  $tt"
}

build_rprompt() {
	if [[ $COLUMNS -gt 100 ]]; then
		rprompt_githash
		rprompt_pyenv
		rprompt_rbenv
		# rprompt_tmuxes
		rprompt_itunes
		rprompt_end
	fi
}

PROMPT='%{%f%b%k%}$(build_prompt)%{%f%b%k%}  '
RPROMPT='%{%f%b%k%}$(build_rprompt)%{%f%b%k%}'
