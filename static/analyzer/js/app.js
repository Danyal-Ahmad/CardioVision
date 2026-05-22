/* ================================================================
   CardioVision v8 — Clean Application Engine
   Bug fixes: AudioContext resume, better audio constraints,
   upload reset, solid PDF, mobile nav, mic on click only
   ================================================================ */
(function () {
    'use strict';
    const CV = window.CV = {};

    // ---- State ----
    let mediaRecorder = null, audioCtx = null, analyser = null, stream = null;
    let recordedBlob = null, uploadedFile = null;
    let recordInterval = null, isRecording = false, recordStart = 0;
    let liveRAF = 0, freqBarInterval = 0;
    let autoStopTimeout = null;
    const MAX_SEC = 5;
    const $ = id => document.getElementById(id);

    // ==================== INIT ====================
    document.addEventListener('DOMContentLoaded', () => {
        if (window.lucide) lucide.createIcons();
        initFreqBars();
        initDropzone();
        loadHistory();
        $('pageHome').style.display = 'block';
        $('pageHome').style.opacity = '1';
    });

    // ==================== FREQUENCY BARS ====================
    function initFreqBars() {
        const container = $('freqBars');
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < 64; i++) {
            const bar = document.createElement('div');
            bar.className = 'freq-bar';
            bar.style.height = (Math.random() * 8 + 3) + '%';
            container.appendChild(bar);
        }
    }

    function updateFreqBars() {
        if (!isRecording || !analyser) return;
        const bars = document.querySelectorAll('.freq-bar');
        if (!bars.length) return;
        const bufLen = analyser.frequencyBinCount;
        const data = new Uint8Array(bufLen);
        analyser.getByteFrequencyData(data);
        const step = Math.floor(bufLen / bars.length);
        for (let i = 0; i < bars.length; i++) {
            let sum = 0;
            for (let j = 0; j < step; j++) {
                sum += data[i * step + j] || 0;
            }
            const avg = sum / step;
            bars[i].style.height = Math.max(3, (avg / 255) * 90 + 3) + '%';
        }
    }

    // ==================== PAGE NAVIGATION ====================
    let currentPage = 'pageHome';

    function switchPage(pageId) {
        if (pageId === currentPage) return;
        const oldPage = $(currentPage);
        const newPage = $(pageId);
        if (!oldPage || !newPage) return;

        oldPage.style.opacity = '0';
        setTimeout(() => {
            oldPage.style.display = 'none';
            oldPage.classList.remove('active');
            newPage.style.display = 'block';
            newPage.classList.add('active');
            setTimeout(() => { newPage.style.opacity = '1'; }, 20);
        }, 200);

        currentPage = pageId;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function setActiveTab(page) {
        document.querySelectorAll('.nav-link').forEach(t => {
            t.classList.toggle('active', t.dataset.page === page);
        });
        // Sync mobile nav
        document.querySelectorAll('.mob-nav-btn').forEach(t => {
            t.classList.toggle('active', t.dataset.page === page);
        });
    }

    CV.goHome = function () {
        switchPage('pageHome');
        setActiveTab('home');
        CV.clearUpload();
    };

    CV.goToCapture = function () {
        switchPage('pageRecord');
        setActiveTab('record');
        CV.clearUpload();
    };

    CV.goToUpload = function () {
        switchPage('pageUpload');
        setActiveTab('upload');
        CV.clearUpload();
    };

    // ==================== RECORDING (Fixed) ====================
    CV.startRecording = async function () {
        try {
            // Close previous AudioContext if exists
            if (audioCtx && audioCtx.state !== 'closed') {
                try { audioCtx.close(); } catch (e) { /* ignore */ }
                audioCtx = null;
            }
            // Stop any previous stream
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
                stream = null;
            }

            // Build audio constraints — optimized for heart sound capture
            const constraints = { audio: true };
            const deviceId = $('micSelect').value;
            if (deviceId) {
                constraints.audio = {
                    deviceId: { exact: deviceId },
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: true,
                    sampleRate: 22050
                };
            } else {
                constraints.audio = {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: true
                };
            }

            stream = await navigator.mediaDevices.getUserMedia(constraints);
            refreshMicList(stream);

            // Create and resume AudioContext (required by browsers after user gesture)
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }

            const src = audioCtx.createMediaStreamSource(stream);
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.8;
            src.connect(analyser);

            // Find supported mime type
            let mime = '';
            ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].forEach(m => {
                if (!mime && MediaRecorder.isTypeSupported(m)) mime = m;
            });

            mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
            const chunks = [];
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
            mediaRecorder.onstop = () => {
                recordedBlob = new Blob(chunks, { type: mime || 'audio/webm' });
                onRecordComplete();
            };

            mediaRecorder.start(100);
            isRecording = true;
            recordStart = Date.now();

            $('btnStartRec').disabled = true;
            $('btnStopRec').disabled = false;
            $('freqVisualizer').classList.add('recording');
            $('liveWaveTag').innerHTML = '<span class="status-dot red"></span> RECORDING';

            // Hide mic notice after first successful recording
            const notice = $('micNotice');
            if (notice) notice.style.display = 'none';

            tickTimer();
            recordInterval = setInterval(tickTimer, 100);
            drawLiveWave();
            freqBarInterval = setInterval(updateFreqBars, 80);

            // Auto-stop after MAX_SEC
            if (autoStopTimeout) clearTimeout(autoStopTimeout);
            autoStopTimeout = setTimeout(() => { if (isRecording) CV.stopRecording(); }, MAX_SEC * 1000);

        } catch (e) {
            console.error('Mic error:', e);
            if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
                CV.showToast('error', 'Microphone Access Denied',
                    'Please allow microphone access in your browser. Click the lock/info icon in the address bar, set Microphone to "Allow", and refresh the page.');
            } else if (e.name === 'NotFoundError') {
                CV.showToast('error', 'No Microphone Found',
                    'No microphone device was detected. Please connect a microphone and try again.');
            } else if (e.name === 'NotReadableError') {
                CV.showToast('error', 'Microphone In Use',
                    'Your microphone may be in use by another application. Close other apps using the mic and try again.');
            } else {
                CV.showToast('error', 'Microphone Error',
                    'Could not access microphone (' + (e.message || 'Unknown error') + '). Ensure a mic is connected and try again.');
            }
        }
    };

    CV.stopRecording = function () {
        if (!isRecording) return;
        isRecording = false;

        if (autoStopTimeout) { clearTimeout(autoStopTimeout); autoStopTimeout = null; }

        // Stop MediaRecorder — triggers onstop which calls onRecordComplete
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        // Stop stream tracks
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }
        // Clean up intervals
        clearInterval(recordInterval);
        clearInterval(freqBarInterval);
        cancelAnimationFrame(liveRAF);
        freqBarInterval = 0;
        liveRAF = 0;

        $('btnStartRec').disabled = false;
        $('btnStopRec').disabled = true;
        $('freqVisualizer').classList.remove('recording');
        $('liveWaveTag').innerHTML = '<span class="status-dot"></span> READY';
        clearLiveCanvas();

        document.querySelectorAll('.freq-bar').forEach(b => {
            b.style.height = (Math.random() * 8 + 3) + '%';
        });
    };

    function onRecordComplete() {
        if (recordedBlob) sendAudio(recordedBlob, 'recording_' + Date.now() + '.webm');
    }

    function refreshMicList(s) {
        try {
            navigator.mediaDevices.enumerateDevices().then(devs => {
                const sel = $('micSelect');
                const track = s.getAudioTracks()[0];
                const aid = track ? track.getSettings().deviceId : '';
                sel.innerHTML = '<option value="">Default</option>';
                devs.forEach(d => {
                    if (d.kind === 'audioinput') {
                        const o = document.createElement('option');
                        o.value = d.deviceId;
                        o.textContent = d.label || 'Mic ' + sel.options.length;
                        if (d.deviceId === aid) o.selected = true;
                        sel.appendChild(o);
                    }
                });
            });
        } catch (e) { /* ignore */ }
    }

    function tickTimer() {
        const elapsed = Math.min((Date.now() - recordStart) / 1000, MAX_SEC);
        const m = Math.floor(elapsed / 60);
        const sec = Math.floor(elapsed % 60);
        const t = $('recTimer');
        t.textContent = String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
        t.classList.remove('warn', 'crit');
        if (elapsed >= 4.5) t.classList.add('crit');
        else if (elapsed >= 4) t.classList.add('warn');
    }

    // ---- Live Waveform ----
    function drawLiveWave() {
        if (!isRecording || !analyser) return;
        const canvas = $('liveWaveCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const w = canvas.width, h = canvas.height;
        const bufLen = analyser.frequencyBinCount;
        const data = new Uint8Array(bufLen);

        function draw() {
            if (!isRecording) return;
            liveRAF = requestAnimationFrame(draw);
            analyser.getByteTimeDomainData(data);

            ctx.fillStyle = 'rgba(15, 23, 42, 0.2)';
            ctx.fillRect(0, 0, w, h);

            ctx.strokeStyle = '#e63946';
            ctx.lineWidth = 2 * dpr;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const step = w / bufLen;
            let x = 0;
            for (let i = 0; i < bufLen; i++) {
                const y = (data[i] / 128.0) * h / 2;
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                x += step;
            }
            ctx.stroke();
        }
        draw();
    }

    function clearLiveCanvas() {
        const canvas = $('liveWaveCanvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    // ==================== UPLOAD ====================
    function initDropzone() {
        const dz = $('dropzone');
        const fi = $('fileInput');
        if (!dz || !fi) return;
        dz.addEventListener('click', () => fi.click());
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', e => {
            e.preventDefault();
            dz.classList.remove('dragover');
            if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
        });
        fi.addEventListener('change', () => { if (fi.files.length) handleFile(fi.files[0]); });
    }

    function handleFile(file) {
        if (!file.type.startsWith('audio/')) {
            CV.showToast('error', 'Invalid File',
                'Please upload a proper heartbeat sound audio file (.wav, .mp3, .webm).');
            return;
        }
        if (file.size > 15 * 1024 * 1024) {
            CV.showToast('error', 'File Too Large', 'Maximum file size is 15 MB.');
            return;
        }
        uploadedFile = file;
        $('uploadFilename').textContent = file.name;
        $('dropzone').classList.add('hidden');
        $('filePreview').classList.remove('hidden');

        const reader = new FileReader();
        reader.onload = async e => {
            let ac = null;
            try {
                ac = new (window.AudioContext || window.webkitAudioContext)();
                const ab = await ac.decodeAudioData(e.target.result);
                drawWaveform($('uploadWaveCanvas'), ab);
            } catch (err) { /* ignore decode errors */ }
            if (ac) { try { ac.close(); } catch (ex) { /* ignore */ } }
        };
        reader.readAsArrayBuffer(file);
    }

    CV.clearUpload = function () {
        uploadedFile = null;
        const fi = $('fileInput');
        if (fi) fi.value = '';
        if ($('dropzone')) $('dropzone').classList.remove('hidden');
        if ($('filePreview')) $('filePreview').classList.add('hidden');
    };

    CV.analyzeUpload = function () {
        if (!uploadedFile) return;
        sendAudio(uploadedFile, uploadedFile.name);
    };

    function drawWaveform(canvas, audioBuf) {
        if (!canvas || !audioBuf) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const w = canvas.width, h = canvas.height;
        const d = audioBuf.getChannelData(0);
        const step = Math.max(1, Math.ceil(d.length / w));
        ctx.clearRect(0, 0, w, h);

        const mid = h / 2;
        ctx.globalAlpha = 0.45;
        for (let i = 0; i < w; i++) {
            let lo = 1, hi = -1;
            for (let j = 0; j < step; j++) {
                const idx = i * step + j;
                if (idx < d.length) { if (d[idx] < lo) lo = d[idx]; if (d[idx] > hi) hi = d[idx]; }
            }
            const bh = Math.max((hi - lo) * mid, 1);
            ctx.fillStyle = '#e63946';
            ctx.fillRect(i, mid - hi * mid, Math.max(1, 1), bh);
        }
        ctx.globalAlpha = 1;
    }

    // ==================== SEND FOR ANALYSIS ====================
    async function sendAudio(blob, filename) {
        showLoading(true);
        const fd = new FormData();
        fd.append('audio', blob, filename);
        try {
            const resp = await fetch('/upload_analyze/', { method: 'POST', body: fd });
            const data = await resp.json();
            if (data.error) {
                showLoading(false);
                CV.showToast('error', 'Analysis Failed', data.error);
                CV.clearUpload();
            } else if (data.success) {
                showLoading(false);
                displayReport(data);
                loadHistory();
            }
        } catch (e) {
            showLoading(false);
            CV.showToast('error', 'Connection Error',
                'Upload failed. Check your connection and try again.');
        }
    }

    // ==================== LOADING ====================
    let ecgAnimId = 0;

    function showLoading(v) {
        const overlay = $('loadingOverlay');
        if (v) {
            overlay.style.display = 'flex';
            overlay.classList.add('show');
            startEcgAnimation();
        } else {
            stopEcgAnimation();
            overlay.classList.remove('show');
            overlay.style.display = 'none';
        }
    }

    function startEcgAnimation() {
        const canvas = $('loadingEcgCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = 280 * dpr;
        canvas.height = 80 * dpr;
        const w = canvas.width, h = canvas.height;
        let offset = 0;

        function draw() {
            ecgAnimId = requestAnimationFrame(draw);
            ctx.fillStyle = 'rgba(245, 246, 250, 0.15)';
            ctx.fillRect(0, 0, w, h);

            ctx.strokeStyle = '#e63946';
            ctx.lineWidth = 2.5 * dpr;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();

            const seg = w / 4;
            const cy = h / 2;
            for (let s = -1; s < 6; s++) {
                const sx = (offset + s * seg) % (5 * seg);
                ctx.moveTo(sx, cy);
                ctx.lineTo(sx + seg * 0.12, cy);
                ctx.lineTo(sx + seg * 0.2, cy - h * 0.32);
                ctx.lineTo(sx + seg * 0.28, cy + h * 0.32);
                ctx.lineTo(sx + seg * 0.36, cy - h * 0.15);
                ctx.lineTo(sx + seg * 0.44, cy);
                ctx.lineTo(sx + seg * 0.56, cy);
                ctx.lineTo(sx + seg * 0.64, cy - h * 0.25);
                ctx.lineTo(sx + seg * 0.72, cy + h * 0.25);
                ctx.lineTo(sx + seg * 0.8, cy);
                ctx.lineTo(sx + seg, cy);
            }
            ctx.stroke();
            offset += 1.2;
        }
        draw();
    }

    function stopEcgAnimation() {
        cancelAnimationFrame(ecgAnimId);
        ecgAnimId = 0;
    }

    // ==================== TOAST NOTIFICATIONS ====================
    CV.showToast = function (type, title, msg, duration) {
        duration = duration || 6000;
        const container = $('toastContainer');
        if (!container) return;

        const iconMap = {
            error:   '<i data-lucide="alert-circle" style="width:16px;height:16px"></i>',
            success: '<i data-lucide="check-circle" style="width:16px;height:16px"></i>',
            info:    '<i data-lucide="info" style="width:16px;height:16px"></i>',
        };

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML =
            '<div class="toast-icon ' + type + '">' + (iconMap[type] || iconMap.info) + '</div>' +
            '<div class="toast-body">' +
                '<div class="toast-title">' + (title || 'Notice') + '</div>' +
                '<div class="toast-msg">' + (msg || '') + '</div>' +
            '</div>' +
            '<button class="toast-close">&times;</button>' +
            '<div class="toast-bar" style="animation-duration:' + duration + 'ms"></div>';

        container.appendChild(toast);
        if (window.lucide) lucide.createIcons();

        toast.querySelector('.toast-close').addEventListener('click', () => removeToast(toast));
        setTimeout(() => removeToast(toast), duration);
    };

    function removeToast(toast) {
        if (!toast || !toast.parentElement) return;
        toast.classList.add('removing');
        setTimeout(() => { if (toast.parentElement) toast.parentElement.removeChild(toast); }, 300);
    }

    // ==================== DISPLAY REPORT ====================
    function displayReport(d) {
        switchPage('pageResults');
        setActiveTab('home');

        $('reportContent').innerHTML =
            '<div class="result-card">' +
                '<div class="result-icon ' + d.label + '">' +
                    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
                '</div>' +
                '<div class="result-class ' + d.label + '">' + d.label + '</div>' +
                '<div class="result-actions">' +
                    '<button class="btn btn-red" onclick="new Audio(\'' + (d.audio_url || '') + '\').play().catch(function(){})">' +
                        '<i data-lucide="play" style="width:14px;height:14px"></i> Play Sound' +
                    '</button>' +
                    '<a href="' + (d.audio_url || '#') + '" download="' + (d.filename || 'heartbeat.wav') + '" class="btn btn-outline">' +
                        '<i data-lucide="download" style="width:14px;height:14px"></i> Download' +
                    '</a>' +
                    '<button class="btn btn-outline" onclick="CV.downloadPDF()">' +
                        '<i data-lucide="file-text" style="width:14px;height:14px"></i> PDF Report' +
                    '</button>' +
                '</div>' +
            '</div>';

        if (window.lucide) lucide.createIcons();
        CV._lastResult = d;

        // Reset upload for next use
        uploadedFile = null;
        const fi = $('fileInput');
        if (fi) fi.value = '';
    }

    // ==================== PDF GENERATION — Unique Medical Report ====================
    CV.downloadPDF = async function () {
        const d = CV._lastResult;
        if (!d) {
            CV.showToast('error', 'No Data', 'No results to export.');
            return;
        }

        CV.showToast('info', 'Generating PDF', 'Please wait while the report is being created...');

        try {
            const el = $('pdfInner');
            const colors = {
                normal: '#059669', murmur: '#d97706',
                extrahls: '#d97706', extrastole: '#dc2626', artifact: '#64748b'
            };
            const bgs = {
                normal: '#ecfdf5', murmur: '#fffbeb',
                extrahls: '#fffbeb', extrastole: '#fef2f2', artifact: '#f8fafc'
            };
            const icons = {
                normal: '&#10003;',
                murmur: '&#9888;',
                extrahls: '&#9888;',
                extrastole: '&#10007;',
                artifact: '&#8212;'
            };

            const c = colors[d.label] || '#64748b';
            const bg = bgs[d.label] || '#f8fafc';

            const reportId = 'CV-' + Date.now().toString(36).toUpperCase();
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            // Score rows with percentage labels
            let scoreRows = '';
            for (const [cls, val] of Object.entries(d.all_scores || {})) {
                const sc = colors[cls] || '#64748b';
                scoreRows +=
                    '<div class="pdf-score-row">' +
                        '<span class="pdf-score-label">' + cls + '</span>' +
                        '<div class="pdf-score-track">' +
                            '<div class="pdf-score-fill" style="width:' + val + '%;background:' + sc + '"></div>' +
                        '</div>' +
                        '<span class="pdf-score-val" style="color:' + sc + '">' + parseFloat(val).toFixed(1) + '%</span>' +
                    '</div>';
            }

            const specHtml = d.spectrogram_b64
                ? '<img class="pdf-spec-img" src="data:image/png;base64,' + d.spectrogram_b64 + '" alt="Mel-Spectrogram">'
                : '<p style="color:#9ca3af;font-size:12px;text-align:center;padding:20px;">Spectrogram not available</p>';

            // Rec style based on classification
            const recStyles = {
                normal: 'background:#ecfdf5;border-left:4px solid #059669;color:#065f46;',
                murmur: 'background:#fffbeb;border-left:4px solid #d97706;color:#92400e;',
                extrahls: 'background:#fffbeb;border-left:4px solid #d97706;color:#92400e;',
                extrastole: 'background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;',
                artifact: 'background:#f8fafc;border-left:4px solid #64748b;color:#334155;'
            };
            const recStyle = recStyles[d.label] || recStyles.artifact;

            el.innerHTML =
                '<div style="padding:40px 44px;">' +

                // ---- HEADER with left accent bar ----
                '<div style="display:flex;align-items:center;gap:20px;margin-bottom:28px;">' +
                    '<div style="width:6px;height:56px;background:' + c + ';border-radius:3px;flex-shrink:0;"></div>' +
                    '<div style="flex:1;">' +
                        '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
                            '<div>' +
                                '<h1>CardioVision</h1>' +
                                '<p class="pdf-meta" style="margin-top:4px;">Heart Sound Classification Report</p>' +
                            '</div>' +
                            '<div style="text-align:right;">' +
                                '<p style="font-size:11px;font-weight:600;color:' + c + ';letter-spacing:0.5px;">' + reportId + '</p>' +
                                '<p class="pdf-meta">' + dateStr + '</p>' +
                                '<p class="pdf-meta">' + timeStr + '</p>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +

                // ---- CLASSIFICATION RESULT ----
                '<div style="display:flex;align-items:center;gap:16px;padding:20px 24px;background:' + bg + ';border:1px solid ' + c + '22;border-radius:12px;margin-bottom:24px;">' +
                    '<div style="width:52px;height:52px;border-radius:50%;background:' + c + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">' + (icons[d.label] || '') + '</div>' +
                    '<div>' +
                        '<div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">Classification Result</div>' +
                        '<div style="font-size:28px;font-weight:900;color:' + c + ';text-transform:capitalize;letter-spacing:-1px;">' + d.label + '</div>' +
                    '</div>' +
                '</div>' +

                // ---- EXPLANATION ----
                '<div style="margin-bottom:24px;">' +
                    '<p style="font-size:13px;color:#374151;line-height:1.8;">' + (d.explanation || 'No explanation available.') + '</p>' +
                '</div>' +

                '<div class="pdf-divider"></div>' +

                // ---- SCORE DISTRIBUTION ----
                '<h2>Score Distribution</h2>' +
                '<div style="margin-bottom:4px;">' + scoreRows + '</div>' +

                '<div class="pdf-divider"></div>' +

                // ---- SPECTROGRAM ----
                '<h2>Mel-Frequency Spectrogram</h2>' +
                '<div style="background:#f9fafb;border-radius:12px;padding:12px;">' + specHtml + '</div>' +

                '<div class="pdf-divider"></div>' +

                // ---- RECOMMENDATION ----
                '<h2>Clinical Recommendation</h2>' +
                '<div class="pdf-rec" style="' + recStyle + '">' +
                    '<strong style="display:block;margin-bottom:4px;">' + (d.recommendation || 'Consult a healthcare professional.') + '</strong>' +
                '</div>' +

                // ---- FOOTER ----
                '<div class="pdf-footer">' +
                    '<div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:8px;">' +
                        '<span style="font-size:14px;color:#dc2626;">&#9829;</span>' +
                        '<span style="font-weight:700;color:#6b7280;">CardioVision Diagnostic System</span>' +
                    '</div>' +
                    '<p>This AI-assisted classification report is generated for clinical decision support purposes only. It does not constitute a medical diagnosis. Results should be reviewed and validated by a qualified healthcare professional before any clinical action is taken.</p>' +
                    '<p style="margin-top:6px;">Model: TensorFlow Lite CNN &middot; Input: 224&times;224 Mel-Spectrogram &middot; Report ID: ' + reportId + '</p>' +
                '</div>' +

                '</div>';

            // Wait for images to load
            const imgs = el.querySelectorAll('img');
            if (imgs.length) {
                await Promise.all(Array.from(imgs).map(img => {
                    if (img.complete) return Promise.resolve();
                    return new Promise(r => { img.onload = r; img.onerror = r; });
                }));
            }
            await new Promise(r => setTimeout(r, 400));

            const canvas = await html2canvas(el, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                logging: false,
                allowTaint: true,
            });

            const imgData = canvas.toDataURL('image/png', 1.0);
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('l', 'mm', 'a4');
            const pw = pdf.internal.pageSize.getWidth();
            const ph = pdf.internal.pageSize.getHeight();
            const ratio = canvas.width / canvas.height;
            let imgW = pw, imgH = pw / ratio;
            if (imgH > ph) { imgH = ph; imgW = ph * ratio; }
            pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH);
            pdf.save('cardiovision_report.pdf');

            CV.showToast('success', 'PDF Downloaded', 'Report saved as cardiovision_report.pdf');

        } catch (e) {
            console.error('PDF failed:', e);
            CV.showToast('error', 'PDF Error', 'Failed to generate PDF. Please try again.');
        }
    };

    // ==================== HISTORY ====================
    async function loadHistory() {
        try {
            const r = await fetch('/history/');
            const d = await r.json();
            renderHistory(d.history || []);
        } catch (e) { /* ignore */ }
    }

    function renderHistory(items) {
        const countEl = $('historyCount');
        if (countEl) countEl.textContent = items.length || '';

        if (!items.length) {
            $('historyContainer').innerHTML =
                '<div class="history-empty">' +
                    '<i data-lucide="inbox" style="width:32px;height:32px"></i>' +
                    '<p>No analyses yet</p>' +
                    '<span>Record or upload your first heart sound</span>' +
                '</div>';
            if (window.lucide) lucide.createIcons();
            return;
        }

        $('historyContainer').innerHTML = items.map(i =>
            '<div class="history-item">' +
                '<div class="history-item-top">' +
                    '<span class="history-label ' + i.label + '">' + i.label + '</span>' +
                '</div>' +
                '<div class="history-time">' + (i.timestamp || '') + '</div>' +
                '<div class="history-btns">' +
                    '<button class="btn btn-ghost btn-sm" onclick="new Audio(\'' + i.audio_url + '\').play().catch(function(){})">' +
                        '<i data-lucide="play" style="width:11px;height:11px"></i>' +
                    '</button>' +
                    '<button class="btn-icon" style="color:var(--red)" onclick="CV.deleteHistory(\'' + i.id + '\',\'' + i.filename + '\')">' +
                        '<i data-lucide="trash-2" style="width:11px;height:11px"></i>' +
                    '</button>' +
                '</div>' +
            '</div>'
        ).join('');

        if (window.lucide) lucide.createIcons();
    }

    CV.deleteHistory = async function (id, fn) {
        try {
            await fetch('/delete_audio/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id, filename: fn }),
            });
            loadHistory();
        } catch (e) { /* ignore */ }
    };

})();
