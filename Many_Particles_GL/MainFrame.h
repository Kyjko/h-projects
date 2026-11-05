#pragma once

#include <cstdlib>
#include <iostream>
#include <SDL.h>
#include <glew.h>
#include "common.h"
#include "Scene.h"
#include "Log.h"

class MainFrame {
private:
	std::string title;
	SDL_Window* _w;
	SDL_Renderer* _r;
	SDL_GLContext _glctx;

	Scene* scene;

	float pax, pay;
	float amnt, amnt2;
	float upwards_accel;

	GLuint W, H;

	void GetScreenResolution();
	void EventLoop();
	void Render();
public:
	bool quit = false;
	MainFrame(std::string& t);
	errno_t Init(std::string& t);
	~MainFrame();
};

