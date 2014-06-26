#!/bin/bash

echo "Cloning dotfiles"
git clone git@github.com:ganglio/dotfiles.git .dotfiles

echo "Cloning oh-my-zsh"
git clone git://github.com/robbyrussell/oh-my-zsh.git ~/.oh-my-zsh

echo "Creating symlinks"
ln -s ~/.dotfiles/zshrc ~/.zshrc
ln -s ~/.dotfiles/vimrc ~/.vimrc
ln -s ~/.dotfiles/vim ~/.vim
ln -s ~/.dotfiles/tmux.conf ~/.tmux.conf