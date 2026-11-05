#pragma once

#include <SDL.h>

#include <vector>
#include <tuple>
#include "Node.h"
#include "Stick.h"

class Cloth {
public:

	SDL_Renderer* r;
	float x, y;
	int nx, ny;
	int res;
	float density;

	std::vector<std::vector<Node*>> nodes;
	std::vector<Stick*> sticks;

	Cloth(SDL_Renderer** rndr, float x, float y, int nx, int ny, int res, float density) :
	x(x), y(y), nx(nx), ny(ny), res(res), density(density) {
		
		r = *rndr;

		auto auto_mesh = CreateCloth(x, y, nx, ny, res, density);
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

	std::tuple<std::vector<std::vector<Node*>>, std::vector<Stick*>> CreateCloth(float x, float y, int nx, int ny, int res, float density) {

		std::vector<std::vector<Node*>> nodes(nx);
		for (int i = 0; i < nx; i++) {
			nodes[i] = std::vector<Node*>(ny);
		}

		for (int i = 0; i < nx; i++) {
			for (int j = 0; j < ny; j++) {
				nodes[i][j] = new Node(&r, x+i*res, y+j*res, 0, 0, density, false);
			}
		}

		std::vector<Stick*> sticks;
		
		for (int i = 0; i < nx - 1; i++) {
			for (int j = 0; j < ny - 1; j++) {
				sticks.push_back(new Stick(&r, nodes[i][j], nodes[i+1][j], res));
				sticks.push_back(new Stick(&r, nodes[i][j], nodes[i][j+1], res));
			}
		}

		for (int i = 0; i < nx - 1; i++) {
			sticks.push_back(new Stick(&r, nodes[i][ny-1], nodes[i+1][ny-1], res));
		}
		for (int j = 0; j < ny-1; j++) {
			sticks.push_back(new Stick(&r, nodes[nx-1][j], nodes[nx-1][j+1], res));
		}

		//nodes[0][0]->is_pinned = true;
		//nodes[nx-1][0]->is_pinned = true;
		//nodes[(int)(nx / 2)][0]->is_pinned = true;
		//nodes[(int)(3*nx / 4)][0]->is_pinned = true;
		//nodes[(int)(nx / 4)][0]->is_pinned = true;

		return { nodes, sticks };


		

	}
};