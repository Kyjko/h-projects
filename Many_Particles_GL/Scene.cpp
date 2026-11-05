#include "Scene.h"

#define ASSERT_LOG 1
#define SOUND_ON 1

Scene::Scene(unsigned int id, GLuint W, GLuint H): scene_id(id), ibo(0), vbo(0), vao(0), 
						shader_program(0), num_models(1), 
						u_Time(0.0), indices(nullptr), u_Time_location(0),
						u_HperW_location(0), W(W), H(H), amnt(0.0), amnt2(0.0),
					    player_ax(0.0), player_ay(0.0), u_ModelMatrix_view_location(0),
						ModelMatrix_view(glm::mat4(1.0)), u_px_location(0), u_pz_location(0),
						d_px(0.0), d_pz(0.0), upwards_accel(0.0), u_py_location(0), d_py(0.0),
						ambients(nullptr) {


	std::cout << "\t\tScene Width set to " << W << std::endl;
	std::cout << "\t\tScene Height set to " << H << std::endl;
	vbo_data = new Vertex[num_models * 4];
	srand((unsigned)time(NULL));
}
Scene::~Scene() {
	Mix_FreeChunk(ambients);
	Mix_CloseAudio();
	Log("Audio de-initialized!", LogEnums::INFO);
	glDeleteBuffers(1, &vbo);
	glDeleteBuffers(1, &ibo);
	glDeleteVertexArrays(1, &vao);
	glDeleteProgram(shader_program);
	delete vbo_data;
	delete indices;
	quads = std::vector<Quad>();
	particles = std::vector<Particle>();
	
	Log("Scene destroyed.", LogEnums::MSG_TYPES::INFO);
}

std::ostream& operator<<(std::ostream& stream, const Quad& q) {
	stream << q.v0.pos.x << " ";
	stream << q.v0.pos.y << " ";
	stream << q.v0.pos.z << " ";
	stream << q.v0.col.x << " ";
	stream << q.v0.col.y << " ";
	stream << q.v0.col.z << " ";
	stream << q.v0.col.w << " ";
	stream << "\n";
	stream << q.v1.pos.x << " ";
	stream << q.v1.pos.y << " ";
	stream << q.v0.pos.z << " ";
	stream << q.v1.col.x << " ";
	stream << q.v1.col.y << " ";
	stream << q.v1.col.z << " ";
	stream << q.v1.col.w << " ";
	stream << "\n";
	stream << q.v2.pos.x << " ";
	stream << q.v2.pos.y << " ";
	stream << q.v0.pos.z << " ";
	stream << q.v2.col.x << " ";
	stream << q.v2.col.y << " ";
	stream << q.v2.col.z << " ";
	stream << q.v2.col.w << " ";
	stream << "\n";
	stream << q.v3.pos.x << " ";
	stream << q.v3.pos.y << " ";
	stream << q.v0.pos.z << " ";
	stream << q.v3.col.x << " ";
	stream << q.v3.col.y << " ";
	stream << q.v3.col.z << " ";
	stream << q.v3.col.w << " ";
	stream << "\n";

	return stream;
}

void Scene::InitAudio() {
	if (Mix_OpenAudio(22050, MIX_DEFAULT_FORMAT, 2, 4096) == -1) {
		Log("Cannot initialize audio!", LogEnums::ERROR);
	}
	ambients = Mix_LoadWAV("ambients.wav");
	if (ambients == nullptr) {
		Log("Cannot open audio file", LogEnums::ERROR);
	}

	// start playing ambients, loop forever (~ 65000 times) (-1)
#if (SOUND_ON == 1)
	Mix_PlayChannel(-1, ambients, -1);
	Log("Audio initialized!", LogEnums::INFO);
#endif
}

