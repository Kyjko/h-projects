#include "Particle.h"

Particle::Particle(float x, float y, float z, float r, float g, float b, float a, float size, const std::vector<Particle>& particles)
	: x(x), y(y), z(z), r(r), g(g), b(b), a(a), size(size), velx(0), vely(0), particles(particles) {}
Particle::~Particle() {}

void Particle::Update() {
	/*for (const Particle& p : particles) {
		if (p.x != x && p.y != y) {
			float dx = p.x - x;
			float dy = p.y - y;
			float f = p.size * size * GAMMA / (sqrt(dx * dx + dy * dy));
			velx += f * dx;
			vely += f * dy;
		}
	}

	x += velx;
	y += vely;*/

}