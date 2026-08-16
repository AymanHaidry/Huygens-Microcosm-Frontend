/* ─── Star1 Frontend v4.2 ───
   Supabase Auth + DB + GitHub Actions
   Conventional email/password auth
*/

const CONFIG = {
    pollInterval: 10000,
    maxPolls: 90,
    githubApi: 'https://api.github.com'
};

// ─── Hardcoded Supabase Credentials ───
const SUPABASE_DEFAULTS = {
    url: 'https://cknkncrnfdxqdcvwsdtz.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrbmtuY3JuZmR4cWRjdndzZHR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4ODUyMjcsImV4cCI6MjEwMjQ2MTIyN30.6kwPURKaYq5GfRuCoQjY6YjIDqwaGEJxvBqHL8jCVf4'
};

let supabase = null;
let currentUser = null;
let currentJob = null;
let pollTimer = null;
let pollCount = 0;
let authMode = 'login'; // 'login' | 'signup'

// ─── Supabase Init ───

function getSupabaseConfig() {
    return {
        url: localStorage.getItem('star1_sb_url') || SUPABASE_DEFAULTS.url,
        key: localStorage.getItem('star1_sb_key') || SUPABASE_DEFAULTS.key
    };
}

function saveSupabaseConfig(url, key) {
    localStorage.setItem('star1_sb_url', url);
    localStorage.setItem('star1_sb_key', key);
}

function initSupabase() {
    const { url, key } = getSupabaseConfig();
    if (!url || !key) return false;
    try {
        supabase = window.supabase.createClient(url, key);
        console.log('Supabase initialized');
        return true;
    } catch (e) {
        console.error('Supabase init failed:', e);
        return false;
    }
}

// ─── Auth ───

async function checkAuth() {
    if (!supabase) {
        showAuthGate();
        return;
    }

    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (session?.user) {
            currentUser = session.user;
            showApp();
            loadUserProfile();
            renderRecentResearch();
        } else {
            showAuthGate();
        }
    } catch (err) {
        console.error('Auth check error:', err);
        showAuthGate();
    }
}

function showAuthGate() {
    document.getElementById('auth-gate').classList.remove('hidden');
    document.getElementById('app').classList.add('app-hidden');
}

function showApp() {
    document.getElementById('auth-gate').classList.add('hidden');
    document.getElementById('app').classList.remove('app-hidden');
    document.getElementById('account-email').textContent = currentUser?.email || '—';

    const avatar = document.getElementById('user-avatar');
    if (currentUser?.email) {
        avatar.textContent = currentUser.email.charAt(0).toUpperCase();
    }
}

async function signIn(email, password) {
    if (!supabase) return { error: new Error('Supabase not configured') };
    return await supabase.auth.signInWithPassword({ email, password });
}

async function signUp(email, password) {
    if (!supabase) return { error: new Error('Supabase not configured') };
    return await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.href }
    });
}

async function signInWithGitHub() {
    if (!supabase) return { error: new Error('Supabase not configured') };
    return await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: window.location.href }
    });
}

async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    currentUser = null;
    showAuthGate();
}

// ─── User Profile ───

async function loadUserProfile() {
    if (!supabase || !currentUser) return;

    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('github_repo')
            .eq('id', currentUser.id)
            .single();

        if (data?.github_repo) {
            document.getElementById('github-repo').value = data.github_repo;
            localStorage.setItem('star1_repo', data.github_repo);
        }
    } catch (e) {
        console.error('Profile load error:', e);
    }
}

async function saveUserProfile(githubRepo) {
    if (!supabase || !currentUser) return;
    try {
        await supabase.from('profiles').upsert({
            id: currentUser.id,
            github_repo: githubRepo,
            updated_at: new Date().toISOString()
        });
    } catch (e) {
        console.error('Profile save error:', e);
    }
}

// ─── Research Jobs ───

