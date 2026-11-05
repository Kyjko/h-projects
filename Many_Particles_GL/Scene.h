#pragma once
#include <glew.h>
#include <SDL.h>
#include <SDL_mixer.h>

#include <iostream>
#include <fstream>
#include <string>
#include <sstream>
#include <random>
#include <time.h>
#include <vector>

#include <glm.hpp>
#include <gtc/matrix_transform.hpp>
#include <gtc/type_ptr.hpp>

#include "Log.h"
#include "Particle.h" 

// todo: dynamic vbo and indices data allocation

#define LOCAL_VERTEX_SHADER 1
#define LOCAL_FRAGMENT_SHADER 2

typedef struct Vec2 {
	float x, y;
} Vec2;

typedef struct Vec3 {
	float x, y, z;
} Vec3;

typedef struct Vec4 {
	float x, y, z, w;
} Vec4;

typedef struct Vertex {
	Vec3 pos;
	Vec4 col;
} Vertex;

typedef struct Quad {
	Vertex v0, v1, v2, v3;	
} Quad;

class Scene {
public:
	Scene(unsigned int id, GLuint W, GLuint H);
	~Scene();
	void On_Init();
	void On_Render(float new_player_ax, float new_player_ay, float new_amnt,
		float new_amnt2, float new_upwards_accel);

	std::vector<Particle> particles;

private:
	unsigned int scene_id;

	Mix_Chunk* ambients;
	Mix_Chunk* footsteps;

	GLuint vbo;
	GLuint vao;
	GLuint ibo;
	GLuint shader_program;

	float player_ax;
	float player_ay;
	float amnt, amnt2;
	float d_px, d_pz, d_py;
	float upwards_accel;

	GLuint W, H;

	glm::mat4 ModelMatrix_view;

	Vertex* vbo_data;
	GLuint* indices;

	std::string vertex_shader_string;
	std::string fragment_shader_string;

	unsigned long long num_models;

	std::vector<Quad> quads;

	double u_Time;
	GLuint u_Time_location;
	GLuint u_HperW_location;
	GLuint u_ModelMatrix_view_location;
	GLuint u_px_location;
	GLuint u_pz_location;
	GLuint u_py_location;

	void InitAudio();
	Quad CreateQuad(float x, float y, float size, float r, float g, float b, float a);
	void UpdateQuads();
	void InitShaders(const std::string& vname, const std::string& fname);
	unsigned int CompileShader(std::string& source, GLuint type);
	void CreateProgram(GLuint& program_name);
};

