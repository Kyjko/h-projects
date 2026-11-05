echo "Compiling bootsect.asm..."
fasm bootsect.asm
echo "Compiling filetable.asm..."
fasm filetable.asm
echo "Compiling kernel.asm..."
fasm kernel.asm
echo "Making os.bin..."
cat bootsect.bin filetable.bin kernel.bin > os.bin
echo "Done."
