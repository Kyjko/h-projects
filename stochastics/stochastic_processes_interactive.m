function stochastic_processes_interactive()
% STOCHASTIC_PROCESSES_INTERACTIVE  Interactive demo of three stochastic processes
%
%   1) Brownian motion with drift       dX = mu dt + sigma dW
%   2) Geometric Brownian motion        dS = mu S dt + sigma S dW
%   3) Mean-reverting (Ornstein-Uhlenbeck)  dX = theta (mu - X) dt + sigma dW
%
%   Run:   >> stochastic_processes_interactive
%
%   Drag the sliders on the left; all plots update live.
%   - "New random draw" generates new noise (the paths change shape).
%   - "Reset" restores the default parameters.
%   Because the noise is held fixed while you move a slider, you see the
%   *effect of the parameter itself* (paths morph smoothly instead of
%   reshuffling randomly).
%
%   Plots (one row per process):
%     LEFT : sample paths (3 highlighted), theoretical mean (black) and
%            +/- 1 std. deviation band (dashed + shaded)
%     RIGHT: histogram of the end-points X_T with the exact theoretical
%            density (black curve); the y-axis is shared with the left plot
%
%   Requires MATLAB R2016b+ (no toolboxes).

%% Fixed settings
nSteps = 300;      % time steps
nPaths = 4000;     % simulated paths (for histograms / statistics)
nShow  = 25;       % paths drawn on the left
nBins  = 50;       % histogram bins
seed   = 42;       % initial random seed
Z      = [];       % standard-normal shocks, [nPaths x nSteps]

colBM  = [0.00 0.45 0.74];
colGBM = [0.47 0.67 0.19];
colOU  = [0.85 0.33 0.10];
bg     = [0.95 0.95 0.95];

%% Figure and axes
fig = figure('Color','w', 'Position',[40 40 1400 900], ...
             'Name','Interactive stochastic processes', 'NumberTitle','off');

rowY = [0.70 0.38 0.06];
rowH = 0.20;
axP = gobjects(1,3);  axH = gobjects(1,3);
for r = 1:3
    axP(r) = axes('Parent',fig, 'Position',[0.35 rowY(r) 0.40 rowH]);
    axH(r) = axes('Parent',fig, 'Position',[0.81 rowY(r) 0.16 rowH]);
    for ax = [axP(r) axH(r)]
        box(ax,'on'); grid(ax,'on'); set(ax,'FontSize',10);
    end
    set(axH(r), 'YTickLabel', []);
    linkaxes([axP(r) axH(r)], 'y');
end

%% Control panels
mu_ = char(956); sg_ = char(963); th_ = char(952);   % greek letters for labels
ctrl = struct();

pG = uipanel(fig,'Title','Simulation','Units','normalized', ...
    'Position',[0.01 0.84 0.28 0.14],'BackgroundColor',bg,'FontWeight','bold');
ctrl.T = addSlider(pG, 1, 2, 'Horizon  T', 0.5, 5, 1, '%.1f', @update);
uicontrol(pG,'Style','pushbutton','Units','normalized', ...
    'Position',[0.03 0.06 0.45 0.34],'String','New random draw', ...
    'Callback',@(~,~)newNoise());
uicontrol(pG,'Style','pushbutton','Units','normalized', ...
    'Position',[0.52 0.06 0.45 0.34],'String','Reset parameters', ...
    'Callback',@(~,~)resetAll());

pB = uipanel(fig,'Title',['Brownian motion:  dX = ' mu_ ' dt + ' sg_ ' dW'], ...
    'Units','normalized','Position',[0.01 0.63 0.28 0.19], ...
    'BackgroundColor',bg,'FontWeight','bold','ForegroundColor',colBM*0.8);
ctrl.bmMu    = addSlider(pB, 1, 3, [mu_ ' (drift)'],      -2,  2,  0,    '%.2f', @update);
ctrl.bmSigma = addSlider(pB, 2, 3, [sg_ ' (volatility)'], 0.05, 3, 1,    '%.2f', @update);
ctrl.bmX0    = addSlider(pB, 3, 3, 'X_0 (start)',         -3,  3,  0,    '%.2f', @update);

