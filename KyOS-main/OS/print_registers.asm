;;; print_registers.asm
;;; basic register value printing routines

print_registers:
    pusha
    mov word [REG_STRING+2], 'dx'   ; restore original REG_STRING
    
    mov si, REG_STRING
    call print_string
    call print_hex                  ; prints dx

    mov byte [REG_STRING+2], 'a'
    call print_string
    mov dx, ax
    call print_hex                  ; prints ax

    mov byte [REG_STRING+2], 'b'
    call print_string
    mov dx, ax
    call print_hex                  ; prints bx

    mov byte [REG_STRING+2], 'c'
    call print_string
    mov dx, ax
    call print_hex                  ; prints cx

    mov word [REG_STRING+2], 'si'
    call print_string
    mov dx, si
    call print_hex                  ; prints si

    mov byte [REG_STRING+2], 'd'
    call print_string
    mov dx, di
    call print_hex                  ; prints di

    mov word [REG_STRING+2], 'cs'
    call print_string
    mov dx, cs
    call print_hex                  ; prints cs

    mov byte [REG_STRING+2], 'd'
    call print_string
    mov dx, ds
    call print_hex                  ; prints ds

    mov byte [REG_STRING+2], 'e'
    call print_string
    mov dx, es
    call print_hex                  ; prints es

    popa
    ret

    include "print_string.asm"

REG_STRING: db 0xA, 0xD, 'dx        ', 0