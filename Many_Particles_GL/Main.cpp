#include <iostream>
#include <cstdlib>
#include "MainFrame.h"

int main(int argc, char** argv) {
	std::string title("Opengl - Many Particles");
	MainFrame* mainframe = new MainFrame(title);
	if (mainframe == nullptr)
		exit(-1);


	delete mainframe;
	return 0;
}