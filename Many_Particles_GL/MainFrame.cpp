#include "MainFrame.h"

MainFrame::MainFrame(std::string& t) : title(t), W(DEFAULT_WIDTH), H(DEFAULT_HEIGHT),
					pax(0.0), pay(0.0), amnt(0.0), amnt2(0.0), upwards_accel(0.0) {

	Log("MainFrame started!", LogEnums::MSG_TYPES::WARN);
	errno_t err = Init(t);
	if (err < 0) {
		Log("Init unsuccessful!", LogEnums::MSG_TYPES::FATAL);
		std::cout << err << "\n";
		exit(-1);
	}
	EventLoop();
}

errno_t MainFrame::Init(std::string& title) {
	if (SDL_Init(SDL_INIT_EVERYTHING) < 0)
		return -1;

	GetScreenResolution();
	std::cout << "\tWidth set to " << W << std::endl;
	std::cout << "\tHeight set to " << H << std::endl;

	_w = SDL_CreateWindow(title.c_str(), SDL_WINDOWPOS_UNDEFINED, SDL_WINDOWPOS_UNDEFINED, W, H, SDL_WINDOW_OPENGL);
	
	if (_w == nullptr)
		return -2;

	_r = SDL_CreateRenderer(_w, -1, SDL_RENDERER_PRESENTVSYNC);
	if (_r == nullptr)
		return -3;

	_glctx = SDL_GL_CreateContext(_w);
	if (_glctx == NULL)
		return -4;

	GLenum err = glewInit();
	if (err != GLEW_OK)
		return -4;

	SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
	SDL_GL_SetSwapInterval(1);
	glDisable(GL_CULL_FACE);
	glClearColor(0, 0, 0, 1.0);
	glLoadIdentity();
	scene = new Scene(1, W, H);
	if (scene == nullptr)
		return -5;

	scene->On_Init();

	return 0;
}

void MainFrame::EventLoop() {
	SDL_SetRelativeMouseMode(SDL_TRUE);

	while (!quit) {
		SDL_Event e;
		static bool is_leftbutton_down = false;
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
				if (e.key.keysym.sym == SDLK_a) {
					amnt2 = 1;
					break;
				}
				if (e.key.keysym.sym == SDLK_d) {
					amnt2 = -1;
					break;
				}
				if (e.key.keysym.sym == SDLK_w) {
					amnt = 1;
					break;
				}
				if (e.key.keysym.sym == SDLK_s) {
					amnt = -1;
					break;
				}
				if (e.key.keysym.sym == SDLK_SPACE) {
					upwards_accel = 0.1;
					break;
				}
				if (e.key.keysym.sym == SDLK_LSHIFT) {
					upwards_accel = -0.1;
					break;
				}

			case SDL_KEYUP:
				if (e.key.keysym.sym == SDLK_w || e.key.keysym.sym == SDLK_s) {
					amnt = 0;
					break;
				}
				if (e.key.keysym.sym == SDLK_a || e.key.keysym.sym == SDLK_d) {
					amnt2 = 0;
					break;
				}
				if (e.key.keysym.sym == SDLK_SPACE || e.key.keysym.sym == SDLK_LSHIFT) {
					upwards_accel = 0;
					break;
				}
				break;
			case SDL_MOUSEBUTTONDOWN:
				if (e.button.button == SDL_BUTTON_LEFT) {
					is_leftbutton_down = true;
					break;
				}
			case SDL_MOUSEBUTTONUP:
				if (e.button.button == SDL_BUTTON_LEFT) {
					is_leftbutton_down = false;
					break;
				}

			case SDL_MOUSEMOTION:
				if (/*is_leftbutton_down*/1) {
					pax += e.motion.xrel / 350.0;
					pay -= e.motion.yrel / 350.0;
				}
				
				break;

			default: {}
			}
			
		}
	
		Render();
	}
}

void MainFrame::Render() {
	glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
	scene->On_Render(pax, pay, amnt, amnt2, upwards_accel);
	SDL_GL_SwapWindow(_w);
}

void MainFrame::GetScreenResolution() {
	SDL_DisplayMode DM;
	SDL_GetCurrentDisplayMode(0, &DM);
	W = DM.w;
	H = DM.h;
	Log("Screen resolution set.", LogEnums::MSG_TYPES::WARN);
}

MainFrame::~MainFrame() {
	SDL_GL_DeleteContext(_glctx);
	SDL_DestroyRenderer(_r);
	SDL_DestroyWindow(_w);

	_w = nullptr;
	_r = nullptr;
	_glctx = NULL;
	delete scene;
	SDL_Quit();

	Log("Exiting MainFrame...", LogEnums::MSG_TYPES::WARN);
}