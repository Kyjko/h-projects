%% STOCHASTIC PROCESSES DEMO
%  1) Brownian motion (Wiener process, with optional drift)
%  2) Geometric Brownian motion (GBM)
%  3) Mean-reverting process (Ornstein-Uhlenbeck)
%
%  For each process the figure shows:
%    LEFT : simulated sample paths (3 highlighted, the rest faded),
%           the theoretical mean (black) and +/- 1 std. deviation band
%    RIGHT: histogram of all simulated end-points X_T with the
%           theoretical probability density overlaid (black curve)
%
%  All three processes are driven by the SAME random numbers, so you can
%  see how the different equations transform identical noise.
%
%  Requires MATLAB R2016b or newer (local functions in scripts).
%  No toolboxes needed.

clear; clc; close all;

%% ======================= ADJUSTABLE PARAMETERS ==========================
% --- Simulation settings
T       = 1;        % time horizon
nSteps  = 500;      % number of time steps
nPaths  = 5000;     % number of simulated paths (used for the histograms)
nShow   = 25;       % number of paths drawn in the left-hand plots
seed    = 42;       % random seed (change for a different realisation)

% --- 1) Brownian motion:  dX = mu dt + sigma dW
%     (standard Brownian motion is mu = 0, sigma = 1, X0 = 0)
bm.mu    = 0;
bm.sigma = 1;
bm.x0    = 0;

% --- 2) Geometric Brownian motion:  dS = mu S dt + sigma S dW
gbm.mu    = 0.20;   % expected growth rate
gbm.sigma = 0.30;   % volatility
gbm.S0    = 100;    % starting value

% --- 3) Mean-reverting (Ornstein-Uhlenbeck):  dX = theta (mu - X) dt + sigma dW
ou.theta = 3.0;     % speed of reversion (larger = snaps back faster)
ou.mu    = 0.0;     % long-run mean the process is pulled towards
ou.sigma = 0.5;     % volatility
ou.x0    = 2.0;     % starting value (try x0 far from mu to see the pull)
%% ========================================================================

%% Simulation (common random numbers for all three processes)
rng(seed);
dt = T / nSteps;
t  = linspace(0, T, nSteps + 1);
Z  = randn(nPaths, nSteps);          % standard normal shocks
dW = sqrt(dt) * Z;                   % Brownian increments

% 1) Brownian motion (exact)
X_bm = [bm.x0 * ones(nPaths,1), ...
        bm.x0 + cumsum(bm.mu*dt + bm.sigma*dW, 2)];

% 2) GBM (exact solution of the SDE)
X_gbm = gbm.S0 * exp([zeros(nPaths,1), ...
        cumsum((gbm.mu - 0.5*gbm.sigma^2)*dt + gbm.sigma*dW, 2)]);

% 3) Ornstein-Uhlenbeck (exact discretisation)
a = exp(-ou.theta * dt);
b = ou.sigma * sqrt((1 - a^2) / (2*ou.theta));
X_ou = zeros(nPaths, nSteps + 1);
X_ou(:,1) = ou.x0;
for k = 1:nSteps
    X_ou(:,k+1) = ou.mu + (X_ou(:,k) - ou.mu) * a + b * Z(:,k);
end

%% Theoretical moments and end-point densities
normpdf_ = @(y,m,s) exp(-(y-m).^2 ./ (2*s^2)) ./ (s*sqrt(2*pi));

% Brownian motion: X_t ~ N(x0 + mu t, sigma^2 t)
m_bm = bm.x0 + bm.mu * t;
s_bm = bm.sigma * sqrt(t);
pdf_bm = @(y) normpdf_(y, m_bm(end), s_bm(end));

% GBM: S_t lognormal, E[S_t] = S0 e^{mu t}, Var = E^2 (e^{sigma^2 t} - 1)
m_gbm = gbm.S0 * exp(gbm.mu * t);
s_gbm = m_gbm .* sqrt(exp(gbm.sigma^2 * t) - 1);
lnm = log(gbm.S0) + (gbm.mu - 0.5*gbm.sigma^2) * T;   % mean of ln S_T
lns = gbm.sigma * sqrt(T);                              % std  of ln S_T
pdf_gbm = @(y) (y > 0) .* exp(-(log(max(y,eps)) - lnm).^2 ./ (2*lns^2)) ./ ...
               (max(y,eps) * lns * sqrt(2*pi));

% OU: X_t ~ N(mu + (x0-mu)e^{-theta t}, sigma^2/(2 theta) (1 - e^{-2 theta t}))
m_ou = ou.mu + (ou.x0 - ou.mu) * exp(-ou.theta * t);
s_ou = sqrt(ou.sigma^2 / (2*ou.theta) * (1 - exp(-2*ou.theta*t)));
pdf_ou = @(y) normpdf_(y, m_ou(end), s_ou(end));

%% Figure
fig = figure('Color','w','Position',[80 40 1150 930], ...
             'Name','Stochastic processes');

colBM  = [0.00 0.45 0.74];
colGBM = [0.47 0.67 0.19];
colOU  = [0.85 0.33 0.10];

rowY = [0.70 0.38 0.06];     % bottom of each row
rowH = 0.20;                 % height of each row

% ---------- Row 1: Brownian motion
titL = { ...
  'Brownian motion with drift:   $dX_t = \mu\,dt + \sigma\,dW_t$', ...
  'Solution:   $X_t = X_0 + \mu t + \sigma W_t$', ...
  sprintf('$\\mu = %.2f,\\quad \\sigma = %.2f,\\quad X_0 = %.2f$', bm.mu, bm.sigma, bm.x0)};
