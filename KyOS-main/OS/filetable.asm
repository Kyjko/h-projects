;;; filetable.asm 
;;; basic fiel table
;;; structure: {<filename>-<sector#>, <filename>-<sector#>...}

db '{program1-04, program2-06}'

    ;; sector padding
    times 512-($-$$) db 0