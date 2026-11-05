;;; kernel.asm
;;; basic kernel functions

	;; clear screen
	call cls
	;; print banner
	call print_banner

	;; Get user input
get_input:
	mov di, CMD_INPUT_STRING	; di now points to input string location
keyloop:

	mov ah, 0x00				
	int 0x16					; BIOS get keystroke interrupt, character goes into al
	
	;; character printing handled locally from now
	mov ah, 0x0e				; BIOS teletype output
	cmp al, 0xD					; al has the character -> is it enter?
	je run_command
	int 0x10					; display inputted character
	mov [di], al				; store inputted character to CMD_INPUT_STRING
	inc di
	jmp keyloop					; again

run_command:
	;; print newline after inputted command
	mov si, NEWLINE
	call print_string

	mov byte [di], 0			; null termiate command input string
	mov al, [CMD_INPUT_STRING]
	cmp al, 'H'
	je help_command
	cmp al, 'D'
	je list_dir
	cmp al, 'Q'
	je quit_command
	cmp al, 'R'
	je reboot
	cmp al, 'M'
	je back_to_menu
	cmp al, 'P'
	je list_registers
	cmp al, 'G'
	je graphics_mode
	jmp command_not_found

help_command:
	mov si, HELP_STRING
	call print_string
	jmp get_input

list_dir:
	call cls
	;; load filetable location into ES:BX
	;; incrementing bx to loop through characters of file
	xor cx, cx					; set counter to 0
	mov bx, 0x1000
	mov es, bx					; set es indirectly through bx
	xor bx, bx					; set bx to 0
	mov ah, 0x0e				; BIOS teletype output

list_dir_loop:				
	mov al, [es:bx]
	cmp al, 0x7d				; back curly braces
	je end_list_dir				; it signals the end of the file
	int 0x10
	add bx, 1
	jmp list_dir_loop

end_list_dir:
	mov si, NEWLINE
	call print_string			; newline before back to input
	jmp get_input

back_to_menu:
	call cls
	call print_banner
	jmp get_input

list_registers:
	mov si, REG_HEADER_BANNER
	call print_string
	call print_registers
	jmp get_input

graphics_mode:
	call cls_gfx
	call draw_rect_gfx

	hlt							; halt for now

command_not_found:
	mov si, COMMAND_NOT_FOUND_STRING
	call print_string
	jmp get_input

reboot:
	jmp 0xffff:0x0000			; far jump to reset vector

quit_command:
	mov si, QUIT_PROMPT
	call print_string

	cli							; clear interrupts
	hlt                         ; halt cpu

	;; include print_registers only because it already includes print_string
	;; include print_gfx (graphics)
	include "print_registers.asm"
	include "print_gfx.asm"

	;; Variables

WELCOME_STRING:	db '---------------', 0xA, 0xD,\
				   'Welcome to kOS!', 0xA, 0xD,\
				   '---------------', 0xA, 0xD, 0xA, 0xD, 0
OPTIONS_STRING: db '*** MENU ***', 0xA, 0xD,\
				   '------------', 0xA, 0xD,\
				   '(H)elp', 0xA, 0xD,\
				   '(M)enu', 0xA, 0xD,\
				   '(D)irectory', 0xA, 0xD,\
				   '(P)rint regs', 0xA, 0xD,\
				   '(G)raphics mode', 0xA, 0xD,\
				   '(R)eboot', 0xA, 0xD,\
				   '(Q)uit', 0xA, 0xD,\
				   '------------', 0xA, 0xD, 0

NEWLINE:			db 0xA, 0xD, 0
CMD_FAILURE_STRING:	db 'No such command!', 0xA, 0xD, 0
CMD_INPUT_STRING: 	db ''			; init memory to store inputted command string to
HELP_STRING:		db 'Help menu', 0xA, 0xD, 0
COMMAND_NOT_FOUND_STRING:	db 'Command not found!', 0xA, 0xD, 0
REG_HEADER_BANNER:	db 'Register  Mem addr', 0xA, 0xD,\
					   '--------  --------', 0xA, 0xD, 0
QUIT_PROMPT:		db 'Quitting...', 0xA, 0xD, 0

	times 1024-($-$$) db 0	    ; pad file with 0-s
