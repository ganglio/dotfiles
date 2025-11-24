#!/bin/zsh

source ~/.dotfiles/update.sh

ZSH=$HOME/.oh-my-zsh
ZSH_CUSTOM=$HOME/.dotfiles/ohmy.custom
ZSH_PYENV_QUIET=true

ZSH_THEME="gagnoster"

plugins=(git jump docker pyenv direnv brew)

for plg in $(ls ~/.dotfiles/ohmy.custom/plugins); do
	plugins+=($plg)
done

source $ZSH/oh-my-zsh.sh

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:~/.dotfiles/bin

if [ -d ~/.dotfiles/zsh.conf ]; then
	for conf_file in `ls ~/.dotfiles/zsh.conf`; do
		source ~/.dotfiles/zsh.conf/$conf_file
	done
	if [ -d ~/.dotfiles/zsh.conf/custom ]; then
		for custom_conf_file in `ls ~/.dotfiles/zsh.conf/custom`; do
			[[ "$custom_conf_file" != ".gitignore" ]] && source ~/.dotfiles/zsh.conf/custom/$custom_conf_file
		done
	fi
	if [ -d ~/.dotfiles/zsh.conf/completions ]; then
		for custom_completions in $(ls ~/.dotfiles/zsh.conf/completions); do
			source ~/.dotfiles/zsh.conf/completions/$custom_completions
		done
	fi
fi

unsetopt correct_all
export EDITOR='vim'

export TERM=xterm-256color

export LSCOLORS=fxDxcxdxFxegedabagacad

export PATH=$PATH:$HOME/.dotfiles/bin
direnv reload 2> /dev/null || true