pG2 = uipanel(fig,'Title',['Geometric BM:  dS = ' mu_ ' S dt + ' sg_ ' S dW'], ...
    'Units','normalized','Position',[0.01 0.42 0.28 0.19], ...
    'BackgroundColor',bg,'FontWeight','bold','ForegroundColor',colGBM*0.7);
ctrl.gbmMu    = addSlider(pG2, 1, 3, [mu_ ' (growth)'],     -0.5, 0.5, 0.20, '%.2f', @update);
ctrl.gbmSigma = addSlider(pG2, 2, 3, [sg_ ' (volatility)'],  0.02, 1,  0.30, '%.2f', @update);
ctrl.gbmS0    = addSlider(pG2, 3, 3, 'S_0 (start)',          20,  200, 100,  '%.0f', @update);

pO = uipanel(fig,'Title',['Mean reversion:  dX = ' th_ '(' mu_ ' - X) dt + ' sg_ ' dW'], ...
    'Units','normalized','Position',[0.01 0.15 0.28 0.25], ...
    'BackgroundColor',bg,'FontWeight','bold','ForegroundColor',colOU*0.8);
ctrl.ouTheta = addSlider(pO, 1, 4, [th_ ' (reversion speed)'],  0.1, 10, 3,   '%.2f', @update);
ctrl.ouMu    = addSlider(pO, 2, 4, [mu_ ' (long-run mean)'],   -2,   2,  0,   '%.2f', @update);
ctrl.ouSigma = addSlider(pO, 3, 4, [sg_ ' (volatility)'],       0.05, 2, 0.5, '%.2f', @update);
ctrl.ouX0    = addSlider(pO, 4, 4, 'X_0 (start)',              -3,   3,  2,   '%.2f', @update);

uicontrol(fig,'Style','text','Units','normalized','Position',[0.01 0.02 0.28 0.11], ...
    'BackgroundColor','w','HorizontalAlignment','left','FontSize',9, ...
    'String',['Tip: the noise is frozen while you drag, so you see the pure effect ' ...
              'of each parameter. Try a large reversion speed (' th_ ') with X_0 far ' ...
              'from ' mu_ ', or a large GBM volatility to see how skewed S_T becomes.']);

newNoise();      % generates Z and draws everything

