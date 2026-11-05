const canvas = document.querySelector(".scene");
const environment = document.querySelector(".environment");
const statscreen = document.querySelector(".statscreen");

const W = canvas.width = window.innerWidth/2;
const H = canvas.height = window.innerHeight/2;

const W_ENV = environment.width = window.innerWidth/2;
const H_ENV = environment.height = window.innerHeight/2;

const W_STAT = statscreen.width = window.innerWidth/2;
const H_STAT = statscreen.height = window.innerHeight/2;



const GLOBAL_GRAVITY = 0.001;


/////////////////////// evol

const MAX_GENERATIONS_PER_EPOCH = 12;
const MAX_TIME_PER_GEN = 5000;

var generations = [];
var epoch = 0;
var best_gen_from_epoch = [];

////////////////////

id = (x) => {
    return x;
}

RELU = (x) => {
    return x < 0 ? 0 : x;
}

parabolic = (x) => {
    return x**2 / 2;
}

sigmoid = (x) => {
    return 1/(1+Math.exp(-x));
}

clamp = (x) => {
    return sigmoid(x)*2-1;
}

is_line_intersect_circle = (lineStart, lineEnd, circleCenter, radius) => {

    let x1 = lineStart[0];
    let y1 = lineStart[1];

    let x2 = lineEnd[0];
    let y2 = lineEnd[1];

    let cx = circleCenter[0];
    let cy = circleCenter[1];
  
    // Line vector
    let dx = x2 - x1;
    let dy = y2 - y1;
  
    // Vector from start of line to circle center
    let fx = x1 - cx;
    let fy = y1 - cy;
  
    let a = dx * dx + dy * dy;
    let b = 2 * (fx * dx + fy * dy);
    let c = fx * fx + fy * fy - radius * radius;
  
    let discriminant = b * b - 4 * a * c;
  
    if(discriminant < 0) {
        return false;
    }

    // Check if intersection occurs within the line segment
    let discriminantSqrt = Math.sqrt(discriminant);
    let t1 = (-b - discriminantSqrt) / (2 * a);
    let t2 = (-b + discriminantSqrt) / (2 * a);

    return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
}

const NET_GLOBAL_X_RENDER_OFFSET = 50;
const NET_GLOBAL_Y_RENDER_OFFSET = H/4;
const NEURON_SIZE = 8;
const NET_LAYER_WIDTH = 60;

const HUD_GLOBAL_X_RENDER_OFFSET = NET_GLOBAL_X_RENDER_OFFSET;
const HUD_GLOBAL_Y_RENDER_OFFSET = NET_GLOBAL_Y_RENDER_OFFSET;

const r = canvas.getContext("2d");
const r_env = environment.getContext("2d");
const r_stat = statscreen.getContext("2d");

const grad = r_env.createLinearGradient(0,0, 0,H_ENV/2);
grad.addColorStop(0, "rgb(70, 70, 70)");
grad.addColorStop(0.5, "rgb(35, 35, 35)");
grad.addColorStop(1, "rgb(0, 0, 0)");

r_env.fillStyle = grad
r_stat.fillStyle = "rgb(10, 10, 10)";

r.fillStyle = "rgb(20,20,20)";
r.fillRect(0, 0, W, H);

r_env.fillRect(0, 0, W_ENV, H_ENV);
r_stat.fillRect(0, 0, W_STAT, H_STAT);

circle = (x, y, m, c) => {
    let cs = RELU(c);
    r.fillStyle = `rgb(${cs*255},${cs*255},0)`;
    r.beginPath();
    r.arc(x, y, m, 0, 2*Math.PI, false);
    r.fill();
    r.lineWidth = 2;
    r.strokeStyle = "rgb(255,255,255)";
    r.stroke();
}

class Layer {
    constructor(n_in, n_out, A, is_input) {
        this.n_in = n_in;
        this.n_out = n_out;
        this.A = A;

        this.is_input = is_input;

        this.output = new Array(n_out);

        this.offset_x = 0;
        this.offset_y = 0;
        
        // weights
        this.W = new Array(n_in);
        for(let i = 0; i < n_in; i++) {
            // weight matrix : W (n_in * n_out)
            this.W[i] = new Array(n_out);
        }
        // biases
        this.B = new Array(n_out);
    }

