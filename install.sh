#!/bin/bash

echo "Cloning dotfiles"
git clone https://github.com/ganglio/dotfiles.git .dotfiles

echo "Cloning oh-my-zsh"
git clone https://github.com/robbyrussell/oh-my-zsh.git ~/.oh-my-zsh

echo "Creating backup files"
cp ~/.zshrc ~/.zshrc.orig
cp ~/.zcompdump ~/.zcompdump.orig

echo "Creating symlinks"
ln -s ~/.dotfiles/zshrc ~/.zshrc
ln -s ~/.dotfiles/vimrc ~/.vimrc
ln -s ~/.dotfiles/vim ~/.vim
ln -s ~/.dotfiles/tmux.conf ~/.tmux.conf