async function createResearchJob(question, githubRunId) {
    if (!supabase || !currentUser) return null;

    try {
        const { data, error } = await supabase
            .from('research_jobs')
            .insert({
                user_id: currentUser.id,
                question,
                status: 'pending',
                github_run_id: githubRunId?.toString()
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (e) {
        console.error('DB insert error:', e);
        return null;
    }
}

async function updateResearchJob(jobId, updates) {
    if (!supabase) return;
    try {
        await supabase.from('research_jobs').update(updates).eq('id', jobId);
    } catch (e) {
        console.error('DB update error:', e);
    }
}

async function fetchResearchHistory() {
    if (!supabase || !currentUser) return [];

    try {
        const { data, error } = await supabase
            .from('research_jobs')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('DB fetch error:', e);
        return [];
    }
}

// ─── GitHub API ───

function getGitHubSettings() {
    return {
        pat: localStorage.getItem('star1_pat') || '',
        repo: localStorage.getItem('star1_repo') || ''
    };
}

function saveGitHubSettings(pat, repo) {
    localStorage.setItem('star1_pat', pat);
    localStorage.setItem('star1_repo', repo);
}

async function githubRequest(endpoint, options = {}) {
    const { pat } = getGitHubSettings();
    const url = `${CONFIG.githubApi}${endpoint}`;

    const res = await fetch(url, {
        ...options,
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${pat}`,
            'X-GitHub-Api-Version': '2022-11-28',
            ...options.headers
        }
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `GitHub API error: ${res.status}`);
    }

    return res.json();
}

async function triggerResearch(question) {
    const { repo } = getGitHubSettings();
    const [owner, repoName] = repo.split('/');

    await githubRequest(`/repos/${owner}/${repoName}/actions/workflows/star1.yml/dispatches`, {
        method: 'POST',
        body: JSON.stringify({ ref: 'main', inputs: { question } })
    });

    await new Promise(r => setTimeout(r, 4000));

    const runs = await githubRequest(`/repos/${owner}/${repoName}/actions/runs?event=workflow_dispatch&per_page=5`);
    const run = runs.workflow_runs.find(r =>
        r.name === 'Star1' && r.status !== 'completed'
    );

    if (!run) {
        return { id: `job-${Date.now()}`, runId: null };
    }

    return { id: run.id.toString(), runId: run.id };
}

async function checkJobStatus(runId) {
    const { repo } = getGitHubSettings();
    const [owner, repoName] = repo.split('/');

    const run = await githubRequest(`/repos/${owner}/${repoName}/actions/runs/${runId}`);

    if (run.status === 'completed') {
        if (run.conclusion === 'success') {
            try {
                const content = await githubRequest(`/repos/${owner}/${repoName}/contents/results/${runId}.json`);
                const decoded = JSON.parse(atob(content.content));
                return { status: 'success', result: decoded };
            } catch (e) {
                return { status: 'success', result: null };
            }
        } else {
            return { status: 'failed', error: `Research job failed: ${run.conclusion}` };
        }
    }

    return { status: 'running', runStatus: run.status };
}

// ─── UI Updates ───

function showState(stateId) {
    document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(stateId);
    if (el) el.classList.add('active');
}

function setStepState(stepName, state) {
    const step = document.querySelector(`[data-step="${stepName}"]`);
    if (!step) return;
    step.classList.remove('pending', 'active', 'done');
    step.classList.add(state);
}

function updateProgress(runStatus) {
    if (runStatus === 'queued' || runStatus === 'waiting') {
        setStepState('understand', 'active');
    } else if (runStatus === 'in_progress') {
        const elapsed = pollCount * CONFIG.pollInterval / 1000;
        setStepState('understand', 'done');
        if (elapsed < 20) setStepState('research', 'active');
        else if (elapsed < 60) { setStepState('research', 'done'); setStepState('crosscheck', 'active'); }
        else if (elapsed < 100) { setStepState('crosscheck', 'done'); setStepState('synthesize', 'active'); }
        else { setStepState('synthesize', 'done'); setStepState('write', 'active'); }
    }
}

function resetProgress() {
    ['understand', 'research', 'crosscheck', 'synthesize', 'write'].forEach(step => {
        setStepState(step, 'pending');
    });
}

async function renderRecentResearch() {
    const container = document.getElementById('recent-list');
    if (!container) return;

    const items = await fetchResearchHistory();

    if (items.length === 0) {
        container.innerHTML = '<p class="recent-empty">No research yet. Ask something above.</p>';
        return;
    }

    container.innerHTML = items.map(item => {
        const date = new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `
            <button type="button" class="recent-item" data-job-id="${item.id}" data-run-id="${item.github_run_id || ''}">
                <span class="recent-item-status ${item.status}"></span>
                <div class="recent-item-text">
                    <div class="recent-item-question">${escapeHtml(item.question)}</div>
                    <div class="recent-item-meta">${item.status} · ${date}</div>
                </div>
                <svg class="recent-item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"/>
                </svg>
            </button>
        `;
    }).join('');

    container.querySelectorAll('.recent-item').forEach(btn => {
        btn.addEventListener('click', () => loadPastResearch(btn.dataset.jobId, btn.dataset.runId));
    });
}

async function loadPastResearch(jobId, runId) {
    if (supabase && jobId) {
        try {
            const { data } = await supabase.from('research_jobs').select('*').eq('id', jobId).single();
            if (data?.result_json) {
                renderReport({ report: data.result_json });
                showState('report');
                return;
            }
        } catch (e) {
            console.error('Load from DB failed:', e);
        }
    }

    if (runId) {
        const { repo } = getGitHubSettings();
        const [owner, repoName] = repo.split('/');
        try {
            const content = await githubRequest(`/repos/${owner}/${repoName}/contents/results/${runId}.json`);
            const decoded = JSON.parse(atob(content.content));
            if (decoded.report) {
                renderReport(decoded);
                showState('report');
                if (supabase && jobId) {
                    await updateResearchJob(jobId, { result_json: decoded.report, status: 'complete' });
                }
            }
        } catch (e) {
            alert('Could not load this research result.');
        }
    }
}

// ─── Report Rendering ───

function renderReport(data) {
    const container = document.getElementById('report-content');
    if (!container) return;

    if (!data || !data.report) {
        container.innerHTML = `
            <div class="error-banner">
                <h3>Star1 couldn't complete the research.</h3>
                <p>The result file was empty or malformed.</p>
                <button type="button" class="retry-btn" onclick="location.reload()">Try again</button>
                <button type="button" class="change-btn" onclick="showState('landing')">Change the question</button>
            </div>
        `;
        return;
    }

    const r = data.report;
    const date = r.generated_at
        ? new Date(r.generated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    let html = `
        <h1 class="report-title">${escapeHtml(r.title || 'Research Report')}</h1>
        <div class="report-meta">
            <span>Star1</span>
            <span>·</span>
            <span>${date}</span>
            <span>·</span>
            <span>${r.sources ? r.sources.length : 0} sources</span>
        </div>
    `;

    if (r.executive_summary) {
        html += `
            <div class="executive-summary">
                <h2>Executive summary</h2>
                <p>${escapeHtml(r.executive_summary)}</p>
            </div>
        `;
    }

    if (r.key_findings && r.key_findings.length > 0) {
        html += `<h2 class="section-heading">Key findings</h2><ol class="findings-list">`;
        r.key_findings.forEach((finding, i) => {
            html += `
                <li class="finding-item">
                    <h3><span class="finding-number">${String(i + 1).padStart(2, '0')}</span> ${escapeHtml(finding.title)}</h3>
                    <p>${escapeHtml(finding.content)}</p>
                </li>
            `;
        });
        html += `</ol>`;
    }

    if (r.comparison && r.comparison.headers && r.comparison.rows) {
        html += `<h2 class="section-heading">Comparison</h2>`;
        html += `<table class="comparison-table"><thead><tr>`;
        r.comparison.headers.forEach(h => html += `<th>${escapeHtml(h)}</th>`);
        html += `</tr></thead><tbody>`;
        r.comparison.rows.forEach(row => {
            html += `<tr>`;
            row.forEach(cell => html += `<td>${escapeHtml(cell)}</td>`);
            html += `</tr>`;
        });
        html += `</tbody></table>`;
    }

    if (r.evidence_assessment) {
        html += `
            <div class="evidence-section">
                <h3>What the evidence suggests</h3>
                <p>${escapeHtml(r.evidence_assessment)}</p>
            </div>
        `;
    }

    if (r.confidence_notes) {
        html += `
            <div class="confidence-note">
                <svg class="confidence-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="16" x2="12" y2="12"/>
                    <line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
                <p>${escapeHtml(r.confidence_notes)}</p>
            </div>
        `;
    }

    if (r.sources && r.sources.length > 0) {
        const primaryCount = r.sources.filter(s => s.type === 'primary').length;
        const secondaryCount = r.sources.filter(s => s.type === 'secondary').length;

        html += `
            <div class="sources-section">
                <button type="button" class="sources-toggle" onclick="this.nextElementSibling.classList.toggle('open')">
                    Sources
                    <span class="sources-count">${r.sources.length} · ${primaryCount} primary · ${secondaryCount} secondary</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </button>
                <ol class="sources-list">
        `;

        r.sources.forEach((source, i) => {
            html += `
                <li class="source-item">
                    <span class="source-number">${i + 1}</span>
                    <div class="source-content">
                        <div class="source-title">${escapeHtml(source.title)}</div>
                        <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener" class="source-url">${escapeHtml(source.url)}</a>
                        <span class="source-type ${source.type || 'secondary'}">${source.type || 'secondary'}</span>
                    </div>
                </li>
            `;
        });

        html += `</ol></div>`;
    }

    container.innerHTML = html;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ─── Polling ───

async function pollJob() {
    if (!currentJob || !currentJob.runId) return;

    pollCount++;

    if (pollCount > CONFIG.maxPolls) {
        clearInterval(pollTimer);
        pollTimer = null;
        showError('Research is taking longer than expected. You can check the GitHub Actions tab for status.');
        if (currentJob.dbId) {
            await updateResearchJob(currentJob.dbId, { status: 'failed' });
        }
        renderRecentResearch();
        return;
    }

    try {
        const status = await checkJobStatus(currentJob.runId);

        if (status.status === 'running') {
            updateProgress(status.runStatus);
            if (currentJob.dbId) {
                await updateResearchJob(currentJob.dbId, { status: 'running' });
            }
        } else if (status.status === 'success') {
            clearInterval(pollTimer);
            pollTimer = null;
            setStepState('write', 'done');

            if (status.result) {
                renderReport(status.result);
                showState('report');
                if (currentJob.dbId) {
                    await updateResearchJob(currentJob.dbId, {
                        status: 'complete',
                        result_json: status.result.report
                    });
                }
                renderRecentResearch();
            } else {
                showError('Research completed but no result was found.');
            }
        } else if (status.status === 'failed') {
            clearInterval(pollTimer);
            pollTimer = null;
            showError(status.error || "Star1 couldn't complete the research.");
            if (currentJob.dbId) {
                await updateResearchJob(currentJob.dbId, { status: 'failed' });
            }
            renderRecentResearch();
        }
    } catch (err) {
        console.error('Poll error:', err);
    }
}

function showError(message) {
    const container = document.getElementById('report-content');
    if (!container) return;
    container.innerHTML = `
        <div class="error-banner">
            <h3>Star1 couldn't complete the research.</h3>
            <p>${escapeHtml(message)}</p>
            <button type="button" class="retry-btn" onclick="location.reload()">Try again</button>
            <button type="button" class="change-btn" onclick="showState('landing')">Change the question</button>
        </div>
    `;
    showState('report');
}

// ─── Event Handlers ───

async function startResearch(question) {
    const gh = getGitHubSettings();
    const sb = getSupabaseConfig();

    if (!sb.url || !sb.key) {
        openSettings('supabase');
        return;
    }

    if (!gh.pat || !gh.repo) {
        openSettings('github');
        return;
    }

    const activeQ = document.getElementById('active-question');
    const jobIdDisplay = document.getElementById('job-id-display');
    if (activeQ) activeQ.textContent = question;
    if (jobIdDisplay) jobIdDisplay.textContent = 'Triggering...';

    resetProgress();
    showState('researching');

    try {
        const job = await triggerResearch(question);
        currentJob = job;
        if (jobIdDisplay) jobIdDisplay.textContent = `Job #${job.id}`;

        if (supabase && currentUser) {
            const dbJob = await createResearchJob(question, job.runId);
            if (dbJob) currentJob.dbId = dbJob.id;
        }

        renderRecentResearch();

        if (job.runId) {
            pollCount = 0;
            pollTimer = setInterval(pollJob, CONFIG.pollInterval);
            pollJob();
        } else {
            setTimeout(async () => {
                try {
                    const { repo } = getGitHubSettings();
                    const [owner, repoName] = repo.split('/');
                    const runs = await githubRequest(`/repos/${owner}/${repoName}/actions/runs?event=workflow_dispatch&per_page=5`);
                    const run = runs.workflow_runs.find(r => r.name === 'Star1' && r.status !== 'completed');
                    if (run) {
                        currentJob = { id: run.id.toString(), runId: run.id, dbId: currentJob?.dbId };
                        if (jobIdDisplay) jobIdDisplay.textContent = `Job #${run.id}`;
                        pollCount = 0;
                        pollTimer = setInterval(pollJob, CONFIG.pollInterval);
                        pollJob();
                    }
                } catch (e) {
                    console.error('Fallback run find failed:', e);
                }
            }, 6000);
        }
    } catch (err) {
        console.error('Start research error:', err);
        showError(err.message || 'Failed to start research. Check your settings.');
    }
}

// ─── Settings ───

function openSettings(tab = 'github') {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('open');
    switchSettingsTab(tab);
}

function switchSettingsTab(tabName) {
    document.querySelectorAll('.settings-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.settings-panel').forEach(p => {
        p.classList.toggle('active', p.dataset.panel === tabName);
    });
}

async function testConnection() {
    const resultEl = document.getElementById('test-result');
    const pat = document.getElementById('github-pat').value.trim();
    const repo = document.getElementById('github-repo').value.trim();

    if (!pat || !repo) {
        resultEl.textContent = 'Please fill in both fields.';
        resultEl.className = 'test-result error';
        return;
    }

    resultEl.textContent = 'Testing...';
    resultEl.className = 'test-result';

    try {
        const [owner, repoName] = repo.split('/');
        await fetch(`${CONFIG.githubApi}/repos/${owner}/${repoName}`, {
            headers: { 'Authorization': `Bearer ${pat}`, 'Accept': 'application/vnd.github+json' }
        });
        resultEl.textContent = 'GitHub connection successful.';
        resultEl.className = 'test-result success';
    } catch (e) {
        resultEl.textContent = `Connection failed: ${e.message}`;
        resultEl.className = 'test-result error';
    }
}

async function testSupabase() {
    const resultEl = document.getElementById('sb-test-result');
    const url = document.getElementById('sb-url').value.trim();
    const key = document.getElementById('sb-key').value.trim();

    if (!url || !key) {
        resultEl.textContent = 'Please fill in both fields.';
        resultEl.className = 'test-result error';
        return;
    }

    resultEl.textContent = 'Testing...';
    resultEl.className = 'test-result';

    try {
        const testClient = window.supabase.createClient(url, key);
        const { error } = await testClient.from('research_jobs').select('count', { count: 'exact', head: true });
        if (error && error.code !== 'PGRST116') throw error;
        resultEl.textContent = 'Supabase connected successfully.';
        resultEl.className = 'test-result success';
    } catch (e) {
        resultEl.textContent = `Connection failed: ${e.message}`;
        resultEl.className = 'test-result error';
    }
}

// ─── Init ───

document.addEventListener('DOMContentLoaded', () => {
    console.log('Star1 initializing...');

    // Init Supabase
    const sbConfig = getSupabaseConfig();
    if (sbConfig.url && sbConfig.key) {
        initSupabase();
        checkAuth();
    } else {
        showAuthGate();
    }

    // Pre-fill settings
    const gh = getGitHubSettings();
    const patInput = document.getElementById('github-pat');
    const repoInput = document.getElementById('github-repo');
    const sbUrlInput = document.getElementById('sb-url');
    const sbKeyInput = document.getElementById('sb-key');

    if (patInput && gh.pat) patInput.value = gh.pat;
    if (repoInput && gh.repo) repoInput.value = gh.repo;
    if (sbUrlInput) sbUrlInput.value = sbConfig.url;
    if (sbKeyInput) sbKeyInput.value = sbConfig.key;

    // ─── Auth UI ───
    const authSubmitBtn = document.getElementById('auth-submit');
    const authToggleBtn = document.getElementById('auth-toggle-btn');
    const authToggleText = document.getElementById('auth-toggle-text');
    const authSubtitle = document.getElementById('auth-subtitle');
    const authEmail = document.getElementById('auth-email');
    const authPassword = document.getElementById('auth-password');
    const authMessage = document.getElementById('auth-message');

    function updateAuthUI() {
        if (!authSubmitBtn || !authSubtitle) return;
        if (authMode === 'login') {
            authSubmitBtn.textContent = 'Sign in';
            authSubtitle.textContent = 'Sign in to your account';
            if (authToggleText) authToggleText.textContent = "Don't have an account?";
            if (authToggleBtn) authToggleBtn.textContent = 'Sign up';
        } else {
            authSubmitBtn.textContent = 'Create account';
            authSubtitle.textContent = 'Create a new account';
            if (authToggleText) authToggleText.textContent = 'Already have an account?';
            if (authToggleBtn) authToggleBtn.textContent = 'Sign in';
        }
    }

    if (authToggleBtn) {
        authToggleBtn.addEventListener('click', () => {
            authMode = authMode === 'login' ? 'signup' : 'login';
            updateAuthUI();
            if (authMessage) {
                authMessage.textContent = '';
                authMessage.className = 'auth-message';
            }
        });
    }

    async function handleAuthSubmit() {
        if (!authEmail || !authPassword || !authMessage) return;

        const email = authEmail.value.trim();
        const password = authPassword.value;

        if (!email || !password) {
            authMessage.textContent = 'Please enter email and password.';
            authMessage.className = 'auth-message error';
            return;
        }

        authMessage.textContent = authMode === 'login' ? 'Signing in...' : 'Creating account...';
        authMessage.className = 'auth-message';

        if (authMode === 'login') {
            const { data, error } = await signIn(email, password);
            if (error) {
                authMessage.textContent = error.message;
                authMessage.className = 'auth-message error';
            } else if (data?.user) {
                currentUser = data.user;
                showApp();
                loadUserProfile();
                renderRecentResearch();
            }
        } else {
            const { data, error } = await signUp(email, password);
            if (error) {
                authMessage.textContent = error.message;
                authMessage.className = 'auth-message error';
            } else if (data?.session) {
                // Auto-signed in
                currentUser = data.user;
                showApp();
                loadUserProfile();
                renderRecentResearch();
            } else {
                authMessage.textContent = 'Account created! Check your email to confirm, then sign in.';
                authMessage.className = 'auth-message success';
                authMode = 'login';
                updateAuthUI();
            }
        }
    }

    if (authSubmitBtn) {
        authSubmitBtn.addEventListener('click', handleAuthSubmit);
    }

    if (authPassword) {
        authPassword.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleAuthSubmit();
        });
    }

    // Auth: GitHub
    const authGithubBtn = document.getElementById('auth-github');
    if (authGithubBtn) {
        authGithubBtn.addEventListener('click', async () => {
            const { error } = await signInWithGitHub();
            if (error && authMessage) {
                authMessage.textContent = error.message;
                authMessage.className = 'auth-message error';
            }
        });
    }

    // Research submit
    const input = document.getElementById('research-question');
    const submitBtn = document.getElementById('submit-research');

    function handleSubmit() {
        if (!input) return;
        const question = input.value.trim();
        if (!question) return;
        startResearch(question);
    }

    if (submitBtn) submitBtn.addEventListener('click', handleSubmit);
    if (input) input.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSubmit(); });

    // Example chips
    document.querySelectorAll('.example-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            if (input) input.value = chip.dataset.question;
            handleSubmit();
        });
    });

    // Cancel
    const cancelBtn = document.getElementById('cancel-research');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            currentJob = null;
            showState('landing');
        });
    }

    // New research
    const newResearchBtn = document.getElementById('new-research');
    if (newResearchBtn) {
        newResearchBtn.addEventListener('click', () => {
            if (input) input.value = '';
            showState('landing');
        });
    }

    // Open settings
    const openSettingsBtn = document.getElementById('open-settings');
    if (openSettingsBtn) {
        openSettingsBtn.addEventListener('click', () => openSettings('github'));
    }

    // Settings tabs
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => switchSettingsTab(tab.dataset.tab));
    });

    // Save all settings
    const saveSettingsBtn = document.getElementById('save-settings');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', async () => {
            const pat = patInput ? patInput.value.trim() : '';
            const repo = repoInput ? repoInput.value.trim() : '';
            const sbUrl = sbUrlInput ? sbUrlInput.value.trim() : '';
            const sbKey = sbKeyInput ? sbKeyInput.value.trim() : '';

            saveGitHubSettings(pat, repo);
            if (sbUrl && sbKey) saveSupabaseConfig(sbUrl, sbKey);

            if (repo && currentUser) {
                await saveUserProfile(repo);
            }

            if (sbUrl && sbKey) {
                initSupabase();
                checkAuth();
            }

            const modal = document.getElementById('settings-modal');
            if (modal) modal.classList.remove('open');
        });
    }

    // Test connection
    const testConnBtn = document.getElementById('test-connection');
    if (testConnBtn) testConnBtn.addEventListener('click', testConnection);

    // Save Supabase
    const saveSbBtn = document.getElementById('save-supabase');
    if (saveSbBtn) saveSbBtn.addEventListener('click', async () => {
        const url = sbUrlInput ? sbUrlInput.value.trim() : '';
        const key = sbKeyInput ? sbKeyInput.value.trim() : '';
        if (url && key) {
            saveSupabaseConfig(url, key);
            initSupabase();
            await testSupabase();
            checkAuth();
        }
    });

    // Sign out
    const signOutBtn = document.getElementById('sign-out');
    if (signOutBtn) signOutBtn.addEventListener('click', signOut);

    // Close modal on backdrop
    const backdrop = document.querySelector('.modal-backdrop');
    if (backdrop) {
        backdrop.addEventListener('click', () => {
            const modal = document.getElementById('settings-modal');
            if (modal) modal.classList.remove('open');
        });
    }

    console.log('Star1 ready.');
});
