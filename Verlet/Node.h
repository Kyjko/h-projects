#pragma once

#include "common.h"
#include <SDL.h>

class Node {
public:
	float x, y, mass, vel_x, vel_y;
	float old_x, old_y;
	bool is_pinned, is_visible;
	float force_x, force_y;

	bool is_being_forced = false;

	SDL_Renderer* r;

	Node(SDL_Renderer** rndr, float x, float y, float vel_x, float vel_y, float mass, bool is_pinned) :
		x(x), y(y), vel_x(vel_x), vel_y(vel_y), mass(mass), is_pinned(is_pinned) {

		is_visible = false;
		force_x = 0;
		force_y = GRAVITY_Y*mass;

		r = *rndr;

		old_x = x;
		old_y = y;
	}

	void Update() {
		
		if (!is_being_forced) {
			force_x = 0;
			force_y = GRAVITY_Y * mass;
		}

		if (!is_pinned) {
			float n_vel_x = x - old_x;
			float n_vel_y = y - old_y;
		
			vel_x = n_vel_x;
			vel_y = n_vel_y;

			old_x = x;
			old_y = y;

			float a_x = force_x / mass;
			float a_y = force_y / mass;

			x += vel_x + a_x * dt * dt;
			y += vel_y + a_y * dt * dt;
		}
	}

	void constrain() {
		float n_vel_x = x - old_x;
		float n_vel_y = y - old_y;

		if (x < 0) {
			x = 0;
			old_x = x + n_vel_x;
		}
		if (x > W) {
			x = W;
			old_x = x + n_vel_x;
		}
		if (y < 0) {
			y = 1;
			old_y = y + n_vel_y;
		}
		if (y > H) {
			y = H;
			old_y = y + n_vel_y;
		}
	}

	void Render() {
		if (is_visible) {
			SDL_SetRenderDrawColor(r, 140, 140, 0, 255);
			SDL_RenderDrawPoint(r, x, y);
		}
	}

};