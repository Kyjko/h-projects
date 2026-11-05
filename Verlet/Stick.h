#pragma once

#include <SDL.h>
#include "Node.h"

class Stick {
public:

	float elasticity = 2;

	Node *p1, *p2;
	SDL_Renderer* r;
	float len;
	bool is_active;

	Stick(SDL_Renderer** rndr, Node* p1, Node* p2, float len) :
		p1(p1), p2(p2), len(len), is_active(true) {
		r = *rndr;

	}

	void Update() {
		if (is_active) {
			float diff_x = p2->x - p1->x;
			float diff_y = p2->y - p1->y;
			float dist = sqrt(diff_x * diff_x + diff_y * diff_y);
			float diff = len - dist;
			float pcnt = (diff / dist) / elasticity;

			float off_x = diff_x * pcnt;
			float off_y = diff_y * pcnt;

			if (!p1->is_pinned) {
				p1->x -= off_x;
				p1->y -= off_y;
			}
			if (!p2->is_pinned) {
				p2->x += off_x;
				p2->y += off_y;
			}

		}
	}

	void Render() {
		if (is_active) {
			SDL_SetRenderDrawColor(r, 255, 255, 255, 255);
			SDL_RenderDrawLine(r, p1->x, p1->y, p2->x, p2->y);
		}
	}
};