    // input vector : input
    feed_forward = (input) => {
        if(this.is_input) {
            this.output = input;
            return input;
        } else {
            let weighted_input = new Array(this.n_out);
            for(let i = 0; i < this.n_out; i++) {
                let v = this.B[i];
                for(let j = 0; j < this.n_in; j++) {
                    v += input[j]*this.W[j][i];
                }
                // activation function -  A : v -> A(v)
                weighted_input[i] = this.A(v);
            }

            this.output = weighted_input;
            return weighted_input;
        }
    }

    render = (offset_x, offset_y) => {
        this.offset_x = NET_GLOBAL_X_RENDER_OFFSET + offset_x;
        this.offset_y = NET_GLOBAL_Y_RENDER_OFFSET + offset_y;
        for(let i = 0; i < this.n_out; i++) {
            circle(NET_GLOBAL_X_RENDER_OFFSET + offset_x, NET_GLOBAL_Y_RENDER_OFFSET + offset_y + i*NEURON_SIZE*3, NEURON_SIZE, this.output[i]);
        }
        //if(this.is_input) {
            
        //}
    }

    init_random_weights = () => {
        for(let i = 0; i < this.n_in; i++) {
            for(let j  = 0; j < this.n_out; j++) {
                this.W[i][j] = Math.random()*2-1;
            }
        }
        for(let i = 0; i < this.n_out; i++) {
            this.B[i] = Math.random()*2-1;
        }
    }

    
}


class Net {
    // n_layer : number of layers
    // layer_dims : dimensions of layers (n_in, n_out)
    // layer_activations : vector of activation functions for each layer 
    constructor(n_layer, layer_dims, layer_activations) {
        this.n_layer = n_layer;
        this.layer_activations = layer_activations;
        this.layers = new Array(n_layer);

        for(let i = 0; i < n_layer; i++) {
            this.layers[i] = new Layer(layer_dims[i][0], layer_dims[i][1], layer_activations[i], i == 0 ? true : false);
        }

        //console.log(this.layers);
    }

    net_feed_forward = (input) => {
        this.input = input;
        let res = input;
        for(let l of this.layers) {
            // update input with layer feed forwards
            let tmp_res = l.feed_forward(res);
            res = tmp_res;
        }
        this.output = res;
        return res;
    }

    init_random_weights = () => {
        for(let l of this.layers) {
            l.init_random_weights();
        }
    }

    get_weights = () => {
        let weights = []
        for(const l of this.layers) {
            weights.push([l.W, l.B]);
        }

        return weights;
    }

    set_weights = (params_new) => {
        for(let i = 0; i < this.n_layer; i++) {
            this.layers[i].W = params_new[i][0];
            this.layers[i].B = params_new[i][1];
        }
    }

    mutate = (mutate_prob) => {
        for(let l of this.layers) {
            for(let i = 0; i < l.n_in; i++) {
                for(let j = 0;  j < l.n_out; j++) {
                    if(Math.random() < mutate_prob) {
                        l.W[i][j] += (Math.random()*2-1);
                    }
                }
            }
            for(let i = 0; i < l.n_out; i++) {
                if(Math.random() < mutate_prob) {
                    l.B[i] += (Math.random()*2-1);
                }
            }
        }
    }

    net_render = () => {
        this.layers[0].render(NET_GLOBAL_X_RENDER_OFFSET, NET_GLOBAL_Y_RENDER_OFFSET-this.layers[0].n_out*NEURON_SIZE*3/2);
        for(let l = 1; l < this.n_layer; l++) {
            
            let curr_layer = this.layers[l];
            let prev_layer = this.layers[l-1];
            let x = NET_GLOBAL_X_RENDER_OFFSET + l*NET_LAYER_WIDTH;
            curr_layer.render(x, NET_GLOBAL_Y_RENDER_OFFSET-curr_layer.n_out*NEURON_SIZE*3/2);

            for(let i = 0; i < prev_layer.n_out; i++) {
                for(let j = 0; j < curr_layer.n_out; j++) {
                    r.lineWidth = 1;
                    r.strokeStyle = `rgb(${-curr_layer.W[i][j]*255}, 80, ${curr_layer.W[i][j]*255})`;
                    r.beginPath();
                    r.moveTo(prev_layer.offset_x, prev_layer.offset_y + i*NEURON_SIZE*3);
                    r.lineTo(curr_layer.offset_x, curr_layer.offset_y + j*NEURON_SIZE*3);
                    r.stroke();
                }
            }

        }
        
    }
}



