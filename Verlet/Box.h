#pragma once

#include <SDL.h>
#include "common.h"

#include <vector>
#include <tuple>
#include "Node.h"
#include "Stick.h"

class Box {
public:

	float x, y;
	int nx, ny;
	float res;
	float mass;

	SDL_Renderer* r;

	std::vector<std::vector<Node*>> nodes;
	std::vector<Stick*> sticks;

	Box(SDL_Renderer** rndr ,float x, float y, int nx, int ny, float res, float mass) :
		x(x), y(y), nx(nx), ny(ny), res(res), mass(mass) {

		r = *rndr;

		auto auto_mesh = CreateBox(x, y, nx, ny, res, mass);
		nodes = std::get<0>(auto_mesh);
		sticks = std::get<1>(auto_mesh);
	}

	void Render() {
		for (auto s : sticks) {
			s->Update();
			s->Render();
		}

		for (auto i : nodes) {
			for (auto j : i) {
				j->constrain();
				j->Update();
				j->Render();
			}
		}
	}

	bool IsCollidingWithBox(Box* other) {
		return false;
	}

	std::tuple<std::vector<std::vector<Node*>>, std::vector<Stick*>> CreateBox(float x, float y, int nx, int ny, int res, float density) {

		std::vector<std::vector<Node*>> nodes(nx);
		for (int i = 0; i < nx; i++) {
			nodes[i] = std::vector<Node*>(ny);
		}

		for (int i = 0; i < nx; i++) {
			for (int j = 0; j < ny; j++) {
				nodes[i][j] = new Node(&r, x + i * res, y + j * res, 0, 0, density, false);
				nodes[i][j]->is_visible = true;
			}
		}

		std::vector<Stick*> sticks;

		for (int i = 0; i < nx - 1; i++) {
			for (int j = 0; j < ny - 1; j++) {
				sticks.push_back(new Stick(&r, nodes[i][j], nodes[i + 1][j], res));
				sticks.push_back(new Stick(&r, nodes[i][j], nodes[i][j + 1], res));
			}
		}

		for (int i = 0; i < nx - 1; i++) {
			sticks.push_back(new Stick(&r, nodes[i][ny - 1], nodes[i + 1][ny - 1], res));
		}
		for (int j = 0; j < ny - 1; j++) {
			sticks.push_back(new Stick(&r, nodes[nx - 1][j], nodes[nx - 1][j + 1], res));
		}
		for (int i = 0; i < std::min(nx, ny) - 1; i++) {
			sticks.push_back(new Stick(&r, nodes[i][i], nodes[i + 1][i + 1], res * sqrt(2)));
		}

		return { nodes, sticks };

	}

};