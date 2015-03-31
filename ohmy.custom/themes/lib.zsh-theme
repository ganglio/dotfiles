#!/bin/zsh

CURRENT_BG='NONE'
SEGMENT_SEPARATOR=''
RCURRENT_BG='NONE'
RSEGMENT_SEPARATOR=''

# Begin a segment
# Takes two arguments, background and foreground. Both can be omitted,
# rendering default background/foreground.
prompt_segment() {
        local bg fg
        [[ -n $1 ]] && bg="%K{$1}" || bg="%k"
        [[ -n $2 ]] && fg="%F{$2}" || fg="%f"
        if [[ $CURRENT_BG != 'NONE' && $1 != $CURRENT_BG ]]; then
                echo -n " %{$bg%F{$CURRENT_BG}%}$SEGMENT_SEPARATOR%{$fg%} "
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

# Right prompt. If any

rprompt_segment() {
        local bg fg
        [[ -n $1 ]] && bg="%K{$1}" || bg="%k"
        [[ -n $2 ]] && fg="%F{$2}" || fg="%f"
        # if [[ $RCURRENT_BG != 'NONE' && $1 != $RCURRENT_BG ]]; then
        #       echo -n " %{$bg%F{$RCURRENT_BG}%}$RSEGMENT_SEPARATOR%{$fg%} "
        # else
        #       echo -n " %{$bg%}%{$fg%} "
        # fi
        # echo $mex
        # RCURRENT_BG=$1
        if [[ $RCURRENT_BG != 'NONE' && $1 != $RCURRENT_BG ]]; then
                echo -n " %F{$1}%K{$RCURRENT_BG}$RSEGMENT_SEPARATOR"
        else
                echo -n "%F{$1}$RSEGMENT_SEPARATOR"
        fi
        echo -n "%{$fg%}%{$bg%} $3"

        RCURRENT_BG=$1
}

rprompt_end() {
        if [[ -n $RCURRENT_BG ]]; then
                echo -n "%{%f%K{$RCURRENT_BG}%} "
        else
                echo -n "%{%f%}"
        fi
        echo -n "%{%k%}"
        RCURRENT_BG=''
}
