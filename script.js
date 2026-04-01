class DRMVideoPlayer {
    constructor() {
        this.player = null;
        this.videoElement = document.getElementById('videoPlayer');
        this.apiUrlInput = document.getElementById('apiUrl');
        this.loadBtn = document.getElementById('loadBtn');
        this.playerContainer = document.getElementById('playerContainer');
        this.statusDiv = document.querySelector('.status-text');
        this.statusIcon = document.querySelector('.status-icon');
        this.debugLog = document.getElementById('debugLog');
        this.videoInfo = document.getElementById('videoInfo');
        this.downloadSection = document.getElementById('downloadSection');
        
        // License server
        this.licenseServerUrl = 'https://license.videocrypt.com/validateLicense';
        
        // Store current data
        this.currentMpdUrl = null;
        this.currentToken = null;
        this.currentVideoData = null;
        this.availableQualities = [];
        this.currentQuality = null;
        this.isLocked = false;
        this.isRotated = false;
        
        // Custom controls elements
        this.initCustomControls();
        
        this.init();
    }
    
    initCustomControls() {
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.seekSlider = document.getElementById('seekSlider');
        this.currentTimeSpan = document.getElementById('currentTime');
        this.durationSpan = document.getElementById('duration');
        this.volumeSlider = document.getElementById('volumeSlider');
        this.volumeBtn = document.getElementById('volumeBtn');
        this.fullscreenBtn = document.getElementById('fullscreenBtn');
        this.qualitySelect = document.getElementById('qualitySelect');
        this.speedSelect = document.getElementById('speedSelect');
        this.pipBtn = document.getElementById('pipBtn');
        this.rotateBtn = document.getElementById('rotateBtn');
        this.lockBtn = document.getElementById('lockBtn');
        this.progressFilled = document.getElementById('progressFilled');
        this.progressBuffer = document.getElementById('progressBuffer');
        this.videoTitle = document.getElementById('videoTitle');
        this.downloadQualitySelect = document.getElementById('downloadQualitySelect');
        this.downloadBtn = document.getElementById('downloadBtn');
        
        // Custom controls visibility
        const wrapper = document.querySelector('.video-wrapper');
        const controls = document.getElementById('customControls');
        
        if (wrapper && controls) {
            let timeout;
            wrapper.addEventListener('mousemove', () => {
                controls.classList.add('active');
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    if (!this.isLocked) controls.classList.remove('active');
                }, 2000);
            });
            
            wrapper.addEventListener('mouseleave', () => {
                if (!this.isLocked) controls.classList.remove('active');
            });
        }
    }
    
    init() {
        this.initShakaPlayer();
        this.loadBtn.addEventListener('click', () => this.loadVideo());
        this.apiUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.loadVideo();
        });
        
        this.setupEventListeners();
        this.log('Player initialized');
    }
    
    setupEventListeners() {
        // Video events
        this.videoElement.addEventListener('timeupdate', () => this.updateProgress());
        this.videoElement.addEventListener('loadedmetadata', () => this.onVideoLoaded());
        this.videoElement.addEventListener('play', () => this.playPauseBtn.textContent = '⏸');
        this.videoElement.addEventListener('pause', () => this.playPauseBtn.textContent = '▶');
        this.videoElement.addEventListener('volumechange', () => this.updateVolumeIcon());
        
        // Control buttons
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.seekSlider.addEventListener('input', (e) => this.seek(e.target.value));
        this.volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value));
        this.volumeBtn.addEventListener('click', () => this.toggleMute());
        this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
        this.speedSelect.addEventListener('change', (e) => this.setPlaybackRate(e.target.value));
        this.pipBtn.addEventListener('click', () => this.togglePictureInPicture());
        this.rotateBtn.addEventListener('click', () => this.toggleRotate());
        this.lockBtn.addEventListener('click', () => this.toggleLock());
        this.downloadBtn.addEventListener('click', () => this.downloadAndMergeSegments());
        
        // Buffer progress
        this.videoElement.addEventListener('progress', () => this.updateBuffer());
    }
    
    initShakaPlayer() {
        if (!this.videoElement) return;
        
        if (!window.shaka) {
            this.updateStatus('error', 'Shaka Player not loaded');
            return;
        }
        
        if (window.shaka.polyfill) {
            window.shaka.polyfill.installAll();
        }
        
        if (!window.shaka.Player.isBrowserSupported()) {
            this.updateStatus('error', 'Browser does not support DRM playback');
            return;
        }
        
        this.player = new window.shaka.Player(this.videoElement);
        
        this.player.configure({
            drm: {
                servers: {
                    'com.widevine.alpha': this.licenseServerUrl
                },
                advanced: {
                    'com.widevine.alpha': {
                        videoRobustness: ''
                    }
                },
                retryParameters: {
                    maxAttempts: 5,
                    baseDelay: 1000,
                    backoffFactor: 2
                }
            },
            streaming: {
                rebufferingGoal: 2,
                bufferingGoal: 10,
                retryParameters: {
                    maxAttempts: 5,
                    baseDelay: 1000,
                    backoffFactor: 2
                }
            }
        });
        
        // Add request filters
        const netEngine = this.player.getNetworkingEngine();
        if (netEngine) {
            netEngine.registerRequestFilter((type, request) => {
                if (type === window.shaka.net.NetworkingEngine.RequestType.MANIFEST) {
                    if (this.currentToken && !request.uris[0].includes('token=')) {
                        const separator = request.uris[0].includes('?') ? '&' : '?';
                        request.uris[0] = `${request.uris[0]}${separator}token=${encodeURIComponent(this.currentToken)}`;
                    }
                }
                
                if (type === window.shaka.net.NetworkingEngine.RequestType.LICENSE) {
                    request.headers['pallycon-customdata-v2'] = this.currentToken;
                    request.headers['Origin'] = window.location.origin;
                    request.headers['X-Requested-With'] = 'XMLHttpRequest';
                }
                
                if (type === window.shaka.net.NetworkingEngine.RequestType.SEGMENT) {
                    if (this.currentToken && !request.uris[0].includes('token=')) {
                        const separator = request.uris[0].includes('?') ? '&' : '?';
                        request.uris[0] = `${request.uris[0]}${separator}token=${encodeURIComponent(this.currentToken)}`;
                    }
                }
            });
        }
        
        this.player.addEventListener('error', (event) => this.handleShakaError(event.detail));
        this.player.addEventListener('trackschanged', () => this.updateQualityOptions());
        
        this.log('Shaka Player initialized');
    }
    
    async loadVideo() {
        const apiUrl = this.apiUrlInput.value.trim();
        
        if (!apiUrl) {
            this.updateStatus('error', 'Please enter an API URL');
            return;
        }
        
        this.updateStatus('loading', 'Fetching video details...');
        this.playerContainer.style.display = 'none';
        this.downloadSection.style.display = 'none';
        
        try {
            const response = await fetch(apiUrl);
            const data = await response.json();
            
            if (!data.status || !data.data || !data.data.link) {
                throw new Error('Invalid API response format');
            }
            
            const videoData = data.data.link;
            const mpdUrl = videoData.file_url;
            const token = videoData.token;
            
            if (!mpdUrl) throw new Error('No MPD URL found');
            
            this.currentMpdUrl = mpdUrl;
            this.currentToken = token;
            this.currentVideoData = videoData;
            
            if (this.videoTitle) this.videoTitle.textContent = videoData.title || 'DRM Video';
            
            this.updateVideoInfo(videoData);
            await this.playVideo(mpdUrl, token);
            
        } catch (error) {
            this.handleError(error);
        }
    }
    
    async playVideo(mpdUrl, token) {
        this.updateStatus('loading', 'Loading DRM video...');
        
        try {
            const urlWithToken = `${mpdUrl}${mpdUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
            await this.player.load(urlWithToken);
            
            this.playerContainer.style.display = 'block';
            this.downloadSection.style.display = 'block';
            this.updateStatus('success', 'Video loaded! Ready to play');
            
            this.videoElement.play().catch(e => {
                this.log('Auto-play blocked');
                this.videoElement.muted = true;
                this.videoElement.play();
            });
            
        } catch (error) {
            this.log('Failed to load video:', error);
            this.updateStatus('error', `Failed: ${error.message}`);
            throw error;
        }
    }
    
    updateQualityOptions() {
        if (!this.player) return;
        
        const tracks = this.player.getVariantTracks();
        const qualities = [];
        
        tracks.forEach(track => {
            if (track.height && !qualities.includes(track.height)) {
                qualities.push(track.height);
            }
        });
        
        qualities.sort((a, b) => a - b);
        this.availableQualities = qualities;
        
        // Update quality select
        this.qualitySelect.innerHTML = '<option value="auto">Auto Quality</option>';
        qualities.forEach(height => {
            this.qualitySelect.innerHTML += `<option value="${height}">${height}p</option>`;
        });
        
        // Update download quality select
        this.downloadQualitySelect.innerHTML = '<option value="">Select quality to download...</option>';
        qualities.forEach(height => {
            this.downloadQualitySelect.innerHTML += `<option value="${height}">${height}p</option>`;
        });
        
        this.qualitySelect.addEventListener('change', (e) => this.changeQuality(e.target.value));
    }
    
    changeQuality(height) {
        if (!this.player) return;
        
        const tracks = this.player.getVariantTracks();
        let selectedTrack = null;
        
        if (height === 'auto') {
            this.player.configure({ abr: { enabled: true } });
            this.log('Quality set to Auto');
            return;
        }
        
        this.player.configure({ abr: { enabled: false } });
        
        for (let track of tracks) {
            if (track.height === parseInt(height)) {
                selectedTrack = track;
                break;
            }
        }
        
        if (selectedTrack) {
            this.player.selectVariantTrack(selectedTrack);
            this.currentQuality = height;
            this.log(`Quality changed to ${height}p`);
        }
    }
    
    async downloadAndMergeSegments() {
        const selectedQuality = this.downloadQualitySelect.value;
        if (!selectedQuality) {
            this.updateStatus('error', 'Please select a quality to download');
            return;
        }
        
        if (!this.currentMpdUrl || !this.currentToken) {
            this.updateStatus('error', 'No video loaded');
            return;
        }
        
        this.downloadBtn.disabled = true;
        const progressArea = document.getElementById('downloadProgressArea');
        const progressBar = document.getElementById('downloadProgressBar');
        const statusText = document.getElementById('downloadStatusText');
        
        progressArea.style.display = 'block';
        progressBar.style.width = '0%';
        statusText.innerText = 'Fetching manifest...';
        
        try {
            const mpdUrlWithToken = `${this.currentMpdUrl}${this.currentMpdUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.currentToken)}`;
            const mpdResponse = await fetch(mpdUrlWithToken);
            const mpdText = await mpdResponse.text();
            
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(mpdText, "text/xml");
            
            // Find the representation with selected quality
            let selectedRepresentation = null;
            let baseUrl = '';
            
            const baseUrlElem = xmlDoc.querySelector('BaseURL');
            if (baseUrlElem) baseUrl = baseUrlElem.textContent.trim();
            
            const periods = xmlDoc.querySelectorAll('Period');
            
            for (let period of periods) {
                const adaptationSets = period.querySelectorAll('AdaptationSet');
                for (let as of adaptationSets) {
                    const mimeType = as.getAttribute('mimeType') || '';
                    if (mimeType.includes('video')) {
                        const representations = as.querySelectorAll('Representation');
                        for (let rep of representations) {
                            const height = rep.getAttribute('height');
                            if (height === selectedQuality) {
                                selectedRepresentation = rep;
                                break;
                            }
                        }
                        if (!selectedRepresentation && representations.length > 0) {
                            selectedRepresentation = representations[0];
                        }
                        break;
                    }
                }
                if (selectedRepresentation) break;
            }
            
            if (!selectedRepresentation) throw new Error('No representation found for selected quality');
            
            // Extract segment URLs
            let segmentUrls = [];
            let initializationUrl = null;
            
            let segmentTemplate = selectedRepresentation.querySelector('SegmentTemplate');
            if (!segmentTemplate) {
                const parentAs = selectedRepresentation.parentElement;
                segmentTemplate = parentAs.querySelector('SegmentTemplate');
            }
            
            if (segmentTemplate) {
                const mediaTemplate = segmentTemplate.getAttribute('media');
                const initialization = segmentTemplate.getAttribute('initialization');
                const startNumber = parseInt(segmentTemplate.getAttribute('startNumber') || '1');
                
                if (initialization) {
                    let initUrl = initialization.replace('$RepresentationID$', selectedRepresentation.getAttribute('id') || '');
                    initUrl = initUrl.replace('$Bandwidth$', selectedRepresentation.getAttribute('bandwidth') || '');
                    initUrl = this.resolveUrl(initUrl, baseUrl, this.currentMpdUrl);
                    initializationUrl = initUrl;
                }
                
                const timeline = segmentTemplate.querySelector('SegmentTimeline');
                if (timeline) {
                    const sElements = timeline.querySelectorAll('S');
                    let idx = startNumber;
                    for (let s of sElements) {
                        const repeat = parseInt(s.getAttribute('r') || '0');
                        for (let i = 0; i <= repeat; i++) {
                            let segUrl = mediaTemplate.replace('$Number$', idx);
                            segUrl = segUrl.replace('$RepresentationID$', selectedRepresentation.getAttribute('id') || '');
                            segUrl = segUrl.replace('$Bandwidth$', selectedRepresentation.getAttribute('bandwidth') || '');
                            segUrl = this.resolveUrl(segUrl, baseUrl, this.currentMpdUrl);
                            segmentUrls.push(segUrl);
                            idx++;
                        }
                    }
                } else {
                    for (let i = startNumber; i < startNumber + 300; i++) {
                        let segUrl = mediaTemplate.replace('$Number$', i);
                        segUrl = segUrl.replace('$RepresentationID$', selectedRepresentation.getAttribute('id') || '');
                        segUrl = this.resolveUrl(segUrl, baseUrl, this.currentMpdUrl);
                        segmentUrls.push(segUrl);
                    }
                }
            }
            
            if (segmentUrls.length === 0) throw new Error('No segments found');
            
            let mergedBuffer = new Uint8Array(0);
            
            if (initializationUrl) {
                statusText.innerText = 'Downloading init segment...';
                const initData = await this.downloadSegment(initializationUrl);
                mergedBuffer = this.concatBuffers(mergedBuffer, initData);
            }
            
            let downloaded = 0;
            for (let i = 0; i < segmentUrls.length; i++) {
                statusText.innerText = `Downloading segment ${i+1}/${segmentUrls.length}`;
                const percent = (i / segmentUrls.length) * 100;
                progressBar.style.width = `${percent}%`;
                
                try {
                    const segData = await this.downloadSegment(segmentUrls[i]);
                    mergedBuffer = this.concatBuffers(mergedBuffer, segData);
                    downloaded++;
                } catch (err) {
                    this.log(`Segment ${i+1} failed: ${err.message}`);
                    break;
                }
            }
            
            progressBar.style.width = '100%';
            statusText.innerText = `Creating file...`;
            
            const firstSeg = segmentUrls[0] || '';
            const isTs = firstSeg.includes('.ts') || firstSeg.endsWith('.ts');
            const extension = isTs ? 'ts' : 'mp4';
            const mimeType = isTs ? 'video/mp2t' : 'video/mp4';
            
            const blob = new Blob([mergedBuffer], { type: mimeType });
            const downloadUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const fileName = this.currentVideoData?.title?.replace(/[^a-z0-9]/gi, '_') || `video_${selectedQuality}p`;
            a.download = `${fileName}_${selectedQuality}p.${extension}`;
            a.href = downloadUrl;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);
            
            const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
            statusText.innerText = `✅ Complete! ${sizeMB} MB saved`;
            this.log(`Downloaded ${downloaded}/${segmentUrls.length} segments, ${sizeMB} MB`);
            
        } catch (error) {
            statusText.innerText = `❌ Error: ${error.message}`;
            this.log('Download error:', error);
        } finally {
            this.downloadBtn.disabled = false;
            setTimeout(() => {
                progressArea.style.display = 'none';
            }, 5000);
        }
    }
    
    async downloadSegment(url) {
        const separator = url.includes('?') ? '&' : '?';
        const urlWithToken = `${url}${separator}token=${encodeURIComponent(this.currentToken)}`;
        
        const response = await fetch(urlWithToken, {
            headers: {
                'Origin': window.location.origin,
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    }
    
    resolveUrl(relativeUrl, baseUrl, mpdBaseUrl) {
        if (!relativeUrl) return '';
        if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) return relativeUrl;
        
        if (baseUrl && (baseUrl.startsWith('http://') || baseUrl.startsWith('https://'))) {
            const basePath = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
            return basePath + relativeUrl;
        }
        
        const mpdPath = mpdBaseUrl.substring(0, mpdBaseUrl.lastIndexOf('/') + 1);
        return mpdPath + relativeUrl;
    }
    
    concatBuffers(a, b) {
        const result = new Uint8Array(a.length + b.length);
        result.set(a, 0);
        result.set(b, a.length);
        return result;
    }
    
    // Custom controls methods
    togglePlayPause() {
        if (this.videoElement.paused) {
            this.videoElement.play();
        } else {
            this.videoElement.pause();
        }
    }
    
    updateProgress() {
        if (this.videoElement.duration) {
            const percent = (this.videoElement.currentTime / this.videoElement.duration) * 100;
            this.seekSlider.value = percent;
            this.progressFilled.style.width = `${percent}%`;
            this.currentTimeSpan.textContent = this.formatTime(this.videoElement.currentTime);
        }
    }
    
    updateBuffer() {
        if (this.videoElement.buffered.length > 0) {
            const bufferedEnd = this.videoElement.buffered.end(this.videoElement.buffered.length - 1);
            const duration = this.videoElement.duration;
            const percent = (bufferedEnd / duration) * 100;
            this.progressBuffer.style.width = `${percent}%`;
        }
    }
    
    onVideoLoaded() {
        this.durationSpan.textContent = this.formatTime(this.videoElement.duration);
        this.seekSlider.max = 100;
    }
    
    seek(value) {
        const time = (value / 100) * this.videoElement.duration;
        this.videoElement.currentTime = time;
    }
    
    setVolume(value) {
        this.videoElement.volume = parseFloat(value);
        this.updateVolumeIcon();
    }
    
    toggleMute() {
        this.videoElement.muted = !this.videoElement.muted;
        this.updateVolumeIcon();
    }
    
    updateVolumeIcon() {
        if (this.videoElement.muted || this.videoElement.volume === 0) {
            this.volumeBtn.textContent = '🔇';
        } else if (this.videoElement.volume < 0.5) {
            this.volumeBtn.textContent = '🔉';
        } else {
            this.volumeBtn.textContent = '🔊';
        }
        this.volumeSlider.value = this.videoElement.volume;
    }
    
    setPlaybackRate(rate) {
        this.videoElement.playbackRate = parseFloat(rate);
        this.log(`Playback speed: ${rate}x`);
    }
    
    async togglePictureInPicture() {
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                await this.videoElement.requestPictureInPicture();
            }
        } catch (error) {
            this.log('PiP error:', error);
        }
    }
    
    toggleRotate() {
        const wrapper = document.querySelector('.video-wrapper');
        this.isRotated = !this.isRotated;
        if (this.isRotated) {
            wrapper.style.transform = 'rotate(90deg)';
            wrapper.style.aspectRatio = '9/16';
        } else {
            wrapper.style.transform = '';
            wrapper.style.aspectRatio = '16/9';
        }
    }
    
    toggleLock() {
        const controls = document.getElementById('customControls');
        this.isLocked = !this.isLocked;
        
        if (this.isLocked) {
            controls.style.opacity = '0';
            controls.style.pointerEvents = 'none';
            this.lockBtn.textContent = '🔓';
            this.showToast('Screen Locked');
        } else {
            controls.style.opacity = '';
            controls.style.pointerEvents = '';
            this.lockBtn.textContent = '🔒';
            this.showToast('Screen Unlocked');
        }
    }
    
    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }
    
    formatTime(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    showToast(message) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 14px;
            z-index: 1000;
            animation: fadeOut 2s forwards;
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }
    
    updateVideoInfo(videoData) {
        let html = `
            <div style="display: grid; gap: 8px;">
                <div><strong>🎬 MPD URL:</strong><br>${this.truncateUrl(videoData.file_url, 80)}</div>
                <div><strong>🔑 License Server:</strong><br>${this.licenseServerUrl}</div>
                <div><strong>🆔 Token:</strong><br>${videoData.token.substring(0, 60)}...</div>
                <div><strong>📺 Ads:</strong> ${videoData.ad_enable ? 'Yes' : 'No'} | 
                     <strong>VR:</strong> ${videoData.is_vr_video ? 'Yes' : 'No'} | 
                     <strong>Live:</strong> ${videoData.live_status === 0 ? 'VOD' : 'Live'}</div>
                <div><strong>⬇ Download:</strong> Select quality from download section</div>
            </div>
        `;
        this.videoInfo.innerHTML = html;
    }
    
    updateStatus(type, message) {
        const icons = { loading: '⏳', success: '✅', error: '❌' };
        this.statusIcon.textContent = icons[type] || 'ℹ️';
        this.statusDiv.textContent = message;
        
        const statusContainer = document.querySelector('.status');
        statusContainer.style.borderLeftColor = type === 'error' ? '#dc3545' : 
                                               type === 'success' ? '#28a745' : '#667eea';
    }
    
    handleShakaError(error) {
        this.log('Shaka Error:', error);
        let errorMessage = '';
        let errorCode = error.code || (error.detail ? error.detail.code : 'Unknown');
        
        switch(errorCode) {
            case 6001:
                errorMessage = 'Manifest request failed - Token may be invalid';
                break;
            case 6007:
                errorMessage = 'License request failed - Token expired';
                break;
            default:
                errorMessage = error.detail?.message || error.message || 'Unknown error';
        }
        
        this.updateStatus('error', `Error ${errorCode}: ${errorMessage}`);
    }
    
    handleError(error) {
        let errorMessage = error instanceof Error ? error.message : String(error);
        this.updateStatus('error', `Error: ${errorMessage}`);
        this.log('ERROR:', errorMessage);
    }
    
    log(...args) {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
        ).join(' ')}`;
        
        console.log(logMessage);
        
        const currentLog = this.debugLog.textContent;
        this.debugLog.textContent = currentLog + '\n' + logMessage;
        
        const lines = this.debugLog.textContent.split('\n');
        if (lines.length > 200) {
            this.debugLog.textContent = lines.slice(-200).join('\n');
        }
    }
    
    truncateUrl(url, maxLen = 60) {
        if (!url) return 'N/A';
        if (url.length <= maxLen) return url;
        return url.substring(0, maxLen - 20) + '...' + url.substring(url.length - 15);
    }
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    if (window.shaka) {
        window.drmPlayer = new DRMVideoPlayer();
    } else {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.13/shaka-player.compiled.js';
        script.onload = () => {
            window.drmPlayer = new DRMVideoPlayer();
        };
        script.onerror = () => {
            document.querySelector('.status-text').textContent = 'Failed to load Shaka Player';
        };
        document.head.appendChild(script);
    }
});

// Add animation keyframes
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeOut {
        0% { opacity: 1; }
        70% { opacity: 1; }
        100% { opacity: 0; visibility: hidden; }
    }
`;
document.head.appendChild(style);