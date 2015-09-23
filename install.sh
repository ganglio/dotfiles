#!/bin/bash

now=$(date +%Y%m%d-%H%M%S)

echo "Creating backup files"
[ -f ~/.zshrc ] && cp ~/.zshrc ~/.zshrc.orig.$now
[ -f ~/.vimrc ] && cp ~/.vimrc ~/.vimrc.orig.$now
[ -f ~/.tmux.conf ] && cp ~/.tmux.conf ~/.tmux.conf.orig.$now
[ -f ~/.zcompdump ] && cp ~/.zcompdump ~/.zcompdump.orig.$now

[ -d ~/.dotfiles ] && mv ~/.dotfiles ~/.dotfiles.orig-$now
[ -d ~/.oh-my-zsh ] && mv ~/.oh-my-zsh ~/.oh-my-zsh.orig.$now
[ -d ~/.vim ] && mv ~/.vim ~/.vim.orig-$now

echo "Cloning dotfiles"
git clone https://github.com/ganglio/dotfiles.git ~/.dotfiles

echo "Cloning oh-my-zsh"
git clone https://github.com/robbyrussell/oh-my-zsh.git ~/.oh-my-zsh

echo "Creating symlinks"
ln -s ~/.dotfiles/zshrc ~/.zshrc
ln -s ~/.dotfiles/vimrc ~/.vimrc
ln -s ~/.dotfiles/vim ~/.vim
ln -s ~/.dotfiles/tmux.conf ~/.tmux.conf

# Initialising the autoupdate script
date +%s > ~/.dotfiles/.lastupdated

echo "Done! Happy commandlining :D"
