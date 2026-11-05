#version 330 core

#define MAX_STEPS 3000
#define SURF_DIST .01
#define MAX_DIST 300.0
#define REFLECTIVITY .35

//// mandelbulb
#define Bailout 4.5
#define Iterations 10
//// mandelbulb

//// mandelbox
#define minRadius2 1		// 1
#define fixedRadius2 20		// 10
#define Scale 3				//3
#define foldingLimit 5		//5
//// mandelbox
#define OLDEFFECT 0
#define RENDER_REFLECTIONS 0
#define MORFING 0

in vec4 vertexColor;
in vec2 uv;

out vec4 fragColor;

uniform float u_Time;
uniform float u_HperW;

uniform mat4 u_ModelMatrix_view;
uniform float u_px;
uniform float u_pz;
uniform float u_py;

//---------------------
float GetDist(vec3 p);
float RayMarch(vec3 ro, vec3 rd);
float GetLight(vec3 p);
vec3 GetNormal(vec3 p);
float GetRefl(vec3 p, vec3 o);
float GetLightAndRefl(vec3 p, vec3 ro);
//---------------------

// polynomial smooth min (k = 0.1);
float smin( float a, float b) {
	float k = 0.2;
    float h = clamp( 0.5+0.5*(b-a)/k, 0.0, 1.0 );
    return mix( b, a, h ) - k*h*(1.0-h);
}

float sphere(vec3 p, vec4 sphere) {
	float dS = length(p-sphere.xyz) - sphere.w;
	return dS;
}

float infinite_sphere(vec3 p, vec4 sphere) {
	float dS = length(mod(p.xyz, 10.0)-sphere.xyz) - sphere.w;
	return dS;
}

float plane(vec3 p, float offset) {
	return p.y + offset;
}

float box(vec3 p, vec3 s) {
	return length(max(abs(p)-s, 0.));
}

float mandelbulb(vec3 pos) {
	float Power = max(2, abs(sin(u_Time/4)*10) + 1.5);
	vec3 z = pos*2;
	float dr = 1;
	float r = 1;		//1
	for (int i = 0; i < Iterations ; i++) {
		r = length(z);
		if (r>Bailout) break;
		
		float theta = acos(z.z/r);
		float phi = atan(z.y,z.x);
		dr =  pow( r, Power-1.0)*Power*dr + 1.0;
		
		float zr = pow( r,Power);
		theta = theta*Power;
		phi = phi*Power;
		
		z =  zr*vec3(sin(theta)*cos(phi* (.5 + cos(u_Time/30))), sin(phi)*sin(theta), cos(theta * (.5 + cos(u_Time/30))));
		z+=pos;
	}
	return 0.5*log(r)*r/dr;
}

/////////////////////////////////
void sphereFold(inout vec3 z, inout float dz) {
	float r2 = dot(z,z);
#if MORFING == 0
	if (r2<minRadius2) { 
		// linear inner scaling
		float temp = (fixedRadius2/minRadius2);
		z *= temp;
		dz*= temp;
	} else if (r2<fixedRadius2) { 
		// this is the actual sphere inversion
		float temp =(fixedRadius2/r2);
		z *= temp;
		dz*= temp;
	}
#else
	if (r2<minRadius2) { 
		// linear inner scaling
		float temp = ((fixedRadius2+15*sin(u_Time*.2))/(minRadius2+sin(u_Time*.2)));
		z *= temp;
		dz*= temp;
	} else if (r2<(fixedRadius2+15*sin(u_Time*.2))) { 
		// this is the actual sphere inversion
		float temp =((15*sin(u_Time*.2)+fixedRadius2)/r2);
		z *= temp;
		dz*= temp;
	}
#endif
}

void boxFold(inout vec3 z, inout float dz) {
#if MORFING == 0
	z = clamp(z, -foldingLimit, foldingLimit) * 2.0 - z;
#else
	z = clamp(z, -(foldingLimit+2.5*cos(u_Time*.2)), (foldingLimit+2.5*cos(u_Time*.2))) * 2.0 - z;
#endif
}
float DE(vec3 z)
{
	vec3 offset = z;
	//float dr = 1.0;
	float dr = 1.;
	int n;
	for (n = 0; n < Iterations; n++) {
		boxFold(z,dr);       // Reflect
		sphereFold(z,dr);    // Sphere Inversion
 		
        z=Scale*z + offset;  // Scale & Translate
        dr = dr*abs(Scale)+1.0;

	}
	//float r = length(z);
	//return r/abs(dr);
	return length(z)/abs(dr);
}

vec3 DE_color(vec3 z)
{
	vec3 offset = z;
	//float dr = 1.0;
	float dr = 1.;
	int n;

	float min_orbit_dist = 1000.0;
	
	for (n = 0; n < Iterations; n++) {
		boxFold(z,dr);       // Reflect
		sphereFold(z,dr);    // Sphere Inversion
 		
        z=Scale*z + offset;  // Scale & Translate
        dr = dr*abs(Scale)+1.0;
		
		min_orbit_dist = min(min_orbit_dist, dr*length(z-offset));
	}
	//float r = length(z);
	//return r/abs(dr);
	return vec3(/*length(z)/abs(dr)*/length(z)/min_orbit_dist*.25 , length(offset*0.00001*dr)*min_orbit_dist*.0015,  min_orbit_dist*.2);
}

