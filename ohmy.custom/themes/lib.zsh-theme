#!/bin/zsh

CURRENT_BG='NONE'
SEGMENT_SEPARATOR=''
SEGMENT_SEPARATOR_SAME=''
RCURRENT_BG='NONE'
RSEGMENT_SEPARATOR=''
RSEGMENT_SEPARATOR_SAME=''

# Begin a segment
# Takes two arguments, background and foreground. Both can be omitted,
# rendering default background/foreground.

if [[ -n $IS_TMUX_STATUS ]]; then # this is TMUX
	prompt_segment() {
		local bg fg
		[[ -n $1 ]] && bg="#[bg=$1]" || bg="#[bg=default]"
		[[ -n $2 ]] && fg="#[fg=$2]" || fg="#[fg=default]"
		if [[ $CURRENT_BG != 'NONE' && $1 != $CURRENT_BG ]]; then
			echo -n " $bg#[fg=$CURRENT_BG]$SEGMENT_SEPARATOR$fg "
		elif [[ $1 == $CURRENT_BG ]]; then
			echo -n " $bg#[fg=$2]$SEGMENT_SEPARATOR_SAME$fg "
		else
			echo -n "$bg$fg "
		fi
		CURRENT_BG=$1
		[[ -n $3 ]] && echo -n $3
	}

	# End the prompt, closing any open segments
	prompt_end() {
		if [[ -n $CURRENT_BG ]]; then
			echo -n " #[bg=default]#[fg=$CURRENT_BG]$SEGMENT_SEPARATOR"
		else
			echo -n "#[bg=default]"
		fi
		echo -n "#[fg=default]"
		CURRENT_BG=''
	}

	# renders a right prompt segment
	rprompt_segment() {
		local bg fg
		[[ -n $1 ]] && bg="#[bg=$1]" || bg="#[bg=default]"
		[[ -n $2 ]] && fg="#[fg=$2]" || fg="#[fg=default]"
		if [[ $RCURRENT_BG != 'NONE' && $1 != $RCURRENT_BG ]]; then
			echo -n " #[fg=$1]#[bg=$RCURRENT_BG]$RSEGMENT_SEPARATOR"
		elif [[ $1 == $RCURRENT_BG ]]; then
			echo -n " #[fg=$2]#[bg=$RCURRENT_BG]$RSEGMENT_SEPARATOR_SAME"
		else
			echo -n "#[fg=$1]$RSEGMENT_SEPARATOR"
		fi
		echo -n "$fg$bg $3"

		RCURRENT_BG=$1
	}

	# End the prompt, closing any open segments
	rprompt_end() {
		if [[ -n $RCURRENT_BG ]]; then
			echo -n "#[fg=default]#[bg=$RCURRENT_BG] "
		else
			echo -n "#[fg=default]"
		fi
		echo -n "#[bg=default]"
		RCURRENT_BG=''
	}

else # this is a shell

	# Renders a left prompt segment
	prompt_segment() {
		local bg fg
		[[ -n $1 ]] && bg="%K{$1}" || bg="%k"
		[[ -n $2 ]] && fg="%F{$2}" || fg="%f"
		if [[ $CURRENT_BG != 'NONE' && $1 != $CURRENT_BG ]]; then
			echo -n " %{$bg%F{$CURRENT_BG}%}$SEGMENT_SEPARATOR%{$fg%} "
		elif [[ $1 == $CURRENT_BG ]]; then
			echo -n " %{$bg%F{$2}%}$SEGMENT_SEPARATOR_SAME%{$fg%} "
		else
			echo -n "%{$bg%}%{$fg%} "
		fi
		CURRENT_BG=$1
		[[ -n $3 ]] && echo -n $3
	}

	# End the prompt, closing any open segments
	prompt_end() {
		if [[ -n $CURRENT_BG ]]; then
			echo -n " %{%k%F{$CURRENT_BG}%}$SEGMENT_SEPARATOR"
		else
			echo -n "%{%k%}"
		fi
		echo -n "%{%f%}"
		CURRENT_BG=''
	}

	# renders a right prompt segment
	rprompt_segment() {
		local bg fg
		[[ -n $1 ]] && bg="%K{$1}" || bg="%k"
		[[ -n $2 ]] && fg="%F{$2}" || fg="%f"
		if [[ $RCURRENT_BG != 'NONE' && $1 != $RCURRENT_BG ]]; then
			echo -n " %F{$1}%K{$RCURRENT_BG}$RSEGMENT_SEPARATOR"
		elif [[ $1 == $RCURRENT_BG ]]; then
			echo -n " %F{$2}#K{$RCURRENT_BG}$RSEGMENT_SEPARATOR_SAME"
		else
			echo -n "%F{$1}$RSEGMENT_SEPARATOR"
		fi
		echo -n "%{$fg%}%{$bg%} $3"

		RCURRENT_BG=$1
	}

	# End the prompt, closing any open segments
	rprompt_end() {
		if [[ -n $RCURRENT_BG ]]; then
			echo -n "%{%f%K{$RCURRENT_BG}%} "
		else
			echo -n "%{%f%}"
		fi
		echo -n "%{%k%}"
		RCURRENT_BG=''
	}

fi
