// Main DRM Video Player with DRM support
class DRMVideoPlayer {
    constructor() {
        this.player = null;
        this.videoElement = document.getElementById('videoPlayer');
        this.apiUrlInput = document.getElementById('apiUrl');
        this.loadBtn = document.getElementById('loadBtn');
        this.playerContainer = document.getElementById('playerContainer');
        this.playerControlsBar = document.getElementById('playerControlsBar');
        this.statusDiv = document.querySelector('.status-text');
        this.statusIcon = document.querySelector('.status-icon');
        this.debugLog = document.getElementById('debugLog');
        this.videoInfo = document.getElementById('videoInfo');
        
        // EXACT LICENSE SERVER FROM ORIGINAL SITE
        this.licenseServerUrl = 'https://license.videocrypt.com/validateLicense';
        
        // Store current video info for download
        this.currentVideoUrl = null;
        this.currentVideoType = null;
        this.currentVideoTitle = 'video';
        
        this.init();
    }
    
    init() {
        this.initShakaPlayer();
        this.loadBtn.addEventListener('click', () => this.loadVideo());
        this.apiUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.loadVideo();
        });
        this.log('Player initialized. Ready to load video.');
        this.log(`License server: ${this.licenseServerUrl}`);
        
        // Initialize download button handler
        const downloadBtn = document.getElementById('downloadBtn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.handleDownload());
        }
        
        // Initialize speed selector
        const speedSelector = document.getElementById('speedSelector');
        if (speedSelector) {
            speedSelector.addEventListener('change', (e) => {
                const speed = parseFloat(e.target.value);
                if (this.videoElement) {
                    this.videoElement.playbackRate = speed;
                    this.log(`Playback speed changed to: ${speed}x`);
                    showNotification(`Speed: ${speed}x`, 'info');
                }
            });
        }
    }
    
    initShakaPlayer() {
        if (!this.videoElement) return;
        
        if (!window.shaka) {
            this.updateStatus('error', 'Shaka Player not loaded');
            return;
        }
        
        // Install polyfills
        if (window.shaka.polyfill) {
            window.shaka.polyfill.installAll();
            this.log('Shaka polyfills installed');
        }
        
        // Check browser support
        if (!window.shaka.Player.isBrowserSupported()) {
            this.updateStatus('error', 'Browser does not support DRM playback');
            return;
        }
        
        this.player = new window.shaka.Player(this.videoElement);
        
        // Configure DRM with license server
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
        
        // Error handler
        this.player.addEventListener('error', (event) => {
            this.handleShakaError(event.detail);
        });
        
        // Event listeners
        this.player.addEventListener('buffering', () => {
            this.log('Buffering...');
        });
        
        this.player.addEventListener('loading', () => {
            this.log('Loading...');
        });
        
        this.player.addEventListener('trackschanged', () => {
            this.updateQualitySelector();
        });
        
        this.log('Shaka Player initialized');
    }
    
    updateQualitySelector() {
        if (!this.player) return;
        const tracks = this.player.getVariantTracks();
        const qualitySelect = document.getElementById('qualitySelector');
        if (!qualitySelect) return;
        
        // Clear existing options except Auto
        qualitySelect.innerHTML = '<option value="auto">Auto</option>';
        
        if (tracks.length === 0) return;
        
        // Get unique heights
        const heights = [...new Set(tracks.map(t => t.height).filter(h => h))].sort((a,b) => a-b);
        
        heights.forEach(height => {
            const option = document.createElement('option');
            option.value = height;
            option.textContent = `${height}p`;
            qualitySelect.appendChild(option);
        });
        
        // Add quality change handler
        qualitySelect.onchange = () => {
            const selectedValue = qualitySelect.value;
            if (selectedValue === 'auto') {
                this.player.configure({ abr: { enabled: true } });
                this.log('Quality set to Auto');
                showNotification('Quality: Auto', 'info');
            } else {
                const targetHeight = parseInt(selectedValue);
                const track = tracks.find(t => t.height === targetHeight);
                if (track) {
                    this.player.configure({ abr: { enabled: false } });
                    this.player.selectVariantTrack(track);
                    this.log(`Quality set to: ${targetHeight}p`);
                    showNotification(`Quality: ${targetHeight}p`, 'info');
                }
            }
        };
        
        this.log(`Quality options: ${heights.join('p, ')}p`);
    }
    
    async loadVideo() {
        const inputUrl = this.apiUrlInput.value.trim();
        
        if (!inputUrl) {
            this.updateStatus('error', 'Please enter a URL');
            return;
        }
        
        this.updateStatus('loading', 'Loading video...');
        this.playerContainer.style.display = 'none';
        this.playerControlsBar.style.display = 'none';
        
        try {
            // Detect URL type
            const urlType = this.detectUrlType(inputUrl);
            this.log(`Detected URL type: ${urlType}`);
            
            if (urlType === 'api') {
                await this.loadFromApi(inputUrl);
            } else if (urlType === 'mpd') {
                await this.loadMpdDirect(inputUrl);
            } else if (urlType === 'm3u8') {
                await this.loadM3u8(inputUrl);
            } else if (urlType === 'mp4') {
                await this.loadMp4(inputUrl);
            } else if (urlType === 'youtube') {
                await this.loadYouTube(inputUrl);
            } else {
                throw new Error('Unsupported URL format');
            }
            
        } catch (error) {
            this.handleError(error);
        }
    }
    
    detectUrlType(url) {
        url = url.toLowerCase();
        
        // Check for API pattern (contains /api/ or proxy)
        if (url.includes('/api/') || url.includes('bypass') || url.includes('get_video_details')) {
            return 'api';
        }
        
        // Check for YouTube
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            return 'youtube';
        }
        
        // Check for MPD
        if (url.includes('.mpd') || url.includes('manifest')) {
            return 'mpd';
        }
        
        // Check for M3U8
        if (url.includes('.m3u8') || url.includes('hls')) {
            return 'm3u8';
        }
        
        // Check for MP4
        if (url.includes('.mp4') || url.includes('.mkv') || url.includes('.webm')) {
            return 'mp4';
        }
        
        return 'unknown';
    }
    
    async loadFromApi(apiUrl) {
        this.updateStatus('loading', 'Fetching video details from API...');
        
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        this.log('API Response:', data);
        
        if (!data.status || !data.data || !data.data.link) {
            throw new Error('Invalid API response format');
        }
        
        const videoData = data.data.link;
        const mpdUrl = videoData.file_url;
        const token = videoData.token;
        
        if (!mpdUrl) {
            throw new Error('No MPD URL found in response');
        }
        
        this.log(`MPD URL: ${mpdUrl}`);
        this.log(`Token: ${token.substring(0, 50)}...`);
        
        // Store for download
        this.currentVideoUrl = mpdUrl;
        this.currentVideoType = 'mpd';
        this.currentVideoTitle = videoData.title || 'drm_video';
        
        this.updateVideoInfo(videoData);
        await this.playMpdWithToken(mpdUrl, token);
    }
    
    async loadMpdDirect(mpdUrl) {
        this.currentVideoUrl = mpdUrl;
        this.currentVideoType = 'mpd';
        this.currentVideoTitle = 'direct_mpd_video';
        await this.playMpdWithToken(mpdUrl, null);
    }
    
    async playMpdWithToken(mpdUrl, token) {
        this.updateStatus('loading', 'Loading DRM video...');
        
        try {
            if (!this.player) {
                this.initShakaPlayer();
            }
            
            const netEngine = this.player.getNetworkingEngine();
            netEngine.clearAllRequestFilters();
            
            if (token) {
                // EXACT REQUEST FILTER FROM ORIGINAL SITE
                netEngine.registerRequestFilter((type, request) => {
                    if (type === window.shaka.net.NetworkingEngine.RequestType.LICENSE) {
                        this.log('🔐 Adding token to license request');
                        request.headers['pallycon-customdata-v2'] = token;
                        request.headers['Origin'] = window.location.origin;
                        request.headers['X-Requested-With'] = 'XMLHttpRequest';
                    }
                });
            }
            
            // Load MPD with token in URL if present
            let urlWithToken = mpdUrl;
            if (token) {
                urlWithToken = `${mpdUrl}${mpdUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
            }
            this.log(`Loading MPD: ${urlWithToken}`);
            
            await this.player.load(urlWithToken);
            
            this.playerContainer.style.display = 'block';
            this.playerControlsBar.style.display = 'flex';
            this.updateStatus('success', 'Video loaded! Playing...');
            
            // Update quality selector after load
            setTimeout(() => this.updateQualitySelector(), 1000);
            
            // Auto-play
            this.videoElement.play().catch(e => {
                this.log('Auto-play blocked, user must click play');
                showNotification('Click play to start video', 'info');
            });
            
        } catch (error) {
            this.log('Failed to load MPD:', error);
            throw error;
        }
    }
    
    async loadM3u8(url) {
        this.updateStatus('loading', 'Loading HLS stream...');
        this.currentVideoUrl = url;
        this.currentVideoType = 'm3u8';
        this.currentVideoTitle = 'hls_video';
        
        this.playerContainer.style.display = 'block';
        this.playerControlsBar.style.display = 'flex';
        
        // Use Hls.js for M3U8
        if (Hls.isSupported()) {
            const hls = new Hls();
            hls.loadSource(url);
            hls.attachMedia(this.videoElement);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                this.log('HLS manifest parsed');
                this.updateStatus('success', 'HLS stream loaded');
                this.videoElement.play().catch(e => this.log('Auto-play blocked'));
                
                // Populate quality options for HLS
                const levels = hls.levels;
                const qualitySelect = document.getElementById('qualitySelector');
                if (qualitySelect && levels.length > 0) {
                    qualitySelect.innerHTML = '<option value="auto">Auto</option>';
                    levels.forEach((level, idx) => {
                        const option = document.createElement('option');
                        option.value = idx;
                        option.textContent = `${level.height}p`;
                        qualitySelect.appendChild(option);
                    });
                    qualitySelect.onchange = () => {
                        const selected = qualitySelect.value;
                        if (selected === 'auto') {
                            hls.currentLevel = -1;
                        } else {
                            hls.currentLevel = parseInt(selected);
                        }
                    };
                }
            });
            hls.on(Hls.Events.ERROR, (event, data) => {
                this.log('HLS Error:', data);
            });
            window.currentHls = hls;
        } else if (this.videoElement.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari)
            this.videoElement.src = url;
            this.videoElement.addEventListener('loadedmetadata', () => {
                this.updateStatus('success', 'HLS stream loaded');
                this.videoElement.play().catch(e => this.log('Auto-play blocked'));
            });
        } else {
            throw new Error('HLS not supported in this browser');
        }
        
        this.updateVideoInfo({ file_url: url, type: 'HLS Stream' });
    }
    
    async loadMp4(url) {
        this.updateStatus('loading', 'Loading MP4 video...');
        this.currentVideoUrl = url;
        this.currentVideoType = 'mp4';
        this.currentVideoTitle = this.extractFilename(url) || 'video';
        
        this.playerContainer.style.display = 'block';
        this.playerControlsBar.style.display = 'flex';
        
        this.videoElement.src = url;
        this.videoElement.addEventListener('loadedmetadata', () => {
            this.updateStatus('success', 'MP4 video loaded');
            this.log(`Video duration: ${this.videoElement.duration}s`);
            this.videoElement.play().catch(e => this.log('Auto-play blocked'));
            
            // MP4 quality selector (only one quality usually)
            const qualitySelect = document.getElementById('qualitySelector');
            if (qualitySelect) {
                qualitySelect.innerHTML = '<option value="auto">Auto (Source)</option>';
            }
        });
        
        this.updateVideoInfo({ file_url: url, type: 'MP4 Video' });
    }
    
    async loadYouTube(url) {
        this.updateStatus('loading', 'Loading YouTube video...');
        this.currentVideoUrl = url;
        this.currentVideoType = 'youtube';
        this.currentVideoTitle = 'youtube_video';
        
        this.playerContainer.style.display = 'block';
        this.playerControlsBar.style.display = 'flex';
        
        // Extract video ID
        let videoId = '';
        const patterns = [
            /(?:youtube\.com\/watch\?v=)([^&]+)/,
            /(?:youtu\.be\/)([^?]+)/,
            /(?:youtube\.com\/embed\/)([^?]+)/
        ];
        
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                videoId = match[1];
                break;
            }
        }
        
        if (!videoId) {
            throw new Error('Invalid YouTube URL');
        }
        
        // Use YouTube embed with iframe API or simple embed
        const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=0&controls=1`;
        
        // Replace video element with iframe for YouTube
        const wrapper = document.querySelector('.video-wrapper');
        const oldVideo = this.videoElement;
        const iframe = document.createElement('iframe');
        iframe.id = 'youtubeIframe';
        iframe.width = '100%';
        iframe.height = '400px';
        iframe.src = embedUrl;
        iframe.frameBorder = '0';
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        iframe.allowFullscreen = true;
        
        oldVideo.style.display = 'none';
        wrapper.appendChild(iframe);
        
        this.updateStatus('success', 'YouTube video loaded');
        this.log(`YouTube Video ID: ${videoId}`);
        
        this.updateVideoInfo({ file_url: url, type: 'YouTube Video', video_id: videoId });
        
        // Disable download for YouTube (copyright)
        const downloadBtn = document.getElementById('downloadBtn');
        if (downloadBtn) {
            downloadBtn.disabled = true;
            downloadBtn.title = 'YouTube download not available due to copyright';
        }
    }
    
    handleDownload() {
        if (this.currentVideoType === 'youtube') {
            showNotification('YouTube download not supported due to copyright restrictions', 'error');
            return;
        }
        
        if (this.currentVideoUrl && this.currentVideoType) {
            this.log('Starting download for:', this.currentVideoUrl);
            downloadVideo(this.currentVideoUrl, this.currentVideoType, this.currentVideoTitle);
        } else {
            showNotification('No video loaded to download', 'error');
        }
    }
    
    updateVideoInfo(videoData) {
        let html = `
            <div style="display: grid; gap: 8px;">
                <div><strong>🎬 Video URL:</strong><br>${this.truncateUrl(videoData.file_url || videoData.url || this.currentVideoUrl, 80)}</div>
                <div><strong>🔑 License Server:</strong><br>${this.licenseServerUrl}</div>
                <div><strong>📺 Type:</strong> ${videoData.type || this.currentVideoType || 'DRM MPD'}</div>
            </div>
        `;
        
        if (videoData.token) {
            html += `<div><strong>🆔 Token:</strong><br>${videoData.token.substring(0, 60)}...</div>`;
        }
        
        if (videoData.ad_enable !== undefined) {
            html += `<div><strong>📺 Ads:</strong> ${videoData.ad_enable ? 'Yes' : 'No'} | 
                     <strong>VR:</strong> ${videoData.is_vr_video ? 'Yes' : 'No'} | 
                     <strong>Live:</strong> ${videoData.live_status === 0 ? 'VOD' : 'Live'}</div>`;
        }
        
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
            case 6007:
                errorMessage = 'License request failed - Token may be expired or invalid';
                break;
            case 6012:
                errorMessage = 'License server not configured';
                break;
            case 1002:
                errorMessage = 'Network error - Check CORS or server availability';
                break;
            default:
                errorMessage = error.detail?.message || error.message || 'Unknown error';
        }
        
        this.updateStatus('error', `Error ${errorCode}: ${errorMessage}`);
        showNotification(`Playback error: ${errorMessage}`, 'error');
    }
    
    handleError(error) {
        console.error('Error:', error);
        let errorMessage = error instanceof Error ? error.message : String(error);
        this.updateStatus('error', `Error: ${errorMessage}`);
        this.log('ERROR:', errorMessage);
        showNotification(`Error: ${errorMessage}`, 'error');
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
        if (lines.length > 150) {
            this.debugLog.textContent = lines.slice(-150).join('\n');
        }
    }
    
    truncateUrl(url, maxLen = 60) {
        if (!url) return 'N/A';
        if (url.length <= maxLen) return url;
        return url.substring(0, maxLen - 20) + '...' + url.substring(url.length - 15);
    }
    
    extractFilename(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const filename = pathname.split('/').pop();
            return filename.replace(/\.[^/.]+$/, '') || 'video';
        } catch {
            return 'video';
        }
    }
}

// Initialize when DOM ready
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