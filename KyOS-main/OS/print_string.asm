;; print_string.asm
;; contains string printing functions and hex printing functions


VID_MEM = 0xb800		; video memory address
W_B = 0x0f			; white on black

	;;; These routines are not using any BIOS interrupts
p_print_string:
	pusha
	mov bx, VID_MEM

p_print_string_loop:
	mov al, [si]		; store value pointed by si to al
	mov ah, W_B			; color => ax now has the character and color
	cmp al, 0
	je p_endwrite
	mov [bx], ax		; store character with color to vidmem

	add si, 1
	add bx, 2
	jmp p_print_string_loop

p_endwrite:
	popa
	ret

	;;; These routines are using BIOS interrupts

print_string:
	pusha
	mov ah, 0x0e		; BIOS teletype output
	mov bh, 0x0			; page number
	mov bl, 0x07		; color (only works in graphics mode)

print_string_loop:

	mov al, [si]		; same as lodsb
	cmp al, 0
	je endwrite
	int 0x10
	add si, 1
	jmp print_string_loop

endwrite:
	popa
	ret

cls:
	pusha
	;; Set video mode
	mov ah, 0x00		        ; int 0x10 / ah 0x00 => set video mode
	mov al, 0x03		        ; 80x25 text mode, 16 colors
	int 0x10
	
	;; changle color/palette
	mov ah, 0x08
	mov bh, 0x00				; change background
	mov bl, 0x01				; blue background
	int 0x10

	popa
	ret

print_banner:
	pusha
	mov si, WELCOME_STRING	    ; store string address in bx
	call print_string
	
	mov si, OPTIONS_STRING
	call print_string

	popa
	ret

				;; print_hex
print_hex:
    pusha
    xor cx, cx

hex_loop:
    cmp cx, 4               ; end of loop?
    je end_hex_loop

    mov ax, dx
    and ax, 0x000f          ; only retain first 4 bits
    add al, 0x30            ; get ascii number value by default
    cmp al, 0x39            ; is hex value 0-9 (<= 0x30) or A-F (> 0x39)?
    jle move_into_bx
    add al, 0x7             ; to get ascii A-F

move_into_bx:
    mov bx, HEX_STRING+5    ; base address of HEX_STRING + length of string 
                            ; (with null termiator)
    sub bx, cx
    mov [bx], al
    ror dx, 4               ; right rotate dx by 4
    add cx, 1
    jmp hex_loop

end_hex_loop:
    mov si, HEX_STRING
    call print_string

    popa
    ret

HEX_STRING:    db '0x0000', 0