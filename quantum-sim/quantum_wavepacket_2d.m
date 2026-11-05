function quantum_wavepacket_2d()
% QUANTUM_WAVEPACKET_2D  Interactive 2D time-dependent Schrodinger equation.
%
%   Solves   i dpsi/dt = [ -1/(2m) (d^2/dx^2 + d^2/dy^2) + V(x,y) ] psi   (hbar = 1)
%   with the split-step Fourier method (FFT2) and animates psi(x,y,t).
%
%   Main plot   : psi(x,y,t) as an image. Views: |psi|^2, sqrt(|psi|^2),
%                 Re(psi), or phase+amplitude (hue = phase, brightness = |psi|).
%                 Potential is drawn as green contour lines.
%   Right plot  : intensity along a vertical "detector screen" at x = screen x:
%                 instantaneous (blue) and time-integrated (red). With a double
%                 slit the red curve builds up the interference pattern.
%
%   Adjustable with the sliders / menus:
%     x0, y0   - initial packet centre
%     sigma    - initial packet width
%     kx, ky   - initial wave vector (momentum = hbar*k)
%     mass     - particle mass
%     V0       - potential strength (wall height, bump height, ...)
%     slit/feature - slit opening width, or width of the Gaussian bump
%     slit sep - centre-to-centre distance of the two slits
%     omega    - harmonic oscillator frequency
%     screen x - position of the detector screen
%     speed    - animation speed
%   Potentials: free, harmonic, single slit, double slit, Gaussian bump.
%
%   Run:  >> quantum_wavepacket_2d

%% ---------------- Numerical grid ----------------
N  = 256;                         % grid points per axis (power of 2)
L  = 60;                          % domain [-L/2, L/2] in x and y
x  = linspace(-L/2, L/2, N+1); x(end) = [];
y  = x;
dx = x(2) - x(1);
[X, Y]   = meshgrid(x, y);        % arrays are indexed (row = y, col = x)
k        = (2*pi/L) * [0:N/2-1, -N/2:-1];
[KX, KY] = meshgrid(k, k);
K2       = KX.^2 + KY.^2;
dt       = 0.02;
wallT    = 1;                     % thickness of the slit wall

% Absorbing layer at the domain edges
edgeW = 6;
g1    = zeros(1, N);
ie    = abs(x) > L/2 - edgeW;
g1(ie) = 4 * ((abs(x(ie)) - (L/2 - edgeW)) / edgeW).^2;
[GX, GY] = meshgrid(g1, g1);
mask  = exp(-(GX + GY) * dt);
R     = L/2 - edgeW/2;            % half-size of the displayed region

%% ---------------- Parameters ----------------
p = struct('x0',-15, 'y0',0, 'sigma',2, 'kx',4, 'ky',0, 'm',1, ...
           'V0',15, 'feat',2, 'sep',8, 'omega',0.15, 'screen',14, ...
           'speed',1, 'pot',4, 'view',1);

psi = zeros(N); V = zeros(N); expV = []; expK = [];
t = 0; playing = true; pmax = 1; amax = 1;
acc = zeros(N,1); ixs = 1; hContour = [];

%% ---------------- Figure & axes ----------------
fig = figure('Name','2D quantum wave packet','NumberTitle','off', ...
             'Color','w','Units','normalized','Position',[0.05 0.05 0.85 0.88]);

axM = axes('Parent',fig,'Position',[0.05 0.42 0.52 0.52]);
hImg = imagesc(axM, x, y, zeros(N));
set(axM,'YDir','normal'); hold(axM,'on');
axis(axM,'image'); xlim(axM,[-R R]); ylim(axM,[-R R]);
xlabel(axM,'x'); ylabel(axM,'y');
hScrLine = plot(axM,[p.screen p.screen],[-R R],'--','Color',[0.8 0.8 0.8],'LineWidth',1);
hTitle = title(axM,'');

axS = axes('Parent',fig,'Position',[0.66 0.42 0.30 0.52]); hold(axS,'on');
hAcc  = plot(axS, zeros(N,1), y, 'r', 'LineWidth',1.8);
hInst = plot(axS, zeros(N,1), y, 'b', 'LineWidth',1.0);
xlim(axS,[0 1.05]); ylim(axS,[-R R]); grid(axS,'on'); box(axS,'on');
xlabel(axS,'intensity at screen (normalised)'); ylabel(axS,'y');
legend(axS,{'time-integrated','instantaneous'},'Location','southeast');
title(axS,'Detector screen');

