function quantum_wavepacket()
% QUANTUM_WAVEPACKET  Interactive 1D time-dependent Schrodinger equation.
%
%   Solves   i dpsi/dt = [ -1/(2m) d^2/dx^2 + V(x) ] psi    (hbar = 1)
%   with the split-step Fourier method and animates psi(x,t).
%
%   Top plot    : Re(psi), Im(psi), |psi| and the (scaled) potential V(x)
%   Bottom plot : probability density |psi|^2
%
%   Adjustable with the sliders / menu:
%     x0     - initial position of the packet
%     sigma  - initial width (std. dev. of |psi|^2)
%     k0     - initial wave number (momentum = hbar*k0)
%     m      - particle mass
%     V0     - height of barrier / step, or depth of well
%     width  - width of barrier / well
%     omega  - frequency of the harmonic oscillator
%     speed  - animation speed
%   Potential types: free, harmonic, barrier, well, step.
%
%   Run:  >> quantum_wavepacket

%% ---------------- Numerical grid ----------------
N  = 2048;                    % grid points (power of 2 for FFT)
L  = 100;                     % domain length  [-L/2, L/2]
x  = linspace(-L/2, L/2, N+1); x(end) = [];
dx = x(2) - x(1);
k  = (2*pi/L) * [0:N/2-1, -N/2:-1];   % wave numbers (FFT ordering)
dt = 0.01;                    % time step

% Absorbing layer near the edges (prevents wrap-around reflections)
edgeW = 10;
gam   = zeros(size(x));
idx   = abs(x) > L/2 - edgeW;
gam(idx) = 0.5 * ((abs(x(idx)) - (L/2 - edgeW)) / edgeW).^2;
mask  = exp(-gam * dt);

%% ---------------- Parameters ----------------
p = struct('x0',-15, 'sigma',2, 'k0',3, 'm',1, ...
           'V0',3, 'width',3, 'omega',0.2, 'speed',1, 'pot',3);

psi = zeros(size(x)); V = zeros(size(x));
expV = []; expK = []; t = 0; playing = true; ymax = 1;

%% ---------------- Figure & axes ----------------
fig = figure('Name','Quantum wave packet','NumberTitle','off', ...
             'Color','w','Units','normalized','Position',[0.1 0.08 0.7 0.82]);

ax1 = axes('Parent',fig,'Position',[0.07 0.62 0.90 0.33]); hold(ax1,'on');
hRe = plot(ax1, x, 0*x, 'b',  'LineWidth',1.2);
hIm = plot(ax1, x, 0*x, 'r',  'LineWidth',1.2);
hAb = plot(ax1, x, 0*x, 'k',  'LineWidth',1.8);
hV  = plot(ax1, x, 0*x, 'Color',[0.1 0.6 0.1], 'LineStyle','--', 'LineWidth',1.5);
xlim(ax1,[-L/2+edgeW, L/2-edgeW]); grid(ax1,'on'); box(ax1,'on');
ylabel(ax1,'\psi(x,t)');
legend(ax1,{'Re \psi','Im \psi','|\psi|','V(x) (scaled)'}, ...
       'Location','northeast','Orientation','horizontal');
hTitle = title(ax1,'');

ax2 = axes('Parent',fig,'Position',[0.07 0.37 0.90 0.18]); hold(ax2,'on');
hArea = area(ax2, x, 0*x, 'FaceColor',[0.3 0.5 0.9], 'FaceAlpha',0.4, ...
             'EdgeColor',[0.1 0.2 0.6], 'LineWidth',1.2);
hExp  = plot(ax2, [0 0], [0 1], 'r--', 'LineWidth',1.2);
xlim(ax2,[-L/2+edgeW, L/2-edgeW]); grid(ax2,'on'); box(ax2,'on');
xlabel(ax2,'x'); ylabel(ax2,'|\psi|^2');

%% ---------------- Controls ----------------
specs = { ... % name        label      min    max    format
    'x0',    'x0',        -35,   35,   '%.1f';
    'sigma', '\sigma',     0.5,  8,    '%.2f';
    'k0',    'k0',        -8,    8,    '%.2f';
    'm',     'mass m',     0.2,  5,    '%.2f';
    'V0',    'V0',         0,    15,   '%.2f';
    'width', 'width',      0.2,  15,   '%.2f';
    'omega', '\omega',     0.02, 1,    '%.2f';
    'speed', 'speed',      0.2,  5,    '%.2f'};

