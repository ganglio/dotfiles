ZSH=$HOME/.oh-my-zsh

ZSH_THEME="avit"

plugins=(git rails ruby git-flow vagrant)

source $ZSH/oh-my-zsh.sh

if [ -d ~/.dotfiles/zsh.conf ]; then
	for conf_file in `ls ~/.dotfiles/zsh.conf`; do
		source ~/.dotfiles/zsh.conf/$conf_file
	done
fi

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

unsetopt correct_all
eval `dircolors ~/.dotfiles/colors/solarized`
export EDITOR='vim'

export TERM=xterm-256color