void Scene::On_Init() {
	// audio
	InitAudio();

	// shaders
	InitShaders("shader.vert", "shader.frag");
	CreateProgram(shader_program);

	u_Time_location = glGetUniformLocation(shader_program, "u_Time");
	u_HperW_location = glGetUniformLocation(shader_program, "u_HperW");
	u_ModelMatrix_view_location = glGetUniformLocation(shader_program, "u_ModelMatrix_view");
	u_px_location = glGetUniformLocation(shader_program, "u_px");
	u_pz_location = glGetUniformLocation(shader_program, "u_pz");
	u_py_location = glGetUniformLocation(shader_program, "u_py");

	std::cout << "R = " << (float)H / (float)W << std::endl;

	// init particles, quads and vbo_data
	//for (int i = 0; i < num_models; i++) {
		/*Quad q0 = CreateQuad((float)rand()/RAND_MAX*2 - 1, (float)rand()/RAND_MAX*2 - 1, 0.005f, 0.2f, 0.9f, 0.56f, 1.0f);
		quads.push_back(q0);
		*/
		/*particles.push_back(Particle((float)rand() / RAND_MAX * 2 - 1, (float)rand() / RAND_MAX * 2 - 1, 0.0f,
			0.2f, 0.9f, 0.56f, 1.0f, 0.5f, particles));*/
		
	//}
	particles.push_back(Particle(-1.0, -1.0, 0.0, 0.79, 0.79, 0.76, 1.0, 2, particles));
	UpdateQuads();

	// assert
#if (ASSERT_LOG == 1)
	for (auto i = std::begin(quads); i != std::end(quads); i++) {
		std::cout << *i << std::endl;
	}
#endif

	glGenVertexArrays(1, &vao);
	glGenBuffers(1, &vbo);
	glBindVertexArray(vao);
	glBindBuffer(GL_ARRAY_BUFFER, vbo);
	glBufferData(GL_ARRAY_BUFFER, sizeof(Vertex)*4*num_models, nullptr, GL_DYNAMIC_DRAW);

	glEnableVertexArrayAttrib(vao, 0);
	glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), 
							(const void*)offsetof(Vertex, pos));
	glEnableVertexArrayAttrib(vao, 1);
	glVertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, sizeof(Vertex), 
							(const void*)offsetof(Vertex, col));

	/*GLuint indices[] = {
		0, 1, 2, 2, 3, 0,
		4, 5, 6, 6, 7, 4
	};*/

	indices = (GLuint*)malloc(num_models * 6 * sizeof(GLuint));
	if (indices == nullptr)
		exit(-1);

	for (int i = 0; i < num_models; i++) {
		for (int j = 0; j < 6; j++) {
			indices[i * 6 + j] = (j <= 2) * (j + 4 * i) + (j > 2) * (j - 1 + 4 * i);
		}
		indices[i * 6 + 5] = indices[i * 6];
	}

	//assert
#if (ASSERT_LOG == 1)
	for (int i = 0; i < num_models * 6; i++) {
		if (i % 6 == 0 && i != 0)
			std::cout << "\n";
		std::cout << indices[i] << ", ";	
	}
	std::cout << "\n";
#endif

	glGenBuffers(1, &ibo);
	glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ibo);
	glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(GLuint) * 6 * num_models, indices, GL_DYNAMIC_DRAW);
	
	Log("Scene initialized.", LogEnums::MSG_TYPES::INFO);
}

void Scene::InitShaders(const std::string& vertex_shader_name, 
						const std::string& fragment_shader_name) {
	
	std::fstream vstrm(vertex_shader_name), fstrm(fragment_shader_name);
	std::string line;
	std::stringstream vss, fss;
	
	while (std::getline(vstrm, line)) {
		vss << line << "\n";
	}
	while (std::getline(fstrm, line)) {
		fss << line << "\n";
	}

	vertex_shader_string = vss.str();
	fragment_shader_string = fss.str();
}

unsigned int Scene::CompileShader(std::string& source, GLuint type) {
	unsigned int id = glCreateShader(type);
	const char* src = source.c_str();
	glShaderSource(id, 1, &src, nullptr);
	glCompileShader(id);

	int result;
	glGetShaderiv(id, GL_COMPILE_STATUS, &result);
	if (result == GL_FALSE) {
		int len;
		glGetShaderiv(id, GL_INFO_LOG_LENGTH, &len);
		char* err_msg = (char*)_alloca(len * sizeof(char));
		glGetShaderInfoLog(id, len, &len, err_msg);
		if (type == GL_VERTEX_SHADER) {
			Log("Failed to compile vertex shader!", LogEnums::MSG_TYPES::FATAL);
		}
		else {
			Log("Failed to compile fragment shader!", LogEnums::MSG_TYPES::FATAL);
		}

		glDeleteShader(id);
		std::cout << err_msg << std::endl;
		std::cout << source << std::endl;
		std::cout << "\n";

		return 0;
	}

	return id;
}