lbl = struct();
for i = 1:size(specs,1)
    name = specs{i,1};
    col  = ceil(i/4) - 1;               % 2 columns of 4 sliders
    row  = mod(i-1,4);
    xpos = 0.07 + 0.31*col;
    ypos = 0.27 - 0.065*row;
    uicontrol(fig,'Style','text','Units','normalized', ...
        'Position',[xpos ypos 0.06 0.04],'String',strrep(specs{i,2},'\',''), ...
        'BackgroundColor','w','HorizontalAlignment','left','FontSize',10);
    uicontrol(fig,'Style','slider','Units','normalized', ...
        'Position',[xpos+0.06 ypos+0.005 0.17 0.03], ...
        'Min',specs{i,3},'Max',specs{i,4},'Value',p.(name), ...
        'Callback',@(s,~) setParam(name, s.Value));
    lbl.(name) = uicontrol(fig,'Style','text','Units','normalized', ...
        'Position',[xpos+0.235 ypos 0.05 0.04],'BackgroundColor','w', ...
        'String',sprintf(specs{i,5},p.(name)),'FontSize',10);
end
fmt = struct('x0','%.1f','sigma','%.2f','k0','%.2f','m','%.2f', ...
             'V0','%.2f','width','%.2f','omega','%.2f','speed','%.2f');

uicontrol(fig,'Style','text','Units','normalized','Position',[0.69 0.265 0.08 0.04], ...
    'String','Potential:','BackgroundColor','w','HorizontalAlignment','left','FontSize',10);
uicontrol(fig,'Style','popupmenu','Units','normalized', ...
    'Position',[0.77 0.27 0.18 0.04], ...
    'String',{'Free particle','Harmonic oscillator','Barrier','Well','Step'}, ...
    'Value',p.pot,'Callback',@(s,~) setPotential(s.Value));

uicontrol(fig,'Style','pushbutton','Units','normalized', ...
    'Position',[0.69 0.19 0.12 0.05],'String','Pause / Play','FontSize',10, ...
    'Callback',@(~,~) togglePlay());
uicontrol(fig,'Style','pushbutton','Units','normalized', ...
    'Position',[0.83 0.19 0.12 0.05],'String','Reset','FontSize',10, ...
    'Callback',@(~,~) resetSim());

uicontrol(fig,'Style','text','Units','normalized','Position',[0.69 0.04 0.28 0.12], ...
    'BackgroundColor','w','HorizontalAlignment','left','FontSize',9, ...
    'String',sprintf(['hbar = 1.  Changing x0, sigma or k0 restarts the packet;\n' ...
                      'other parameters change the dynamics on the fly.']));

%% ---------------- Start ----------------
buildOperators();
resetSim();

while ishandle(fig)
    if playing
        nsteps = max(1, round(3*p.speed));
        for s = 1:nsteps
            psi = expV .* psi;                    % half step in potential
            psi = ifft(expK .* fft(psi));         % full kinetic step
            psi = expV .* psi;                    % half step in potential
            psi = mask .* psi;                    % absorbing edges
            t   = t + dt;
        end
        updatePlot();
    end
    drawnow limitrate;
end

%% ================= Nested functions =================
    function setParam(name, val)
        p.(name) = val;
        set(lbl.(name),'String',sprintf(fmt.(name), val));
        if any(strcmp(name,{'x0','sigma','k0'}))
            resetSim();
        else
            buildOperators();
            updatePlot();
        end
    end

    function setPotential(val)
        p.pot = val;
        buildOperators();
        updatePlot();
    end

    function togglePlay()
        playing = ~playing;
    end

    function buildOperators()
        switch p.pot
            case 1, V = zeros(size(x));
            case 2, V = 0.5 * p.m * p.omega^2 * x.^2;
            case 3, V = p.V0 * (abs(x) < p.width/2);
            case 4, V = -p.V0 * (abs(x) < p.width/2);
            case 5, V = p.V0 * (x > 0);
        end
        expV = exp(-1i * V * dt/2);
        expK = exp(-1i * k.^2 * dt / (2*p.m));
    end

    function resetSim()
        t   = 0;
        psi = (2*pi*p.sigma^2)^(-1/4) * exp(-(x-p.x0).^2/(4*p.sigma^2)) ...
              .* exp(1i*p.k0*x);
        psi = psi / sqrt(sum(abs(psi).^2)*dx);    % normalise
        ymax = 1.15 * max(abs(psi));
        ylim(ax1, [-ymax ymax]);
        ylim(ax2, [0 ymax^2]);
        buildOperators();
        updatePlot();
    end

    function updatePlot()
        prob = abs(psi).^2;
        set(hRe,'YData',real(psi));
        set(hIm,'YData',imag(psi));
        set(hAb,'YData',abs(psi));
        set(hArea,'YData',prob);

        % scaled potential for display
        Vmax = max(abs(V));
        if Vmax > 0, Vs = 0.9*ymax * V / Vmax; else, Vs = 0*V; end
        set(hV,'YData',Vs);

        xm = sum(x .* prob) * dx;                 % <x>
        set(hExp,'XData',[xm xm],'YData',[0 ymax^2]);

        % Energy expectation value
        E = real(sum(conj(psi) .* ifft((k.^2/(2*p.m)) .* fft(psi))) * dx ...
                 + sum(V .* prob) * dx);
        set(hTitle,'String',sprintf( ...
            't = %.2f     <x> = %.2f     <E> = %.3f     norm = %.4f', ...
            t, xm, E, sum(prob)*dx));
        if ymax^2 > 0 && max(prob) > ymax^2   % keep density in view
            ylim(ax2,[0 1.1*max(prob)]);
        end
    end
end