var net = undefined; // global
var agent = undefined; // global
var enemy = undefined;
var obstacle = undefined;

network_render = (ag) => {
    r.fillStyle = "rgb(20,20,20)";
    r.fillRect(0, 0, W, H);
    r.font = "16px serif";

    net.net_render();

    r.fillStyle = "rgb(255, 255, 255)";
    r.fillText(`${[(ag.disp_from_enemy_x).toFixed(2), (ag.disp_from_enemy_y).toFixed(2)]}`, HUD_GLOBAL_X_RENDER_OFFSET-40, HUD_GLOBAL_Y_RENDER_OFFSET);
    r.fillText(`${ag.net_result[0].toFixed(2)}, ${ag.net_result[1].toFixed(2)}, ${ag.net_result[2].toFixed(2)}`, HUD_GLOBAL_X_RENDER_OFFSET+120, HUD_GLOBAL_Y_RENDER_OFFSET);
}

env_render = () => {
    r_env.fillStyle = grad;
    r_env.fillRect(0, 0, W_ENV, H_ENV);

    obstacle.render();

    agent.update();
    agent.render();

    enemy.update();
    enemy.render();

    
    
}

stat_render = () => {
    r_stat.fillStyle = "rgb(10, 10, 10)";
    r_stat.fillRect(0, 0, W_STAT, H_STAT);
    let params = [];
    for(let l of net.layers) {
        for(let i = 0; i < l.n_in; i++) {
            for(let j = 0; j < l.n_out; j++) {
                params.push(l.W[i][j]);
            }
        }
        for(let i = 0; i < l.n_out; i++) {
            params.push(l.B[i]);
        }
    }

    for(let i = 0; i < params.length; i++) {
        r_stat.fillStyle = `rgb(${180-params[i]*255}, ${params[i]*255}, ${params[i]*255/5})`;
        r_stat.fillRect(50+(i%50)*10, 50+Math.round(i/50)*10, 5, 5);
    }

    let gen_num = 0;
    if(generations.length != 0) {
        for(let j = 0; j < generations.length; j++) {
            
            const gen = generations[j];
            const fitness = gen[0];
            const curr_params = gen[1].flat(4);

            
            r_stat.font = "16px serif";
            r_stat.fillStyle = "rgb(255, 255, 255)";
            r_stat.fillText(`Gen. ${gen_num} - ${fitness}`, 25, 150+gen_num*30);
            for(let i = 0; i < curr_params.length; i++) {
                r_stat.fillStyle = `rgb(${180-curr_params[i]*255}, ${curr_params[i]*255}, ${curr_params[i]*255/5})`;
                r_stat.fillRect(150+(i%50)*2, 140+gen_num*30+Math.round(i/50)*2, 2, 2);
            }
        
            gen_num++;
        }
    }

    
    if(best_gen_from_epoch.length != 0) {
     
        r_stat.fillStyle = "rgb(255, 255, 255)";
        r_stat.fillText(`Epoch ${epoch} - Best Fitness=${best_gen_from_epoch[best_gen_from_epoch.length-1][1]}`, W_STAT/2, H_STAT/4);
        let best_gen_params = best_gen_from_epoch[best_gen_from_epoch.length-1][2].flat(4);
        
        //console.log(best_gen_from_epoch[epoch]);
        for(let i = 0; i < best_gen_params.length; i++) {
            r_stat.fillStyle = `rgb(${180-best_gen_params[i]*255}, ${best_gen_params[i]*255}, ${best_gen_params[i]*255/5})`;
            r_stat.fillRect(W_STAT/2+(i%50)*3, H_STAT/3+Math.round(i/50)*3, 3, 3);
        }
    }

    
}



//network_update = (e) => {
  //  res = net.net_feed_forward([e.clientX/W, e.clientY/H]);
    //network_render(e);

//}



class Agent {
    constructor(x, y, theta) {
        this.x = x;
        this.y = y;
        this.theta = theta;

        this.vel_x = 0;
        this.vel_y = 0;

        this.net_result = [0, 0, 0];

        this.is_enemy_close = 0;

        this.disp_from_enemy_x = 0;
        this.disp_from_enemy_y = 0;

    }

