;;; bootsect.asm
;;; loads kernel into memory

	org 0x7c00				; origin of BOOT code, neccessary for addresses to be valid

	;; READ FILETABLE INTO MEMORY
	;; set up ES:BX memory address/segment:offset to load sector(s) into
	mov bx, 0x1000			; load sector to memory address 0x1000
	mov es, bx				; es is now 0x1000
	mov bx, 0x0				; ES:BX = 0x1000:0		; xor bx, bx

	;; set up disk read
	mov dh, 0x0			; head 0
	mov dl, 0x0			; drive 0
	mov ch, 0x0			; cylinder 0
	mov cl, 0x02		; starting sector to read from disk, right after the bootsector

read_disk_filetable:
	mov ah, 0x02		; BIOS interrupt for disk read code
	mov al, 0x01		; read 1 sector
	int 0x13			; BIOS interrupt
	jc read_disk_filetable		; retry if error

	;; READ KERNEL INTO MEMORY
	;; set up ES:BX memory address/segment:offset to load sector(s) into
	mov bx, 0x2000
	mov es, bx
	mov bx, 0x0				; ES:BX = 0x2000:0

	;; set up disk read
	mov dh, 0x0			; head 0
	mov dl, 0x0			; drive 0
	mov ch, 0x0			; cylinder 0
	mov cl, 0x03		; starting sector to read from disk, right after the filetable

read_disk_kernel:
	mov ah, 0x02
	mov al, 0x02		; read 2 sectors
	int 0x13
	jc read_disk_kernel	; retry if error

reset_sr_jump:
	;; reset segment registers for RAM and jump into kernel
	mov ax, 0x2000
	mov ds, ax			; data segment
	mov es, ax			; extra segment
	mov fs, ax			; some extra stuff
	mov gs, ax			; -""-
	mov ss, ax			; stack segment

	jmp 0x2000:0x0		; far jump to kernel (0x2000:0x0)

	;; pad file
	times 510-($-$$) db 0	; pad file with 0-s

	dw 0xaa55				; magic number	
