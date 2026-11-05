#version 330 core


layout(location = 0) in vec3 i_Position;
layout(location = 1) in vec4 i_Color;

out vec4 vertexColor;
out vec2 uv;

void main() {
	uv = i_Position.xy;
	vertexColor = i_Color;
	gl_Position = vec4(uv, 0., 1.);
	
}