    update = () => {
        
        if(Math.sqrt((this.x - enemy.x)**2 + (this.y - enemy.y)**2) < 400) {
            this.is_enemy_close = 1;
        } else {
            this.is_enemy_close = 0;
        }

        this.disp_from_enemy_x = this.is_enemy_close ? (this.x - enemy.x)/400 : 0;
        this.disp_from_enemy_y = this.is_enemy_close ? (this.y - enemy.y)/400 : 0;

        this.net_result = net.net_feed_forward([this.disp_from_enemy_x, 
            this.disp_from_enemy_y, this.theta, this.is_enemy_close])
        
        this.vel_x += this.net_result[0]/200;
        this.vel_y += this.net_result[1]/200;
        this.theta += this.net_result[2]*3.1415*2/200;
        this.is_shoot = this.net_result[3] > 0 ? true : false;
        //this.vel_y += 0.02;
        

        this.x += this.vel_x;
        this.y += this.vel_y;

        if(this.x > W_ENV || this.x < 0 ) {
            //this.x = W_ENV/2;
            //this.y = H_ENV/2;
            this.vel_x *= -1;
        }
        if(this.y > H_ENV || this.y < 0) {
            this.vel_y *= -1;
        }

        this.vel_y += GLOBAL_GRAVITY;

        if(this.is_shoot) {
            this.shoot();
            this.vel_x *= 0.98;
            this.vel_y *= 0.98;
        }

        if(this.x >= obstacle.x && this.x <= obstacle.x+obstacle.width &&
            this.y >= obstacle.y && this.y <= obstacle.y+obstacle.height) {
                this.vel_x *= 0.999;
                this.vel_y *= 0.999;
        }

       
    }

    shoot = () => {
        r_env.lineWidth = 1;
        r_env.strokeStyle = "rgb(255, 40, 0)";
        r_env.beginPath();
        r_env.moveTo(this.x + Math.cos(this.theta)*30, this.y + Math.sin(this.theta)*30);
        r_env.lineTo(this.x + Math.cos(this.theta)*30*10, this.y + Math.sin(this.theta)*30*10);
        r_env.stroke();
    }
        

    render = () => {
        r_env.fillStyle = "rgb(60, 160, 60)";
        r_env.beginPath();
        r_env.arc(this.x, this.y, 15, 0, 2*Math.PI, false);
        r_env.fill();
        
        if(this.is_enemy_close) {
            r_env.lineWidth = 4;
            r_env.strokeStyle = "rgb(200, 0, 0)";
        } else {
            r_env.lineWidth = 2;
            r_env.strokeStyle = "rgb(255,255,255)";
        }
        
        r_env.stroke();

        r_env.lineWidth = 3;
        r_env.strokeStyle = "rgb(190, 0, 0)";
        r_env.beginPath();
        r_env.moveTo(this.x, this.y);
        r_env.lineTo(this.x + Math.cos(this.theta)*30, this.y + Math.sin(this.theta)*30);
        r_env.stroke();



    }
}

class Enemy {
    constructor(x, y, ag) {
        this.x = x;
        this.y = y;
        this.vel_x = 0;
        this.vel_y = 0;
        this.ag = ag;
        this.is_hit = false;
    }

