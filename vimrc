set t_Co=256
hi CursorLine     cterm=BOLD ctermbg=235 ctermfg=NONE guibg=235 guifg=NONE
hi CursorColumn   cterm=BOLD ctermbg=235 ctermfg=NONE guibg=235 guifg=NONE
set cursorline! cursorcolumn!
set backspace=2
syn on
set nu
set tabstop=2
set shiftwidth=2
set noexpandtab
set list
set listchars=tab:——,trail:·
highlight MyTabs ctermbg=NONE ctermfg=235
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
