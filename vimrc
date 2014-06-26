set t_Co=256
hi CursorLine   cterm=NONE ctermbg=235 ctermfg=NONE guibg=235 guifg=NONE
set cursorline!
syn on
set nu
set tabstop=2
set noexpandtab
set list
set listchars=tab:——,trail:·
highlight MyTabs ctermbg=NONE ctermfg=237
match MyTabs /\t/
