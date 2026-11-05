gcc -ffreestanding -c ckernel.c -o ckernel.o
if [ $? -ne 0 ]; then
	echo "failed to generate object file!"
	exit
fi
ld -o ckernel.bin -Ttext 0x0 --oformat binary ckernel.o
if [ $? -ne 0 ]; then
	echo "failed to link object file into binary!"
	exit
fi

echo "Done"
