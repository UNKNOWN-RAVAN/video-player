class UltimateVideoPlayer {
    constructor() {
        this.video = document.getElementById('videoPlayer');
        this.apiUrlInput = document.getElementById('apiUrl');
        this.loadBtn = document.getElementById('loadBtn');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.playerContainer = document.getElementById('playerContainer');
        this.statusDiv = document.querySelector('.status-text');
        this.statusIcon = document.querySelector('.status-icon');
        this.debugLog = document.getElementById('debugLog');
        this.videoInfo = document.getElementById('videoInfo');
        this.overlay = document.getElementById('videoOverlay');
        
        // Player instances
        this.shakaPlayer = null;
        this.hls = null;
        this.ytPlayer = null;
        this.currentType = null;
        
        // State
        this.isPlaying = false;
        this.currentQuality = 'auto';
        this.currentSpeed = 1;
        this.qualities = [];
        this.currentVideoData = null;
        
        // Download Manager
        this.downloads = new Map();
        this.downloadId = 0;
        
        // License server
        this.licenseServerUrl = 'https://license.videocrypt.com/validateLicense';
        
        this.init();
    }
    
    init() {
        this.initControls();
        this.initShaka();
        this.initDownloadManager();
        
        this.loadBtn.addEventListener('click', () => this.loadVideo());
        this.downloadBtn.addEventListener('click', () => this.showDownloadQualitySelector());
        this.apiUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.loadVideo();
        });
        
        // Tab switching
        document.querySelectorAll('.url-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.url-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const type = tab.dataset.type;
                const placeholders = {
                    api: 'https://bypass-pearl-tau.vercel.app/api/proxy?url=...',
                    mpd: 'https://example.com/video.mpd?token=...',
                    m3u8: 'https://example.com/playlist.m3u8',
                    mp4: 'https://example.com/video.mp4',
                    yt: 'https://youtu.be/... or https://youtube.com/watch?v=...'
                };
                this.apiUrlInput.placeholder = placeholders[type];
            });
        });
        
        this.log('Player initialized');
    }
    
    initDownloadManager() {
        document.getElementById('clearDownloadsBtn').addEventListener('click', () => {
            this.downloads.clear();
            this.renderDownloadList();
        });
        
        // Request notification permission
        if ('Notification' in window && Notification.permission !== 'granted') {
            Notification.requestPermission();
        }
    }
    
    initControls() {
        // Play/Pause
        const playPauseBtn = document.getElementById('playPauseBtn');
        playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.video.addEventListener('play', () => playPauseBtn.textContent = '⏸');
        this.video.addEventListener('pause', () => playPauseBtn.textContent = '▶');
        
        // Volume
        const volumeBtn = document.getElementById('volumeBtn');
        const volumeSlider = document.getElementById('volumeSlider');
        volumeSlider.addEventListener('input', (e) => {
            this.video.volume = e.target.value / 100;
            volumeBtn.textContent = this.video.volume === 0 ? '🔇' : '🔊';
        });
        volumeBtn.addEventListener('click', () => {
            this.video.muted = !this.video.muted;
            volumeBtn.textContent = this.video.muted ? '🔇' : '🔊';
        });
        
        // Progress bar
        const progressBg = document.getElementById('progressBg');
        const progressFill = document.getElementById('progressFill');
        const progressHover = document.getElementById('progressHover');
        const timeDisplay = document.getElementById('timeDisplay');
        
        this.video.addEventListener('timeupdate', () => {
            const percent = (this.video.currentTime / this.video.duration) * 100;
            progressFill.style.width = `${percent}%`;
            timeDisplay.textContent = `${this.formatTime(this.video.currentTime)} / ${this.formatTime(this.video.duration)}`;
        });
        
        progressBg.addEventListener('click', (e) => {
            const rect = progressBg.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            this.video.currentTime = percent * this.video.duration;
        });
        
        progressBg.addEventListener('mousemove', (e) => {
            const rect = progressBg.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            progressHover.style.width = `${percent * 100}%`;
        });
        
        progressBg.addEventListener('mouseleave', () => {
            progressHover.style.width = '0%';
        });
        
        // Quality selector
        const qualityBtn = document.getElementById('qualityBtn');
        const qualityDropdown = document.getElementById('qualityDropdown');
        qualityBtn.addEventListener('click', () => {
            qualityDropdown.classList.toggle('show');
            document.getElementById('speedDropdown').classList.remove('show');
        });
        
        // Speed selector
        const speedBtn = document.getElementById('speedBtn');
        const speedDropdown = document.getElementById('speedDropdown');
        speedBtn.addEventListener('click', () => {
            speedDropdown.classList.toggle('show');
            qualityDropdown.classList.remove('show');
        });
        
        document.querySelectorAll('.speed-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const speed = parseFloat(opt.dataset.speed);
                this.video.playbackRate = speed;
                this.currentSpeed = speed;
                speedBtn.textContent = `⏩ ${speed}x`;
                document.querySelectorAll('.speed-option').forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                speedDropdown.classList.remove('show');
                this.log(`Playback speed: ${speed}x`);
            });
        });
        
        // PiP
        document.getElementById('pipBtn').addEventListener('click', async () => {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                await this.video.requestPictureInPicture();
            }
        });
        
        // Fullscreen
        document.getElementById('fullscreenBtn').addEventListener('click', () => {
            if (!document.fullscreenElement) {
                this.playerContainer.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
        });
        
        // Close dropdowns on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.quality-selector')) qualityDropdown.classList.remove('show');
            if (!e.target.closest('.speed-selector')) speedDropdown.classList.remove('show');
        });
    }
    
    initShaka() {
        if (!window.shaka) return;
        if (window.shaka.polyfill) window.shaka.polyfill.installAll();
    }
    
    async loadVideo() {
        const activeTab = document.querySelector('.url-tab.active').dataset.type;
        let url = this.apiUrlInput.value.trim();
        
        if (!url) {
            this.updateStatus('error', 'Please enter a URL');
            return;
        }
        
        this.updateStatus('loading', 'Loading video...');
        this.playerContainer.style.display = 'block';
        this.overlay.style.display = 'flex';
        
        this.destroyPlayers();
        
        try {
            if (activeTab === 'api') {
                await this.loadFromAPI(url);
            } else if (activeTab === 'mpd') {
                await this.loadMPD(url, null);
            } else if (activeTab === 'm3u8') {
                await this.loadM3U8(url);
            } else if (activeTab === 'mp4') {
                await this.loadMP4(url);
            } else if (activeTab === 'yt') {
                await this.loadYouTube(url);
            }
        } catch (error) {
            this.handleError(error);
            this.overlay.style.display = 'none';
        }
    }
    
    async loadFromAPI(apiUrl) {
        this.log('Fetching from API:', apiUrl);
        
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        if (!data.status || !data.data || !data.data.link) {
            throw new Error('Invalid API response');
        }
        
        const videoData = data.data.link;
        this.currentVideoData = videoData;
        const mpdUrl = videoData.file_url;
        const token = videoData.token;
        
        this.updateVideoInfo({
            type: 'DRM MPD',
            url: mpdUrl,
            token: token?.substring(0, 50) + '...',
            ads: videoData.ad_enable ? 'Yes' : 'No',
            vr: videoData.is_vr_video ? 'Yes' : 'No'
        });
        
        await this.loadMPD(mpdUrl, token);
    }
    
    async loadMPD(mpdUrl, token) {
        this.log('Loading MPD:', mpdUrl);
        this.currentType = 'mpd';
        
        if (!window.shaka || !window.shaka.Player.isBrowserSupported()) {
            throw new Error('Shaka Player not supported');
        }
        
        this.shakaPlayer = new window.shaka.Player(this.video);
        
        this.shakaPlayer.configure({
            drm: {
                servers: { 'com.widevine.alpha': this.licenseServerUrl },
                advanced: { 'com.widevine.alpha': { videoRobustness: '' } }
            },
            abr: { enabled: true }
        });
        
        if (token) {
            this.shakaPlayer.getNetworkingEngine().registerRequestFilter((type, request) => {
                if (type === window.shaka.net.NetworkingEngine.RequestType.LICENSE) {
                    request.headers['pallycon-customdata-v2'] = token;
                }
            });
        }
        
        this.shakaPlayer.addEventListener('error', (e) => this.handleShakaError(e.detail));
        this.shakaPlayer.addEventListener('trackschanged', () => this.updateQualities());
        
        const urlWithToken = token ? `${mpdUrl}${mpdUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : mpdUrl;
        await this.shakaPlayer.load(urlWithToken);
        
        this.setupVideoEvents();
        this.overlay.style.display = 'none';
        this.updateStatus('success', 'Video loaded successfully');
    }
    
    async loadM3U8(url) {
        this.log('Loading M3U8:', url);
        this.currentType = 'm3u8';
        
        if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
            this.video.src = url;
            this.setupVideoEvents();
        } else if (window.Hls && window.Hls.isSupported()) {
            this.hls = new window.Hls();
            this.hls.loadSource(url);
            this.hls.attachMedia(this.video);
            this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
                this.updateQualitiesHLS();
                this.overlay.style.display = 'none';
            });
            this.hls.on(window.Hls.Events.ERROR, (e, data) => {
                if (data.fatal) this.handleError(new Error('HLS error'));
            });
        } else {
            throw new Error('HLS not supported');
        }
        
        this.updateVideoInfo({ type: 'HLS/M3U8', url: url });
        this.setupVideoEvents();
    }
    
    async loadMP4(url) {
        this.log('Loading MP4:', url);
        this.currentType = 'mp4';
        this.video.src = url;
        this.setupVideoEvents();
        this.updateVideoInfo({ type: 'MP4', url: url });
    }
    
    async loadYouTube(url) {
        this.log('Loading YouTube:', url);
        this.currentType = 'yt';
        
        let videoId = '';
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?#]+)/,
            /youtube\.com\/embed\/([^?#]+)/
        ];
        
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                videoId = match[1];
                break;
            }
        }
        
        if (!videoId) throw new Error('Invalid YouTube URL');
        
        if (typeof YT === 'undefined') {
            await this.loadYouTubeAPI();
        }
        
        this.ytPlayer = new YT.Player(this.video, {
            videoId: videoId,
            events: {
                onReady: () => {
                    this.overlay.style.display = 'none';
                    this.updateStatus('success', 'YouTube video loaded');
                },
                onError: (e) => this.handleError(new Error(`YouTube error: ${e.data}`))
            }
        });
        
        this.updateVideoInfo({ type: 'YouTube', url: url, videoId: videoId });
    }
    
    setupVideoEvents() {
        this.video.addEventListener('playing', () => {
            this.overlay.style.display = 'none';
            this.updateStatus('success', 'Playing');
        });
        
        this.video.addEventListener('waiting', () => {
            this.overlay.style.display = 'flex';
        });
        
        this.video.addEventListener('canplay', () => {
            this.overlay.style.display = 'none';
        });
        
        this.video.addEventListener('error', () => {
            this.handleError(new Error('Video playback error'));
        });
        
        this.video.play().catch(() => {
            this.video.muted = true;
            this.video.play().catch(() => {});
        });
    }
    
    updateQualities() {
        if (!this.shakaPlayer) return;
        
        const tracks = this.shakaPlayer.getVariantTracks();
        const qualities = [...new Map(tracks.map(t => [t.height, t])).values()]
            .sort((a, b) => b.height - a.height);
        
        this.qualities = qualities;
        const dropdown = document.getElementById('qualityDropdown');
        dropdown.innerHTML = '<div class="quality-option" data-quality="auto">Auto</div>';
        
        qualities.forEach(track => {
            const opt = document.createElement('div');
            opt.className = 'quality-option';
            opt.dataset.quality = track.height;
            opt.dataset.trackId = track.id;
            opt.textContent = `${track.height}p`;
            opt.addEventListener('click', () => this.setQuality(track.height));
            dropdown.appendChild(opt);
        });
    }
    
    updateQualitiesHLS() {
        if (!this.hls) return;
        
        const levels = this.hls.levels;
        const dropdown = document.getElementById('qualityDropdown');
        dropdown.innerHTML = '<div class="quality-option" data-quality="auto">Auto</div>';
        
        levels.forEach((level, index) => {
            const opt = document.createElement('div');
            opt.className = 'quality-option';
            opt.dataset.quality = level.height;
            opt.dataset.level = index;
            opt.textContent = `${level.height}p`;
            opt.addEventListener('click', () => {
                this.hls.currentLevel = index;
                this.currentQuality = level.height;
            });
            dropdown.appendChild(opt);
        });
    }
    
    setQuality(height) {
        if (!this.shakaPlayer) return;
        
        if (height === 'auto') {
            this.shakaPlayer.configure({ abr: { enabled: true } });
            this.currentQuality = 'auto';
        } else {
            const track = this.qualities.find(t => t.height === height);
            if (track) {
                this.shakaPlayer.configure({ abr: { enabled: false } });
                this.shakaPlayer.selectVariantTrack(track, true);
                this.currentQuality = height;
            }
        }
        
        document.getElementById('qualityDropdown').classList.remove('show');
        this.log(`Quality set to: ${height === 'auto' ? 'Auto' : height + 'p'}`);
    }
    
    showDownloadQualitySelector() {
        const activeTab = document.querySelector('.url-tab.active').dataset.type;
        let url = this.apiUrlInput.value.trim();
        
        if (!url) {
            this.showNotification('Please enter a URL first', 'error');
            return;
        }
        
        const selector = document.getElementById('qualitySelector');
        const buttonsDiv = document.getElementById('qualityButtons');
        
        if (activeTab === 'yt') {
            // YouTube: Open with Snaptube/Vidmate intent
            this.downloadYouTube(url);
            return;
        }
        
        // For other formats, show quality selector
        buttonsDiv.innerHTML = '<div class="quality-btn" data-quality="original">Original Quality</div>';
        
        if (this.qualities.length > 0) {
            this.qualities.forEach(q => {
                const btn = document.createElement('div');
                btn.className = 'quality-btn';
                btn.dataset.quality = q.height;
                btn.textContent = `${q.height}p`;
                btn.addEventListener('click', () => {
                    this.startDownload(url, activeTab, q.height);
                    selector.style.display = 'none';
                });
                buttonsDiv.appendChild(btn);
            });
        } else {
            const btn = document.createElement('div');
            btn.className = 'quality-btn';
            btn.dataset.quality = 'original';
            btn.textContent = 'Download';
            btn.addEventListener('click', () => {
                this.startDownload(url, activeTab, null);
                selector.style.display = 'none';
            });
            buttonsDiv.appendChild(btn);
        }
        
        selector.style.display = 'block';
        setTimeout(() => {
            selector.style.display = 'none';
        }, 5000);
    }
    
    downloadYouTube(url) {
        // Extract video ID
        let videoId = '';
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?#]+)/,
            /youtube\.com\/embed\/([^?#]+)/
        ];
        
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                videoId = match[1];
                break;
            }
        }
        
        if (!videoId) {
            this.showNotification('Invalid YouTube URL', 'error');
            return;
        }
        
        // Create intent URL for Snaptube/Vidmate
        const intentUrl = `snaptube://watch?v=${videoId}`;
        
        // Try to open with app
        window.location.href = intentUrl;
        
        // Fallback: open in new tab with download link
        setTimeout(() => {
            const fallbackUrl = `https://www.y2mate.com/youtube/${videoId}`;
            window.open(fallbackUrl, '_blank');
        }, 500);
        
        this.showNotification('Opening in Snaptube/Vidmate...', 'success');
    }
    
    async startDownload(url, type, quality) {
        const id = ++this.downloadId;
        const filename = `video_${Date.now()}_${quality || 'original'}.mp4`;
        
        const downloadItem = {
            id,
            filename,
            url,
            type,
            quality,
            status: 'downloading',
            progress: 0,
            speed: 0,
            downloaded: 0,
            total: 0,
            eta: 0,
            startTime: Date.now(),
            xhr: null
        };
        
        this.downloads.set(id, downloadItem);
        this.renderDownloadList();
        this.showNotification(`Starting download: ${filename}`, 'success');
        
        // Start download in background
        this.performDownload(downloadItem);
    }
    
    async performDownload(item) {
        try {
            const response = await fetch(item.url);
            const reader = response.body.getReader();
            const contentLength = parseInt(response.headers.get('Content-Length')) || 0;
            
            item.total = contentLength;
            
            const chunks = [];
            let receivedLength = 0;
            let lastTime = Date.now();
            let lastBytes = 0;
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                chunks.push(value);
                receivedLength += value.length;
                item.downloaded = receivedLength;
                
                // Update speed
                const now = Date.now();
                const timeDiff = (now - lastTime) / 1000;
                const bytesDiff = receivedLength - lastBytes;
                item.speed = bytesDiff / timeDiff;
                lastTime = now;
                lastBytes = receivedLength;
                
                // Update progress
                if (contentLength > 0) {
                    item.progress = (receivedLength / contentLength) * 100;
                    const remainingBytes = contentLength - receivedLength;
                    item.eta = remainingBytes / item.speed;
                }
                
                this.renderDownloadList();
            }
            
            // Combine chunks and create blob
            const blob = new Blob(chunks);
            const downloadUrl = URL.createObjectURL(blob);
            
            // Trigger download in new window
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = item.filename;
            a.target = '_blank';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            URL.revokeObjectURL(downloadUrl);
            
            item.status = 'completed';
            item.progress = 100;
            this.renderDownloadList();
            this.showNotification(`Download complete: ${item.filename}`, 'success');
            
            // Send notification
            if (Notification.permission === 'granted') {
                new Notification('Download Complete', {
                    body: `${item.filename} has been downloaded successfully!`,
                    icon: 'https://cdn-icons-png.flaticon.com/512/190/190411.png'
                });
            }
            
        } catch (error) {
            item.status = 'failed';
            item.error = error.message;
            this.renderDownloadList();
            this.showNotification(`Download failed: ${item.filename}`, 'error');
        }
    }
    
    renderDownloadList() {
        const container = document.getElementById('downloadList');
        
        if (this.downloads.size === 0) {
            container.innerHTML = '<div class="empty-downloads">No active downloads</div>';
            return;
        }
        
        let html = '';
        for (const [id, item] of this.downloads) {
            const speedText = this.formatSpeed(item.speed);
            const sizeText = this.formatSize(item.downloaded);
            const totalText = this.formatSize(item.total);
            const etaText = item.eta ? this.formatTime(item.eta) : '--:--';
            
            html += `
                <div class="download-item" data-id="${id}">
                    <div class="download-info">
                        <span class="download-filename">${this.escapeHtml(item.filename)}</span>
                        <span class="download-status ${item.status}">${item.status}</span>
                    </div>
                    <div class="download-progress-bar">
                        <div class="download-progress-fill" style="width: ${item.progress}%"></div>
                    </div>
                    <div class="download-stats">
                        <span>${sizeText} / ${totalText}</span>
                        <span class="download-speed">⚡ ${speedText}/s</span>
                        <span>⏱ ETA: ${etaText}</span>
                    </div>
                    <div class="download-actions">
                        ${item.status === 'failed' ? `<button class="download-action-btn" onclick="window.player.retryDownload(${id})">↻ Retry</button>` : ''}
                        <button class="download-action-btn danger" onclick="window.player.cancelDownload(${id})">✖ Cancel</button>
                    </div>
                </div>
            `;
        }
        
        container.innerHTML = html;
    }
    
    retryDownload(id) {
        const item = this.downloads.get(id);
        if (item && item.status === 'failed') {
            item.status = 'downloading';
            item.progress = 0;
            item.downloaded = 0;
            item.speed = 0;
            this.performDownload(item);
        }
    }
    
    cancelDownload(id) {
        const item = this.downloads.get(id);
        if (item && item.xhr) {
            item.xhr.abort();
        }
        this.downloads.delete(id);
        this.renderDownloadList();
        this.showNotification('Download cancelled', 'info');
    }
    
    formatSpeed(bytesPerSecond) {
        if (bytesPerSecond === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
        return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    
    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    
    formatTime(seconds) {
        if (isNaN(seconds) || !isFinite(seconds)) return '--:--';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    escapeHtml(str) {
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }
    
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
    
    togglePlayPause() {
        if (this.currentType === 'yt' && this.ytPlayer) {
            if (this.isPlaying) this.ytPlayer.pauseVideo();
            else this.ytPlayer.playVideo();
        } else {
            if (this.video.paused) this.video.play();
            else this.video.pause();
        }
    }
    
    destroyPlayers() {
        if (this.shakaPlayer) {
            this.shakaPlayer.destroy();
            this.shakaPlayer = null;
        }
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        if (this.ytPlayer) {
            this.ytPlayer.destroy();
            this.ytPlayer = null;
        }
        this.video.src = '';
        this.video.load();
    }
    
    loadYouTubeAPI() {
        return new Promise((resolve, reject) => {
            if (window.YT && window.YT.Player) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://www.youtube.com/iframe_api';
            script.onload = () => {
                window.onYouTubeIframeAPIReady = resolve;
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    
    updateVideoInfo(data) {
        let html = '<div style="display: grid; gap: 8px;">';
        for (const [key, value] of Object.entries(data)) {
            if (value) html += `<div><strong>${key}:</strong> ${value}</div>`;
        }
        html += '</div>';
        this.videoInfo.innerHTML = html;
    }
    
    handleShakaError(error) {
        this.log('Shaka Error:', error);
        let msg = error.message || 'DRM error';
        if (error.code === 6007) msg = 'License failed - Token may be expired';
        this.updateStatus('error', msg);
    }
    
    handleError(error) {
        this.log('Error:', error);
        this.updateStatus('error', error.message);
        this.overlay.style.display = 'none';
    }
    
    updateStatus(type, message) {
        const icons = { loading: '⏳', success: '✅', error: '❌' };
        this.statusIcon.textContent = icons[type] || 'ℹ️';
        this.statusDiv.textContent = message;
        
        const statusContainer = document.querySelector('.status');
        statusContainer.style.borderLeftColor = type === 'error' ? '#dc3545' : 
                                               type === 'success' ? '#28a745' : '#667eea';
    }
    
    log(...args) {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
        ).join(' ')}`;
        
        console.log(logMessage);
        const debugLog = document.getElementById('debugLog');
        debugLog.textContent = debugLog.textContent + '\n' + logMessage;
        
        const lines = debugLog.textContent.split('\n');
        if (lines.length > 200) {
            debugLog.textContent = lines.slice(-200).join('\n');
        }
    }
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    window.player = new UltimateVideoPlayer();
});