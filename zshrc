ZSH=$HOME/.oh-my-zsh

ZSH_THEME="avit"

plugins=(git rails ruby git-flow vagrant)

source $ZSH/oh-my-zsh.sh

source ~/.dotfiles/zsh-functions
source ~/.dotfiles/zsh-aliases
source ~/.dotfiles/zsh-hooks

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

unsetopt correct_all
eval `dircolors ~/.dotfiles/colors/solarized`
export EDITOR='vim'

export TERM=xterm-256color
