#pragma once
#include <vector>
#include "common.h"

class Particle {
public:
	float x, y, z, r, g, b, a, size;
	float velx, vely;
	Particle(float x, float y, float z, float r, float g, float b, float a, float size, const std::vector<Particle>& particles);
	~Particle();
	
	void Update();
private:
	const std::vector<Particle>& particles;
};

