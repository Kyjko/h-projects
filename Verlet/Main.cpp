#include <iostream>
#include <SDL.h>
#include "Scene.h"

int main(int argc, char** argv) {
	
	Scene* scene = new Scene("Scene 1");
	scene->Loop();

	delete scene;

	return 0;
}