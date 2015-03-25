set t_Co=256
hi CursorLine   cterm=BOLD ctermbg=235 ctermfg=NONE guibg=235 guifg=NONE
set cursorline!
set backspace=2
syn on
set nu
set tabstop=2
set noexpandtab
set list
set listchars=tab:——,trail:·
highlight MyTabs ctermbg=NONE ctermfg=235
match MyTabs /\t/
" colorscheme slate
au BufReadPost Vagrantfile set syntax=ruby
