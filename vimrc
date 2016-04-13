" Start Bundle
set nocompatible
filetype off
set rtp+=~/.vim/bundle/Vundle.vim
call vundle#begin()

Plugin 'VundleVim/Vundle.vim'
Plugin 'sheerun/vim-polyglot'
Plugin 'mattn/emmet-vim'

call vundle#end()
filetype plugin indent on
" End Bundle

source ~/.vim/duocolors.viml

set t_Co=256
hi CursorLine     cterm=BOLD ctermbg=003 ctermfg=NONE guibg=003 guifg=NONE
hi CursorColumn   cterm=BOLD ctermbg=003 ctermfg=NONE guibg=003 guifg=NONE
set cursorline! cursorcolumn!
set backspace=2
syn on
set number
set relativenumber
set scrolloff=8
set tabstop=2
set shiftwidth=2
set noexpandtab
set list
set listchars=tab:\|\ ,trail:·
highlight MyTabs ctermbg=NONE ctermfg=003
match MyTabs /\t/

au BufReadPost Vagrantfile set syntax=ruby

set wildmenu

vnoremap > ><CR>gv
vnoremap < <<CR>gv

set noswapfile
set nobackup
set nowb

set encoding=utf-8
autocmd InsertLeave * if expand('%') != '' | update | endif

silent !mkdir ~/.vim_backups > /dev/null 2>&1
set undodir=~/.vim_backups
set undofile
