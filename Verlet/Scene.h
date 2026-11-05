#pragma once
#include <SDL.h>
#include <iostream>
#include <cstdlib>
#include "common.h"

#include <vector>

#include "Box.h"
#include "Cloth.h"

class Scene {
public:
	SDL_Window* window;
	SDL_Renderer* renderer;
	const char* scene_name;
	bool quit = false;

	Cloth* my_cloth = nullptr;
	std::vector<Box*> my_boxes;
	std::vector<Cloth*> my_clothes;

	Scene(const char* name) : scene_name(name), window(nullptr), renderer(nullptr), my_cloth(nullptr) {
		SDL_Init(SDL_INIT_VIDEO);
		window = SDL_CreateWindow(scene_name, SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
			W, H, NULL);
		const char* sdl_error;
		if (window == nullptr) {

			//TODO: implement sdl error handlingthe proper way
			fprintf(stderr, "[!] Cannot create window! \n %s\n", "1");
			return;
		}

		renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED);

		if (renderer == nullptr) {
			fprintf(stderr, "[!] Cannot create renderer! \n %s\n", "2");
			return;
		}

		InitObjects();
	}

	void InitObjects() {
		//my_cloth = new Cloth(&renderer, 150, 150, 40, 40, 20, 1);

		my_boxes = std::vector<Box*>();
		my_clothes = std::vector<Cloth*>();

		for (int i = 0; i < 500; i++) {
			my_boxes.push_back(new Box(&renderer, 150 + i * 6, 400 + sin(i) * 200, 2, 2, 30, 30));
		}

		my_clothes.push_back(new Cloth(&renderer, 150, 150, 40, 40, 20, 1));
	
	}

	~Scene() {
		SDL_DestroyRenderer(renderer);
		SDL_DestroyWindow(window);
		renderer = nullptr;
		window = nullptr;
		SDL_Quit();
	}
	
	void Render() {

		SDL_RenderClear(renderer);

		// collision between boxes

		//my_cloth->Render();
		for (auto const& box : my_boxes) {
			box->Render();
		}

		for (auto const& cloth : my_clothes) {
			cloth->Render();
		}


		SDL_SetRenderDrawColor(renderer, 0, 0, 0, 255);
		SDL_RenderPresent(renderer);
	}

	void Loop() {
		fprintf(stdout, "[*] Render started\n");
		
		bool mousedown = false;
		float force_x = 0, force_y = 0;
		float mouse_x = 0, mouse_y = 0;

		while (!quit) {
			SDL_Event e;
			while (SDL_PollEvent(&e) != NULL) {
				switch (e.type) {
				case SDL_QUIT:
					quit = true;
					break;

				case SDL_KEYDOWN:
					if (e.key.keysym.sym == SDLK_ESCAPE) {
						quit = true;
						break;
					}
					if (e.key.keysym.sym == SDLK_r) {
						InitObjects();
						break;
					}

				case SDL_MOUSEBUTTONDOWN:
					if (e.button.button == SDL_BUTTON_LEFT) {
						mousedown = true;
						break;
					}

				case SDL_MOUSEBUTTONUP:
					if (e.button.button == SDL_BUTTON_LEFT) {
						mousedown = false;
						
						for (auto box : my_boxes) {
							for (auto stick : box->sticks) {
								stick->p1->is_being_forced = false;
								stick->p2->is_being_forced = false;
							}
						}

						for (auto cloth : my_clothes) {
							for (auto stick : cloth->sticks) {
								stick->p1->is_being_forced = false;
								stick->p2->is_being_forced = false;
							}
						}
						
						break;

						
					}

				case SDL_MOUSEMOTION:
					if (mousedown) {
						force_x = e.motion.xrel*200;
						force_y = e.motion.yrel*500;

						mouse_x = e.motion.x;
						mouse_y = e.motion.y;

						//find sticks to effect

						std::cout << mouse_x << " " << mouse_y << " - " << force_x << " " << force_y << std::endl;

						for (auto box : my_boxes) {
							for (auto stick : box->sticks) {
								auto n1 = stick->p1;
								auto n2 = stick->p2;

								

								float pos_stick_x = (n1->x + n2->x) / 2;
								float pos_stick_y = (n1->y + n2->y) / 2;

								if (abs(mouse_x - pos_stick_x) < 20 &&
									abs(mouse_y - pos_stick_y) < 20) {

									n1->is_being_forced = true;
									n2->is_being_forced = true;

									n1->force_x = force_x;
									n1->force_y = force_y;

									n2->force_x = force_x;
									n2->force_y = force_y;

								}
							}
						}

						for (auto cloth : my_clothes) {
							for (auto stick : cloth->sticks) {
								auto n1 = stick->p1;
								auto n2 = stick->p2;



								float pos_stick_x = (n1->x + n2->x) / 2;
								float pos_stick_y = (n1->y + n2->y) / 2;

								if (abs(mouse_x - pos_stick_x) < 20 &&
									abs(mouse_y - pos_stick_y) < 20) {

									n1->is_being_forced = true;
									n2->is_being_forced = true;

									n1->force_x = force_x;
									n1->force_y = force_y;

									n2->force_x = force_x;
									n2->force_y = force_y;

								}
							}
						}

					}
					break;
				default: {}
				}
			}
			Render();

		}
	}
};