vec3 mandelbulb_color(vec3 pos) {
	float Power = max(2, abs(sin(u_Time/4)*10) + 1.5);
	vec3 z = pos;
	float dr = 1;
	float r = 1;
	for (int i = 0; i < Iterations ; i++) {
		r = length(z);
		if (r>Bailout) break;
		
		float theta = acos(z.z/r);
		float phi = atan(z.y,z.x);
		dr =  pow( r, Power-1.0)*Power*dr + 1.0;	// + 1.0
		
		float zr = pow( r,Power);
		theta = theta*Power;
		phi = phi*Power;
		
		z =  zr*vec3(sin(theta)*cos(phi), sin(phi)*sin(theta), cos(theta * (.5 + cos(u_Time/30))));
		z+=pos;
	}
	return vec3(0.5*log(r)*r/dr, log(r)*length(z-pos)*.002, log(r)*Power*dr*.0001);
}

vec3 plane_color(vec3 p) {
	float d = p.y;
	return vec3(0, d, d + p.y);
}

//////////////////////////////////

vec3 GetNormal(vec3 p) {
	float d = GetDist(p);
	vec2 e = vec2(.01, 0);
	vec3 n = d - vec3(
		GetDist(p-e.xyy),
		GetDist(p-e.yxy),
		GetDist(p-e.yyx));

	return normalize(n);
}

float GetLight(vec3 p) {
	vec3 lightPos = vec3(0,10, 6);
	lightPos.xz += vec2(150*sin(u_Time/25), 150*cos(u_Time/25));
	vec3 l = normalize(lightPos - p);
	vec3 n = GetNormal(p);

	float dif = clamp(dot(n, l), 0, 1);
	float d = RayMarch(p + n * SURF_DIST * 14.0, l);
	if(d < length(lightPos - p)) dif *= 0.3;
	return dif;
}

float GetRefl(vec3 p, vec3 ro) {
	vec3 n = GetNormal(p);
	p += n*SURF_DIST*14.;
	vec3 v = p - ro;
	float s = dot(n,v);
  
	vec3 r = normalize(v - 2. * s * n);
    
	float d = RayMarch(p,r);
	float b = GetLight(p+r*d);

    return b;
}

float GetDist(vec3 p) {
	float p1 = plane(p, 3);
	/*float s1 = sphere(p, vec4(3, -1.5, 8, 1));
	float s2 = sphere(p, vec4(-8, -3, 10, 2));
	float s3 = sphere(p, vec4(8, -1.5, 15, 1));
	float b1 = box(p-vec3(-1.9, -2, 14), vec3(.5, .5, .5));

	float d3 = sphere(p, vec4(1, -1.5 + sin(u_Time)*1.5, 8, 0.65));

	float db1 = box(p-vec3(-1.9, -2, 14), vec3(.6, 2, .7));
	*/
	
	float m2 = mandelbulb(p);
	float m1 = DE(p);
	
	//float dm = min(p1, m1);
	
	/*dm = min(dm, s1);
	dm = min(dm, s2);
	dm = min(dm, s3);
	dm = min(dm, b1);
	dm = min(dm, d3);
	dm = min(dm, db1);
	*/
	//dm = min(dm, d3);

	return min(min(m1, p1), m2);
	//return dm;
}

float GetLightAndRefl(vec3 p, vec3 ro) {
	float diff = GetLight(p);
	float refl = GetRefl(p, ro);
	return diff*(1-REFLECTIVITY) + refl*REFLECTIVITY;
}

float RayMarch(vec3 ro, vec3 rd) {
	float dO = 0;
	for(int i = 0; i < MAX_STEPS; i++) {
		vec3 p = ro + dO*rd;
		float dS = GetDist(p);
		dO += dS;
		if(dS < SURF_DIST || dO > MAX_DIST) break;
	}

	return dO;
}

vec4 scanLineIntensity(float uv, float resolution, float opacity) {
     float intensity = sin(uv * resolution * 3.1415 * 2.0);
     intensity = ((0.5 * intensity) + 0.5) * 0.9 + 0.1;
     return vec4(vec3(pow(intensity, opacity)), 1.0);
}

void main() {
	vec3 col = vec3(0);
	
	vec3 rd = normalize(vec4((vec4(vec3(uv.x, uv.y * u_HperW, 1), 1.) * u_ModelMatrix_view)).xyz);
	vec3 ro = vec3(0 + u_px, -2.5 + u_py, -5 + u_pz);
	float d = RayMarch(ro, rd);
	vec3 p = ro + rd * d;

#if RENDER_REFLECTIONS == 1
	float c = GetLightAndRefl(p, ro);
#else
	float c = GetLight(p);
#endif
	
	col = vec3(c);
	col += DE_color(p)*0.01;
	col += mandelbulb_color(p)*0.000001;
	//col -= (10-p.y) * plane_color(p)*.0005;

#if OLDEFFECT == 1
	col *= scanLineIntensity(uv.x + sin(u_Time), 1440, 0.6).xyz;
    col *= scanLineIntensity(uv.y, 2560, 0.3).xyz;
#endif

	fragColor = vec4(col, 1.0) * vertexColor;// + 0.3 *vec4(sin(u_Time)/3, cos(u_Time)/5, sin(u_Time)/3, 1.0);
}