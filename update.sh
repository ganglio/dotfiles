#!/bin/zsh

source ~/.dotfiles/zsh.conf/functions

lastupdated=$(cat ~/.dotfiles/.lastupdated 2> /dev/null)

oldpwd=$(pwd)

if [[ ( -z "$lastupdated" ) || ( "$lastupdated" -lt $(date +"%s-(7*86400)" | bc) ) ]]; then
	vared -p 'DotFiles: Do you want to check for updates? (Y/n) >' -c check
	if [[ ( "$check" != "n" ) && ( "$check" != "N" ) ]]; then
		echo "Updating..."
		cd ~/.dotfiles
		git pull origin master
		git submodule foreach git pull origin master
		cd $oldpwd
		date +%s > ~/.dotfiles/.lastupdated
		echo "Done! Happy commandlining :D"
		dotbanner
	fi
fi
