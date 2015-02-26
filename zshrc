ZSH=$HOME/.oh-my-zsh

ZSH_THEME="agnoster"

plugins=(git rails ruby git-flow vagrant)

source $ZSH/oh-my-zsh.sh

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:~/.dotfiles/bin

if [ -d ~/.dotfiles/zsh.conf ]; then
	for conf_file in `ls ~/.dotfiles/zsh.conf`; do
		source ~/.dotfiles/zsh.conf/$conf_file
	done
	if [ -d ~/.dotfiles/zsh.conf/custom ]; then
		for custom_conf_file in `ls ~/.dotfiles/zsh.conf/custom`; do
			source ~/.dotfiles/zsh.conf/custom/$custom_conf_file
		done
	fi
fi

unsetopt correct_all
# eval `dircolors ~/.dotfiles/colors/solarized`
export EDITOR='vim'

export TERM=xterm-256color
