function quantum_eigenstates_3d()
% QUANTUM_EIGENSTATES_3D  Visualize 3D energy eigenstates (stationary states).
%
%   Systems (choose from the menu):
%     1. Hydrogen atom            quantum numbers n, l, m
%     2. Particle in a cubic box  quantum numbers nx, ny, nz
%     3. 3D harmonic oscillator   quantum numbers nx, ny, nz
%
%   Left   : 3D surface of constant probability density |psi|^2, chosen so the
%            surface encloses a given fraction of the total probability.
%            Colour = phase of psi(x,y,z,t) = psi(x,y,z) * exp(-i E t).
%            For an eigenstate |psi|^2 is static; only the phase rotates.
%   Right  : cross-section of |psi| in the y = 0 plane.
%
%   Controls: system menu, three quantum-number sliders, enclosed-probability
%   slider, cutaway checkbox, Pause/Play. Drag in the 3D plot to rotate.
%
%   Units: hydrogen in Hartree atomic units (a0 = 1); box has side L = 1 with
%   hbar = m = 1; oscillator has hbar = m = omega = 1.
%
%   Run:  >> quantum_eigenstates_3d

%% ---------------- Shared state ----------------
Ng   = 91;                        % grid points per axis (odd -> includes 0)
sys  = 1;                         % 1 hydrogen, 2 box, 3 oscillator
q    = [3 2 1];                   % quantum numbers
frac = 0.85;                      % enclosed probability for the surface
cut  = false;                     % cutaway on/off
playing = true;
defaults = [3 2 1; 2 2 1; 2 1 1];
qnames   = {{'n','l','m'}, {'nx','ny','nz'}, {'nx','ny','nz'}};

psiFun = []; prob = []; vals = []; cum = [];
Xg = []; Yg = []; Zg = []; xg = []; ext = 1; E = 1; tt = 0;
hP = []; fullFaces = []; psiV = []; vertsY = [];

%% ---------------- Figure & axes ----------------
fig = figure('Name','3D energy eigenstates','NumberTitle','off','Color','w', ...
             'Units','normalized','Position',[0.05 0.07 0.88 0.85]);

ax3 = axes('Parent',fig,'Position',[0.04 0.06 0.52 0.86]);
hold(ax3,'on'); axis(ax3,'equal'); axis(ax3,'vis3d'); grid(ax3,'on'); box(ax3,'on');
xlabel(ax3,'x'); ylabel(ax3,'y'); zlabel(ax3,'z');
view(ax3,35,25);
light(ax3,'Position',[1 1 1],'Style','infinite');
light(ax3,'Position',[-1 -1 -0.5],'Style','infinite','Color',[0.5 0.5 0.5]);
colormap(ax3, hsv(256)); caxis(ax3,[-pi pi]);
cb = colorbar(ax3);
set(cb,'Ticks',[-pi 0 pi],'TickLabels',{'-pi','0','pi'});
cb.Label.String = 'phase of psi';
set(cb,'Position',[0.575 0.30 0.012 0.40]);
set(ax3,'Position',[0.04 0.06 0.52 0.86]);
rotate3d(ax3,'on');
hTitle = title(ax3,'','Interpreter','none','FontSize',11);

axS = axes('Parent',fig,'Position',[0.68 0.56 0.28 0.36]);
hImgS = imagesc(axS, [-1 1], [-1 1], zeros(2));
set(axS,'YDir','normal'); axis(axS,'image'); colormap(axS, hot(256));
xlabel(axS,'x'); ylabel(axS,'z');
title(axS,'cross-section of |psi| at y = 0');

%% ---------------- Controls ----------------
uicontrol(fig,'Style','text','Units','normalized','Position',[0.62 0.47 0.08 0.035], ...
    'String','System','BackgroundColor','w','HorizontalAlignment','left','FontSize',10);
uicontrol(fig,'Style','popupmenu','Units','normalized','Position',[0.70 0.475 0.26 0.035], ...
    'String',{'Hydrogen atom','3D particle in a box','3D harmonic oscillator'}, ...
    'Value',sys,'FontSize',10,'Callback',@(s,~) setSystem(s.Value));

hS = gobjects(1,3); hLab = gobjects(1,3);
for i = 1:3
    ypos = 0.40 - 0.065*(i-1);
    hLab(i) = uicontrol(fig,'Style','text','Units','normalized', ...
        'Position',[0.62 ypos 0.08 0.035],'String','', ...
        'BackgroundColor','w','HorizontalAlignment','left','FontSize',10);
    hS(i) = uicontrol(fig,'Style','slider','Units','normalized', ...
        'Position',[0.70 ypos+0.005 0.26 0.03],'Min',0,'Max',1,'Value',0, ...
        'Callback',@(s,~) setQ(i, s.Value));
end

hFracLab = uicontrol(fig,'Style','text','Units','normalized', ...
    'Position',[0.62 0.205 0.08 0.035],'String','','BackgroundColor','w', ...
    'HorizontalAlignment','left','FontSize',10);