void Scene::CreateProgram(GLuint& shader_program) {
	shader_program = glCreateProgram();
	unsigned int vs = CompileShader(vertex_shader_string, GL_VERTEX_SHADER);
	unsigned int fs = CompileShader(fragment_shader_string, GL_FRAGMENT_SHADER);
	if (vs == 0 || fs == 0) {
		Log("Shader compilation unsuccessful!", LogEnums::MSG_TYPES::FATAL);
		exit(-1);
	}

	glAttachShader(shader_program, vs);
	glAttachShader(shader_program, fs);
	glLinkProgram(shader_program);
	glValidateProgram(shader_program);

	glDeleteShader(vs);
	glDeleteShader(fs);
}

Quad Scene::CreateQuad(float x, float y, float size, float r, float g, float b, float a) {
	Vertex v0;
	v0.pos = { x, y, 0.0f };
	v0.col = { r, g, b, a };

	Vertex v1;
	v1.pos = { x + size, y, 0.0f };
	v1.col = { r, g, b, a };

	Vertex v2;
	v2.pos = { x + size, y + size, 0.0f };
	v2.col = { r, g, b, a };

	Vertex v3;
	v3.pos = { x, y + size, 0.0f };
	v3.col = { r, g, b, a };

	return { v0, v1, v2, v3 };
}

void Scene::On_Render(float new_player_ax, float new_player_ay, float new_amnt, float new_amnt2, float new_upwards_accel) {
	player_ax = new_player_ax;
	player_ay = new_player_ay;
	if (new_player_ay > 90.0f / 25.0f) player_ay = 90.0f / 25.0f;
	if (new_player_ay < -90.0f / 25.0f) player_ay = -90.0f / 25.0f;
	amnt = new_amnt;
	amnt2 = new_amnt2;
	upwards_accel = new_upwards_accel;

	//update modelmatrix
	ModelMatrix_view = glm::mat4(1.0f);
	ModelMatrix_view = glm::rotate(ModelMatrix_view, glm::radians(player_ay * 25.0f), glm::vec3(1.0, 0.0, 0.0));
	ModelMatrix_view = glm::rotate(ModelMatrix_view, glm::radians(-player_ax * 25.0f), glm::vec3(0.0, 1.0, 0.0));

	glm::vec4 rel(0, 0, 1, 1);
	glm::vec4 rel2(1, 0, 0, 1);

	rel = ModelMatrix_view * rel;
	rel2 = ModelMatrix_view * rel2;

	d_px -= rel.x * 0.08 * amnt;
	d_pz += rel.z * 0.08 * amnt;
	d_px -= rel2.x * 0.08 * amnt2;
	d_pz += rel2.z * 0.08 * amnt2;
	d_py += upwards_accel;

	// constrain move amounts
	if (d_py < 0)
		d_py = 0;

	// set volume dynamically
	float dist_from_origin = sqrt(d_px * d_px + d_pz * d_pz + d_py * d_py);
	Mix_Volume(-1, std::max(1.0f, MIX_MAX_VOLUME *3/4 - dist_from_origin*5.0f));
	
	//update position

	memcpy(vbo_data, quads.data(), num_models * 4 * sizeof(Vertex));

	glBindBuffer(GL_ARRAY_BUFFER, vbo);
	glBufferSubData(GL_ARRAY_BUFFER, 0, sizeof(Vertex) * 4 * num_models, vbo_data);
	glUseProgram(shader_program);
	
	glUniform1f(u_HperW_location, (float)H / (float)W);
	glUniform1f(u_px_location, d_px);
	glUniform1f(u_pz_location, d_pz);
	glUniform1f(u_py_location, d_py);
	glUniformMatrix4fv(u_ModelMatrix_view_location, 1, GL_FALSE, glm::value_ptr(ModelMatrix_view));

	glBindVertexArray(vao);
	glDrawElements(GL_TRIANGLES, 6 * num_models, GL_UNSIGNED_INT, nullptr);

	UpdateQuads();
	glUniform1f(u_Time_location, u_Time);
	u_Time += 0.01;
}

void Scene::UpdateQuads() {
	// update particles

	for (std::vector<Particle>::iterator p = particles.begin(); p != particles.end(); p++) {
		p->Update();
	}

	quads.clear();
	for (std::vector<Particle>::iterator p = particles.begin(); p != particles.end(); p++) {
		quads.push_back(CreateQuad(p->x, p->y, p->size, p->r, p->g, p->b, p->a));
	}
}