    update = () => {

        this.vel_x += (this.ag.x - this.x)/Math.abs(this.ag.x - this.x)/100;
        this.vel_y += (this.ag.y - this.y)/Math.abs(this.ag.y - this.y)/100;

        this.x += this.vel_x;
        this.y += this.vel_y;

        if(this.x > W_ENV || this.x < 0 ) {
            //this.x = W_ENV/2;
            //this.y = H_ENV/2;
            this.vel_x *= -1;
        }
        if(this.y > H_ENV || this.y < 0) {
            this.vel_y *= -1;
        }

        this.vel_y += GLOBAL_GRAVITY;

        if(this.ag.is_shoot && is_line_intersect_circle([this.ag.x + Math.cos(this.ag.theta)*30, this.ag.y + Math.sin(this.ag.theta)*30],
        [this.ag.x + Math.cos(this.ag.theta)*30*10, this.ag.y + Math.sin(this.ag.theta)*30*10],
        [this.x, this.y], 30)) {
            this.vel_x *= 0.1;
            this.vel_y *= 0.1;
            this.is_hit = true;
        } else {
            this.is_hit = false;
        }

        if(this.x >= obstacle.x && this.x <= obstacle.x+obstacle.width &&
            this.y >= obstacle.y && this.y <= obstacle.y+obstacle.height) {
                this.vel_x *= 0.999;
                this.vel_y *= 0.999;
        }
       

    }
    render = () => {
        r_env.fillStyle = `rgb(${this.is_hit ? 255 : 140}, 60, 60)`;
        r_env.beginPath();
        r_env.arc(this.x, this.y, 30, 0, 2*Math.PI, false);
        r_env.fill();
        r_env.lineWidth = 2;
        r_env.strokeStyle = "rgb(255,255,255)";
        r_env.stroke();

        r_env.lineWidth = 3;
        r_env.strokeStyle = "rgb(255, 255, 0)";
        r_env.beginPath();
        r_env.moveTo(this.x - Math.cos(Math.atan(this.vel_y/this.vel_x))*35, this.y - Math.atan(this.vel_y/this.vel_x)*35);
        r_env.lineTo(this.x + Math.cos(Math.atan(this.vel_y/this.vel_x))*35, this.y + Math.atan(this.vel_y/this.vel_x)*35);
        r_env.stroke();



    }
}

class Obstacle {
    constructor(x, y, width, height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    render = () => {
        r_env.fillStyle = "rgb(0, 20, 40)";
        r_env.fillRect(this.x, this.y, this.width, this.height);
    }
}

var timer = 0;



select_best_gen_from_epoch = () => {
    let curr_max = 0;
    let curr_max_params = undefined;
    for(const g of generations) {
        if(g[0] > curr_max) {
            curr_max_params = g[1];
            curr_max = g[0];
        }
    }
    
    best_gen_from_epoch.push([epoch, curr_max, curr_max_params]);

    // update network
    net.set_weights(best_gen_from_epoch[best_gen_from_epoch.length-1][2]);

    //console.log(best_gen_from_epoch);
    generations = [];
    epoch++;
}

episode_control = () => {
    // episode over, agent mutates
    if((agent.x - enemy.x)**2 + (agent.y - enemy.y)**2 < (45)**2) {
        
        generations.push([timer, net.get_weights()]);
        if(generations.length > MAX_GENERATIONS_PER_EPOCH) {
            select_best_gen_from_epoch();
        }
        
        // mutation rate = 5%
        net.mutate(0.05);
        replay_episode();
    
        timer = 0;
    }

    timer++;

    if(timer > MAX_TIME_PER_GEN) {
        generations.push([timer, net.get_weights()]);
        if(generations.length > MAX_GENERATIONS_PER_EPOCH) {
            select_best_gen_from_epoch();
        }
        
        // mutation rate = 2.5%
        net.mutate(0.025);
        replay_episode();
    
        timer = 0;
    }
}

manual_mutate = () => {
    net.mutate(0.05);
}

replay_episode = () => {
    agent.x = W_ENV/2;
    agent.y = H_ENV/2;
    agent.vel_x = 0;
    agent.vel_y = 0;
    agent.theta = 0;
    agent.is_enemy_close = 0;

    enemy.x = W_ENV*Math.random();
    enemy.y = H_ENV*Math.random();
    enemy.vel_x = 0;
    enemy.vel_y = 0;

    timer = 0;
}

(() => {
    net = new Net(7, [[4, 4], [4, 6], [6, 7], [7, 9], [9, 9], [9, 6], [6, 4]], [id, id, RELU, id, RELU, RELU, clamp]);
    net.init_random_weights();

    agent = new Agent(W_ENV/2+5, H_ENV/2+10, 3.1415/2);
    enemy = new Enemy(W_ENV/4, H_ENV/4, agent);
    obstacle = new Obstacle(W_ENV*1/4, H_ENV*3/4, W_ENV/2, H_ENV/8);

    
    
    console.log(net.get_weights());

    setInterval(env_render, 0);
    setInterval(network_render, 0, agent);
    setInterval(episode_control, 0);
    setInterval(stat_render, 0);
    

    document.querySelector(".start_episode_button").addEventListener("click", replay_episode);
    document.querySelector(".manual_mutate_button").addEventListener("click", manual_mutate);

})();