uicontrol(fig,'Style','slider','Units','normalized','Position',[0.70 0.21 0.26 0.03], ...
    'Min',0.30,'Max',0.99,'Value',frac,'Callback',@(s,~) setFrac(s.Value));

uicontrol(fig,'Style','checkbox','Units','normalized','Position',[0.62 0.14 0.34 0.035], ...
    'String','Cutaway (remove front half of surface)','Value',0, ...
    'BackgroundColor','w','FontSize',10,'Callback',@(s,~) setCut(s.Value));

uicontrol(fig,'Style','pushbutton','Units','normalized','Position',[0.62 0.07 0.14 0.05], ...
    'String','Pause / Play','FontSize',10,'Callback',@(~,~) togglePlay());
uicontrol(fig,'Style','text','Units','normalized','Position',[0.78 0.06 0.19 0.06], ...
    'String','Drag in the 3D plot to rotate.','BackgroundColor','w', ...
    'HorizontalAlignment','left','FontSize',9);

%% ---------------- Start ----------------
computeState();

while ishandle(fig)
    if playing
        tt = tt + 0.1 / abs(E);          % phase advances by 0.1 rad per frame
        updateColors();
    else
        pause(0.03);
    end
    drawnow limitrate;
end

%% ================= Nested functions =================
    function setSystem(v)
        sys = v;
        q   = defaults(v,:);
        computeState();
    end

    function setQ(i, val)
        q(i) = round(val);
        computeState();
    end

    function setFrac(val)
        frac = val;
        buildSurface();
        updateTitle();
    end

    function setCut(val)
        cut = logical(val);
        applyCut();
    end

    function togglePlay()
        playing = ~playing;
    end

    function constrain()
        switch sys
            case 1
                q(1) = min(max(q(1),1),4);
                q(2) = min(max(q(2),0),q(1)-1);
                q(3) = min(max(q(3),-q(2)),q(2));
            case 2
                q = min(max(q,1),4);
            case 3
                q = min(max(q,0),3);
        end
    end

    function configSliders()
        switch sys
            case 1, lo = [1 0 -q(2)]; hi = [4 q(1)-1 q(2)];
            case 2, lo = [1 1 1];     hi = [4 4 4];
            case 3, lo = [0 0 0];     hi = [3 3 3];
        end
        for i = 1:3
            configSlider(hS(i), lo(i), hi(i), q(i));
            set(hLab(i),'String',sprintf('%s = %d', qnames{sys}{i}, q(i)));
        end
        set(hFracLab,'String',sprintf('inside %d%%', round(100*frac)));
    end

    function computeState()
        constrain();
        configSliders();
        switch sys
            case 1
                n = q(1); l = q(2); m = q(3);
                ext = 1.3*n^2 + 3*n + 2;
                E   = -1/(2*n^2);
                psiFun = @(a,b,c) hydPsi(a,b,c,n,l,m);
            case 2
                qq = q;
                ext = 0.55;
                E   = pi^2 * sum(qq.^2) / 2;
                psiFun = @(a,b,c) boxPsi(a,b,c,qq);
            case 3
                qq = q;
                ext = sqrt(2*max(qq)+1) + 2.5;
                E   = sum(qq) + 1.5;
                psiFun = @(a,b,c) hoPsi(a,b,c,qq);
        end
        xg = linspace(-ext, ext, Ng);
        [Xg, Yg, Zg] = meshgrid(xg, xg, xg);
        psi0 = psiFun(Xg, Yg, Zg);
        prob = abs(psi0).^2;
        vals = sort(prob(:), 'descend');
        cum  = cumsum(vals);
        cum  = cum / cum(end);

        % cross-section in the y = 0 plane (rows: z, columns: x)
        iy = (Ng+1)/2;
        sl = squeeze(abs(psi0(iy,:,:)));       % dimensions (x, z)
        set(hImgS,'XData',xg,'YData',xg,'CData',sl');
        set(axS,'XLim',[-ext ext],'YLim',[-ext ext]);

        set(ax3,'XLim',[-ext ext],'YLim',[-ext ext],'ZLim',[-ext ext]);
        tt = 0;
        buildSurface();
        updateTitle();
    end

    function buildSurface()
        set(hFracLab,'String',sprintf('inside %d%%', round(100*frac)));
        if ~isempty(hP) && isgraphics(hP), delete(hP); end
        hP = [];
        idx = find(cum >= frac, 1);
        iso = vals(idx);
        fv  = isosurface(Xg, Yg, Zg, prob, iso);
        if isempty(fv.vertices) || isempty(fv.faces), return; end
        hP = patch(ax3,'Faces',fv.faces,'Vertices',fv.vertices, ...
            'FaceVertexCData',zeros(size(fv.vertices,1),1), ...
            'CDataMapping','scaled','FaceColor','interp','EdgeColor','none', ...
            'FaceLighting','gouraud','AmbientStrength',0.45, ...
            'DiffuseStrength',0.7,'SpecularStrength',0.15);
        isonormals(Xg, Yg, Zg, prob, hP);
        psiV      = psiFun(fv.vertices(:,1), fv.vertices(:,2), fv.vertices(:,3));
        fullFaces = fv.faces;
        vertsY    = fv.vertices(:,2);
        applyCut();
        updateColors();
    end

    function applyCut()
        if isempty(hP) || ~isgraphics(hP), return; end
        if cut
            % default camera sits on the -y side: remove faces with y < 0
            yc   = mean(vertsY(fullFaces), 2);
            keep = yc >= 0;
            set(hP,'Faces',fullFaces(keep,:));
        else
            set(hP,'Faces',fullFaces);
        end
    end

    function updateColors()
        if isempty(hP) || ~isgraphics(hP), return; end
        c = angle(psiV .* exp(-1i * E * tt));
        set(hP,'FaceVertexCData',c);
    end

    function updateTitle()
        switch sys
            case 1
                letters = 'spdfg';
                l1 = sprintf('Hydrogen atom:  n = %d,  l = %d (%s),  m = %d      E = %.4f Hartree = %.3f eV', ...
                    q(1), q(2), letters(q(2)+1), q(3), E, E*27.2114);
            case 2
                l1 = sprintf('Particle in a cube:  (nx, ny, nz) = (%d, %d, %d)      E = %.3f  (hbar = m = L = 1)', ...
                    q(1), q(2), q(3), E);
            case 3
                l1 = sprintf('3D harmonic oscillator:  (nx, ny, nz) = (%d, %d, %d)      E = %.1f hbar*omega', ...
                    q(1), q(2), q(3), E);
        end
        l2 = sprintf('surface of constant |psi|^2 enclosing %d%% of the probability;  colour = phase of psi(t)', ...
            round(100*frac));
        set(hTitle,'String',{l1, l2});
    end
end

%% ================= Local functions =================
function configSlider(h, lo, hi, val)
% Configure an integer slider; disable it when only one value is allowed.
    set(h,'Min',-100,'Max',100);
    if hi == lo
        set(h,'Value',lo);
        set(h,'Min',lo,'Max',lo+1,'Enable','off');
    else
        set(h,'Value',val);
        set(h,'Min',lo,'Max',hi,'SliderStep',[1/(hi-lo) 1/(hi-lo)],'Enable','on');
    end
end

function psi = hydPsi(a, b, c, n, l, m)
% Hydrogen eigenfunction R_nl(r) * Y_lm(theta, phi), atomic units.
    r   = max(sqrt(a.^2 + b.^2 + c.^2), 1e-12);
    ct  = max(min(c ./ r, 1), -1);
    phi = atan2(b, a);

    rho = 2*r/n;
    k   = n - l - 1;
    alp = 2*l + 1;
    Lag = zeros(size(r));                         % generalized Laguerre L_k^alp(rho)
    for j = 0:k
        coef = (-1)^j * gamma(k+alp+1) / (gamma(k-j+1) * gamma(alp+j+1)) / factorial(j);
        Lag  = Lag + coef * rho.^j;
    end
    Rn = sqrt((2/n)^3 * factorial(n-l-1) / (2*n*factorial(n+l)));
    R  = Rn * exp(-rho/2) .* rho.^l .* Lag;

    mm  = abs(m);
    P   = legendre(l, ct(:)');                    % rows: order 0..l
    Plm = reshape(P(mm+1,:), size(r));
    Nlm = sqrt((2*l+1)/(4*pi) * factorial(l-mm)/factorial(l+mm));
    psi = R .* (Nlm * Plm .* exp(1i*m*phi));
end

function psi = boxPsi(a, b, c, q)
% Particle in a cube of side L = 1 centred at the origin.
    L = 1;
    f = @(x,n) sqrt(2/L) * sin(n*pi*(x + L/2)/L) .* (abs(x) <= L/2);
    psi = f(a,q(1)) .* f(b,q(2)) .* f(c,q(3));
end

function psi = hoPsi(a, b, c, q)
% 3D isotropic harmonic oscillator, Cartesian eigenstates.
    psi = hoFun(a,q(1)) .* hoFun(b,q(2)) .* hoFun(c,q(3));
end

function f = hoFun(x, n)
% 1D oscillator eigenfunction (hbar = m = omega = 1) via Hermite recurrence.
    if n == 0
        H = ones(size(x));
    else
        Hprev = ones(size(x));
        Hcur  = 2*x;
        for j = 1:n-1
            Hnext = 2*x.*Hcur - 2*j*Hprev;
            Hprev = Hcur;
            Hcur  = Hnext;
        end
        H = Hcur;
    end
    f = pi^(-1/4) / sqrt(2^n * factorial(n)) * H .* exp(-x.^2/2);
end