%% ---------------- Controls ----------------
specs = { ... % name      label           min    max   format
    'x0',     'x0',            -22,   22,   '%.1f';
    'y0',     'y0',            -22,   22,   '%.1f';
    'sigma',  'sigma',         0.8,   6,    '%.2f';
    'kx',     'kx',            -8,    8,    '%.2f';
    'ky',     'ky',            -8,    8,    '%.2f';
    'm',      'mass',          0.2,   5,    '%.2f';
    'V0',     'V0',            0,     40,   '%.1f';
    'feat',   'slit/feature',  0.5,   10,   '%.2f';
    'sep',    'slit sep',      2,     20,   '%.1f';
    'omega',  'omega',         0.02,  0.5,  '%.3f';
    'screen', 'screen x',      -20,   22,   '%.1f';
    'speed',  'speed',         0.2,   5,    '%.2f'};

lbl = struct(); fmt = struct();
for i = 1:size(specs,1)
    name = specs{i,1};
    fmt.(name) = specs{i,5};
    col  = ceil(i/4) - 1;                 % 3 columns of 4 sliders
    row  = mod(i-1,4);
    xpos = 0.03 + 0.32*col;
    ypos = 0.30 - 0.065*row;
    uicontrol(fig,'Style','text','Units','normalized', ...
        'Position',[xpos ypos 0.07 0.04],'String',specs{i,2}, ...
        'BackgroundColor','w','HorizontalAlignment','left','FontSize',10);
    uicontrol(fig,'Style','slider','Units','normalized', ...
        'Position',[xpos+0.07 ypos+0.005 0.14 0.03], ...
        'Min',specs{i,3},'Max',specs{i,4},'Value',p.(name), ...
        'Callback',@(s,~) setParam(name, s.Value));
    lbl.(name) = uicontrol(fig,'Style','text','Units','normalized', ...
        'Position',[xpos+0.215 ypos 0.05 0.04],'BackgroundColor','w', ...
        'String',sprintf(specs{i,5},p.(name)),'FontSize',10);
end

uicontrol(fig,'Style','text','Units','normalized','Position',[0.03 0.035 0.07 0.04], ...
    'String','Potential','BackgroundColor','w','HorizontalAlignment','left','FontSize',10);
uicontrol(fig,'Style','popupmenu','Units','normalized','Position',[0.10 0.04 0.20 0.04], ...
    'String',{'Free particle','Harmonic oscillator','Single slit','Double slit','Gaussian bump'}, ...
    'Value',p.pot,'Callback',@(s,~) setPotential(s.Value));

uicontrol(fig,'Style','text','Units','normalized','Position',[0.35 0.035 0.07 0.04], ...
    'String','View','BackgroundColor','w','HorizontalAlignment','left','FontSize',10);
uicontrol(fig,'Style','popupmenu','Units','normalized','Position',[0.42 0.04 0.20 0.04], ...
    'String',{'|psi|^2','sqrt(|psi|^2)','Re(psi)','Phase + amplitude'}, ...
    'Value',p.view,'Callback',@(s,~) setView(s.Value));

uicontrol(fig,'Style','pushbutton','Units','normalized','Position',[0.67 0.04 0.12 0.05], ...
    'String','Pause / Play','FontSize',10,'Callback',@(~,~) togglePlay());
uicontrol(fig,'Style','pushbutton','Units','normalized','Position',[0.81 0.04 0.12 0.05], ...
    'String','Reset','FontSize',10,'Callback',@(~,~) resetSim());

%% ---------------- Start ----------------
resetSim();

while ishandle(fig)
    if playing
        nsteps = max(1, round(2*p.speed));
        for s = 1:nsteps
            psi = expV .* psi;                    % half step in potential
            psi = ifft2(expK .* fft2(psi));       % full kinetic step
            psi = expV .* psi;                    % half step in potential
            psi = mask .* psi;                    % absorbing edges
            t   = t + dt;
        end
        acc = acc + abs(psi(:,ixs)).^2 * dt * nsteps;
        updatePlot();
    end
    drawnow limitrate;