%% ===================== Nested functions (share variables) ===============
    function newNoise()
        rng(seed);
        seed = seed + 1;
        Z = randn(nPaths, nSteps);
        update();
    end

    function resetAll()
        fn = fieldnames(ctrl);
        for i = 1:numel(fn)
            set(ctrl.(fn{i}).sl, 'Value', ctrl.(fn{i}).def);
        end
        update();
    end

    function v = val(name)
        v = get(ctrl.(name).sl, 'Value');
    end

    function update()
        if isempty(Z), return; end

        % ---- refresh the numeric read-outs next to the sliders
        fn = fieldnames(ctrl);
        for i = 1:numel(fn)
            c = ctrl.(fn{i});
            set(c.tx, 'String', sprintf(c.fmt, get(c.sl,'Value')));
        end

        % ---- read parameters
        T = val('T');
        bmMu = val('bmMu');   bmSig = val('bmSigma');   bmX0 = val('bmX0');
        gMu  = val('gbmMu');  gSig  = val('gbmSigma');  gS0  = val('gbmS0');
        oTh  = val('ouTheta'); oMu  = val('ouMu');      oSig = val('ouSigma');
        oX0  = val('ouX0');

        dt = T / nSteps;
        t  = linspace(0, T, nSteps + 1);
        dW = sqrt(dt) * Z;

        % ---- simulate
        Xbm  = [bmX0*ones(nPaths,1), bmX0 + cumsum(bmMu*dt + bmSig*dW, 2)];
        Xgbm = gS0 * exp([zeros(nPaths,1), cumsum((gMu - 0.5*gSig^2)*dt + gSig*dW, 2)]);

        a = exp(-oTh*dt);
        b = oSig * sqrt((1 - a^2) / (2*oTh));
        Xou = zeros(nPaths, nSteps+1);
        Xou(:,1) = oX0;
        for k = 1:nSteps
            Xou(:,k+1) = oMu + (Xou(:,k) - oMu)*a + b*Z(:,k);
        end

        % ---- theory
        npdf = @(y,m,s) exp(-(y-m).^2 ./ (2*s^2)) ./ (s*sqrt(2*pi));

        mB = bmX0 + bmMu*t;                 sB = bmSig*sqrt(t);
        pdfB = @(y) npdf(y, mB(end), sB(end));

        mG = gS0*exp(gMu*t);                sG = mG .* sqrt(exp(gSig^2*t) - 1);
        lnm = log(gS0) + (gMu - 0.5*gSig^2)*T;   lns = gSig*sqrt(T);
        pdfG = @(y) (y > 0) .* exp(-(log(max(y,eps)) - lnm).^2 ./ (2*lns^2)) ./ ...
                   (max(y,eps)*lns*sqrt(2*pi));

        mO = oMu + (oX0 - oMu)*exp(-oTh*t);
        sO = sqrt(oSig^2/(2*oTh) * (1 - exp(-2*oTh*t)));
        pdfO = @(y) npdf(y, mO(end), sO(end));

        % ---- titles (equation + equation with the current numbers)
        tL = { ...
          'Brownian motion:   $dX_t = \mu\,dt + \sigma\,dW_t$', ...
          sprintf('$dX_t = (%.2f)\\,dt + (%.2f)\\,dW_t$', bmMu, bmSig), ...
          'Solution:   $X_t = X_0 + \mu t + \sigma W_t$'};
        tR = {'Distribution of $X_T$', ...
              sprintf('$\\mathcal{N}(%.2f,\\ %.2f^2)$', mB(end), sB(end))};
        drawRow(axP(1), axH(1), t, Xbm, mB, sB, colBM, tL, tR, pdfB, ...
                nShow, nBins, '$X_t$', -inf, NaN);

        tL = { ...
          'Geometric Brownian motion:   $dS_t = \mu S_t\,dt + \sigma S_t\,dW_t$', ...
          sprintf('$dS_t = (%.2f)\\,S_t\\,dt + (%.2f)\\,S_t\\,dW_t$', gMu, gSig), ...
          'Solution:   $S_t = S_0\,\exp[(\mu - \frac{1}{2}\sigma^2)t + \sigma W_t]$'};
        tR = {'Distribution of $S_T$', ...
              sprintf('$\\ln S_T \\sim \\mathcal{N}(%.2f,\\ %.2f^2)$', lnm, lns)};
        drawRow(axP(2), axH(2), t, Xgbm, mG, sG, colGBM, tL, tR, pdfG, ...
                nShow, nBins, '$S_t$', 0, NaN);

        tL = { ...
          'Mean-reverting (OU):   $dX_t = \theta(\mu - X_t)\,dt + \sigma\,dW_t$', ...
          sprintf('$dX_t = %.2f\\,(%.2f - X_t)\\,dt + %.2f\\,dW_t$', oTh, oMu, oSig), ...
          'Mean:   $E[X_t] = \mu + (X_0 - \mu)\,e^{-\theta t}$'};
        tR = {'Distribution of $X_T$', ...
              sprintf('$\\mathcal{N}(%.2f,\\ %.2f^2)$', mO(end), sO(end))};
        drawRow(axP(3), axH(3), t, Xou, mO, sO, colOU, tL, tR, pdfO, ...
                nShow, nBins, '$X_t$', -inf, oMu);

        drawnow limitrate;
    end
end