titR = {'Distribution of $X_T$', '$X_T \sim \mathcal{N}(X_0+\mu T,\ \sigma^2 T)$'};
plotRow(fig, rowY(1), rowH, t, X_bm, m_bm, s_bm, colBM, titL, titR, pdf_bm, ...
        nShow, '$X_t$');

% ---------- Row 2: Geometric Brownian motion
titL = { ...
  'Geometric Brownian motion:   $dS_t = \mu S_t\,dt + \sigma S_t\,dW_t$', ...
  'Solution:   $S_t = S_0\,\exp\!\left[(\mu - \tfrac{1}{2}\sigma^2)t + \sigma W_t\right]$', ...
  sprintf('$\\mu = %.2f,\\quad \\sigma = %.2f,\\quad S_0 = %.1f$', gbm.mu, gbm.sigma, gbm.S0)};
titR = {'Distribution of $S_T$', '$\ln S_T \sim \mathcal{N}(\ln S_0+(\mu-\frac{\sigma^2}{2})T,\ \sigma^2 T)$'};
plotRow(fig, rowY(2), rowH, t, X_gbm, m_gbm, s_gbm, colGBM, titL, titR, pdf_gbm, ...
        nShow, '$S_t$');

% ---------- Row 3: Mean-reverting (Ornstein-Uhlenbeck)
titL = { ...
  'Mean-reverting (Ornstein-Uhlenbeck):   $dX_t = \theta(\mu - X_t)\,dt + \sigma\,dW_t$', ...
  'Mean:   $E[X_t] = \mu + (X_0-\mu)\,e^{-\theta t}$', ...
  sprintf('$\\theta = %.2f,\\quad \\mu = %.2f,\\quad \\sigma = %.2f,\\quad X_0 = %.2f$', ...
          ou.theta, ou.mu, ou.sigma, ou.x0)};
titR = {'Distribution of $X_T$', ...
        '$X_T \sim \mathcal{N}(E[X_T],\ \frac{\sigma^2}{2\theta}(1-e^{-2\theta T}))$'};
axL = plotRow(fig, rowY(3), rowH, t, X_ou, m_ou, s_ou, colOU, titL, titR, pdf_ou, ...
              nShow, '$X_t$');

% Extra annotation for the OU panel: the long-run mean level
axes(axL); hold on;
yline(ou.mu, ':', 'Long-run mean $\mu$', 'Interpreter','latex', ...
      'Color',[0.3 0.3 0.3], 'LineWidth',1.5, ...
      'LabelHorizontalAlignment','right', 'LabelVerticalAlignment','bottom');
xlabel('time $t$', 'Interpreter','latex', 'FontSize',12);

%% ======================= Local functions ================================
function axP = plotRow(fig, y0, h, t, X, m, s, col, titL, titR, pdfFun, ...
                       nShow, yLab)
    % Left axis: paths + mean + band.  Right axis: histogram + pdf.
    faded = 1 - 0.55 * (1 - col);                    % light version of colour

    axP = axes('Parent',fig, 'Position',[0.07 y0 0.57 h]);
    hold(axP,'on'); box(axP,'on'); grid(axP,'on');

    % theoretical +/- 1 sd band
    fill([t fliplr(t)], [m+s fliplr(m-s)], col, ...
         'FaceAlpha',0.15, 'EdgeColor','none');

    % background paths
    plot(t, X(1:nShow,:)', 'Color', faded, 'LineWidth', 0.6, ...
         'HandleVisibility','off');
    % three highlighted paths
    hp = plot(t, X(1:3,:)', 'Color', col, 'LineWidth', 1.4);
    set(hp(2:end), 'HandleVisibility','off');
    set(hp(1), 'DisplayName', 'sample paths');

    % theoretical mean and +/- 1 sd
    plot(t, m, 'k', 'LineWidth', 2.2, 'DisplayName', 'theoretical mean');
    plot(t, m+s, 'k--', 'LineWidth', 1.2, 'DisplayName', '\pm 1 std. dev.');
    plot(t, m-s, 'k--', 'LineWidth', 1.2, 'HandleVisibility','off');

    xlim([t(1) t(end)]);
    Xs = X(1:nShow,:);
    yl = [min([Xs(:); m(:)-s(:)]), max([Xs(:); m(:)+s(:)])];
    pad = 0.05 * diff(yl);
    yl = [yl(1)-pad, yl(2)+pad];
    ylim(yl);

    xlabel('time $t$', 'Interpreter','latex', 'FontSize',12);
    ylabel(yLab, 'Interpreter','latex', 'FontSize',13);
    title(titL, 'Interpreter','latex', 'FontSize',12);
    legend('Location','northwest', 'Box','off');
    set(axP, 'FontSize',10);

    % ---- right: terminal distribution
    axH = axes('Parent',fig, 'Position',[0.70 y0 0.26 h]);
    hold(axH,'on'); box(axH,'on'); grid(axH,'on');
    histogram(X(:,end), 60, 'Normalization','pdf', 'Orientation','horizontal', ...
              'FaceColor',col, 'FaceAlpha',0.55, 'EdgeColor','none', ...
              'DisplayName','simulated');
    yy = linspace(yl(1), yl(2), 400);
    plot(pdfFun(yy), yy, 'k', 'LineWidth', 2, 'DisplayName','theoretical pdf');
    ylim(yl);
    xlabel('probability density', 'FontSize',11);
    title(titR, 'Interpreter','latex', 'FontSize',12);
    legend('Location','northeast', 'Box','off');
    set(axH, 'FontSize',10, 'YTickLabel',[]);
    linkaxes([axP axH], 'y');
end
