cls_gfx:
	pusha

	mov ah, 0x00				; set video mode
	mov al, 0x13				; graphics mode
	int 0x10

	popa
	ret

draw_rect_gfx:
    pusha

    mov ah, 0x0c				; write gfx pixel
	mov al, 0xa				    ; light green	
	mov bh, 0x00				; page #

	mov cx, 0x64				; column # (100 in decimal)
	mov dx, 0x64				; row #
	int 0x10

col_loop:
    inc cx                      ; increment col
    int 0x10                    ; draw pixel
    cmp cx, 150                 ; 150 is the max col
    jne col_loop
row_loop:
    inc dx
    mov cx, 99                  ; reset col back to 100-1=99
    cmp dx, 150                 ; 150 is the max row
    jne col_loop

    popa
    ret