%% ========================= Local functions ==============================
function s = addSlider(parent, row, nRows, label, lo, hi, def, fmt, cb)
% One labelled slider with a live value read-out inside a uipanel.
    bgc  = get(parent, 'BackgroundColor');
    rowH = 0.85 / nRows;
    y    = 0.85 - row*rowH;

    uicontrol(parent,'Style','text','Units','normalized', ...
        'Position',[0.02 y+0.08*rowH 0.40 0.62*rowH], 'String',label, ...
        'HorizontalAlignment','left','BackgroundColor',bgc,'FontSize',9);
    sl = uicontrol(parent,'Style','slider','Units','normalized', ...
        'Position',[0.43 y+0.12*rowH 0.38 0.55*rowH], ...
        'Min',lo,'Max',hi,'Value',def,'Callback',@(~,~)cb());
    tx = uicontrol(parent,'Style','text','Units','normalized', ...
        'Position',[0.82 y+0.08*rowH 0.17 0.62*rowH], ...
        'String',sprintf(fmt,def),'HorizontalAlignment','right', ...
        'BackgroundColor',bgc,'FontSize',10,'FontWeight','bold');
    try   % live updates while dragging
        addlistener(sl, 'ContinuousValueChange', @(~,~)cb());
    catch
    end
    s = struct('sl',sl, 'tx',tx, 'fmt',fmt, 'def',def);
end

function drawRow(axP, axH, t, X, m, s, col, titL, titR, pdfFun, ...
                 nShow, nBins, yLab, yMin, refLevel)
% Left: paths + mean + band.   Right: histogram of X_T + theoretical pdf.
    faded = 1 - 0.55*(1 - col);            % light tint of the colour
    T = t(end);

    % ---------------- left axis
    legend(axP, 'off');
    cla(axP);  hold(axP, 'on');
    fill(axP, [t fliplr(t)], [m+s fliplr(m-s)], col, ...
         'FaceAlpha',0.15, 'EdgeColor','none', 'HandleVisibility','off');
    plot(axP, t, X(1:nShow,:)', 'Color',faded, 'LineWidth',0.6, ...
         'HandleVisibility','off');
    hp = plot(axP, t, X(1:3,:)', 'Color',col, 'LineWidth',1.4);
    set(hp(2:end), 'HandleVisibility','off');
    set(hp(1), 'DisplayName','sample paths');
    plot(axP, t, m,   'k',  'LineWidth',2.2, 'DisplayName','theoretical mean');
    plot(axP, t, m+s, 'k--','LineWidth',1.2, 'DisplayName','\pm 1 std. dev.');
    plot(axP, t, m-s, 'k--','LineWidth',1.2, 'HandleVisibility','off');
    if ~isnan(refLevel)
        plot(axP, [0 T], [refLevel refLevel], ':', 'Color',[0.3 0.3 0.3], ...
             'LineWidth',1.6, 'DisplayName','long-run mean \mu');
    end

    Xs = X(1:nShow,:);
    lo = min([Xs(:); m(:)-s(:); refLevel(~isnan(refLevel))]);
    hi = max([Xs(:); m(:)+s(:); refLevel(~isnan(refLevel))]);
    pad = 0.05*(hi - lo);
    yl = [max(lo - pad, yMin), hi + pad];
    set(axP, 'XLim',[0 T], 'YLim',yl);

    xlabel(axP, 'time $t$', 'Interpreter','latex', 'FontSize',11);
    ylabel(axP, yLab, 'Interpreter','latex', 'FontSize',13);
    title(axP, titL, 'Interpreter','latex', 'FontSize',11);
    legend(axP, 'Location','northwest', 'Box','off', 'FontSize',8);

    % ---------------- right axis
    cla(axH);  hold(axH, 'on');
    histogram(axH, X(:,end), nBins, 'Normalization','pdf', ...
              'Orientation','horizontal', 'FaceColor',col, 'FaceAlpha',0.55, ...
              'EdgeColor','none', 'DisplayName','simulated');
    yy = linspace(yl(1), yl(2), 400);
    plot(axH, pdfFun(yy), yy, 'k', 'LineWidth',2, 'DisplayName','theory');
    set(axH, 'YLim', yl);
    xlabel(axH, 'probability density', 'FontSize',10);
    title(axH, titR, 'Interpreter','latex', 'FontSize',11);
end