end

%% ================= Nested functions =================
    function setParam(name, val)
        p.(name) = val;
        set(lbl.(name),'String',sprintf(fmt.(name), val));
        if any(strcmp(name,{'x0','y0','sigma','kx','ky'}))
            resetSim();
        elseif strcmp(name,'screen')
            updateScreen();
            updatePlot();
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

    function setView(val)
        p.view = val;
        applyView();
        updatePlot();
    end

    function togglePlay()
        playing = ~playing;
    end

    function updateScreen()
        [~, ixs] = min(abs(x - p.screen));
        acc = zeros(N,1);
        set(hScrLine,'XData',[p.screen p.screen]);
    end

    function buildOperators()
        wall = abs(X) < wallT/2;
        switch p.pot
            case 1                                   % free
                V = zeros(N);
            case 2                                   % harmonic
                V = 0.5 * p.m * p.omega^2 * (X.^2 + Y.^2);
            case 3                                   % single slit
                open = abs(Y) < p.feat/2;
                V = p.V0 * (wall & ~open);
            case 4                                   % double slit
                open = abs(abs(Y) - p.sep/2) < p.feat/2;
                V = p.V0 * (wall & ~open);
            case 5                                   % Gaussian bump
                V = p.V0 * exp(-(X.^2 + Y.^2) / (2*p.feat^2));
        end
        expV = exp(-1i * V * dt/2);
        expK = exp(-1i * K2 * dt / (2*p.m));
        drawPotential();
    end

    function drawPotential()
        if ~isempty(hContour) && isgraphics(hContour), delete(hContour); end
        hContour = [];
        Vmax = max(V(:));
        if Vmax > 0
            if p.pot == 2 || p.pot == 5
                lev = Vmax * (0.05:0.15:0.9);
            else
                lev = 0.5 * Vmax * [1 1];
            end
            [~, hContour] = contour(axM, x, y, V, lev, ...
                'LineColor',[0 1 0.4],'LineWidth',1.3);
        end
    end

    function resetSim()
        t = 0;
        psi = exp(-((X-p.x0).^2 + (Y-p.y0).^2) / (4*p.sigma^2)) ...
              .* exp(1i*(p.kx*X + p.ky*Y));
        psi = psi / sqrt(sum(abs(psi(:)).^2) * dx^2);    % normalise
        pmax = 0.5 * max(abs(psi(:)).^2);
        amax = max(abs(psi(:)));
        buildOperators();
        updateScreen();
        applyView();
        updatePlot();
    end

    function applyView()
        switch p.view
            case 1
                colormap(axM, hot(256));  caxis(axM,[0 pmax]);
            case 2
                colormap(axM, hot(256));  caxis(axM,[0 sqrt(pmax)]);
            case 3
                n = 128;
                bwr = [linspace(0,1,n)' linspace(0,1,n)' ones(n,1); ...
                       ones(n,1) linspace(1,0,n)' linspace(1,0,n)'];
                colormap(axM, bwr);       caxis(axM,[-amax amax]);
            case 4
                % truecolor image; colormap not used
        end
    end

    function updatePlot()
        prob = abs(psi).^2;
        switch p.view
            case 1, C = prob;
            case 2, C = sqrt(prob);
            case 3, C = real(psi);
            case 4
                H  = (angle(psi) + pi) / (2*pi);
                Vv = min(1, abs(psi)/amax).^0.7;
                C  = hsv2rgb(cat(3, H, ones(N), Vv));
        end
        set(hImg,'CData',C);

        % detector screen
        inst = prob(:, ixs);
        set(hInst,'XData', inst / max(max(inst), eps), 'YData', y);
        set(hAcc, 'XData', acc  / max(max(acc),  eps), 'YData', y);

        nrm  = sum(prob(:)) * dx^2;
        Pr   = sum(sum(prob(:, x > 0))) * dx^2;
        set(hTitle,'String',sprintf( ...
            't = %.2f      norm = %.3f      P(x>0) = %.3f', t, nrm, Pr));
    end
end
