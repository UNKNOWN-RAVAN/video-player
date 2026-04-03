class DRMVideoPlayer {
    constructor() {
        this.player = null;
        this.hlsPlayer = null; // For HLS.js
        this.videoElement = document.getElementById('videoPlayer');
        this.apiUrlInput = document.getElementById('apiUrl');
        this.loadBtn = document.getElementById('loadBtn');
        this.playerContainer = document.getElementById('playerContainer');
        this.statusDiv = document.querySelector('.status-text');
        this.statusIcon = document.querySelector('.status-icon');
        this.debugLog = document.getElementById('debugLog');
        this.videoInfo = document.getElementById('videoInfo');
        
        // EXACT LICENSE SERVER FROM ORIGINAL SITE
        this.licenseServerUrl = 'https://license.videocrypt.com/validateLicense';
        
        this.init();
    }
    
    init() {
        this.initShakaPlayer();
        this.initHLSPlayer();
        this.loadBtn.addEventListener('click', () => this.loadVideo());
        this.apiUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.loadVideo();
        });
        this.log('Player initialized. Ready to load video.');
        this.log(`License server: ${this.licenseServerUrl}`);
    }
    
    initShakaPlayer() {
        if (!this.videoElement) return;
        
        if (!window.shaka) {
            this.log('Shaka Player not loaded yet');
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
            const tracks = this.player.getVariantTracks();
            this.log(`Tracks available: ${tracks.length}`);
            if (tracks.length > 0) {
                const heights = [...new Set(tracks.map(t => t.height))].sort((a,b)=>b-a);
                this.log(`Qualities available: ${heights.join('p, ')}p`);
            }
        });
        
        this.log('Shaka Player initialized');
    }
    
    initHLSPlayer() {
        // Check if HLS.js is available
        if (window.Hls && window.Hls.isSupported()) {
            this.hlsPlayer = new window.Hls();
            this.log('HLS.js initialized for M3U8 support');
        } else {
            this.log('HLS.js not loaded, M3U8 support limited');
        }
    }
    
    async loadVideo() {
        const apiUrl = this.apiUrlInput.value.trim();
        
        if (!apiUrl) {
            this.updateStatus('error', 'Please enter an API URL or direct video URL');
            return;
        }
        
        // Check if it's a direct video URL (M3U8, YouTube, MP4, etc.)
        if (this.isDirectVideoUrl(apiUrl)) {
            await this.loadDirectVideo(apiUrl);
            return;
        }
        
        this.updateStatus('loading', 'Fetching video details...');
        this.playerContainer.style.display = 'none';
        
        try {
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
            
            this.updateVideoInfo(videoData);
            await this.playVideo(mpdUrl, token);
            
        } catch (error) {
            this.handleError(error);
        }
    }
    
    isDirectVideoUrl(url) {
        // Check for YouTube URLs
        const youtubePatterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
            /youtube\.com\/embed\/[^&\n?#]+/,
            /youtube\.com\/shorts\/[^&\n?#]+/
        ];
        
        for (let pattern of youtubePatterns) {
            if (pattern.test(url)) {
                return true;
            }
        }
        
        // Check for M3U8 URLs
        if (url.toLowerCase().includes('.m3u8')) {
            return true;
        }
        
        // Check for other video formats
        const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.mkv'];
        if (videoExtensions.some(ext => url.toLowerCase().includes(ext))) {
            return true;
        }
        
        return false;
    }
    
    async loadDirectVideo(url) {
        this.playerContainer.style.display = 'block';
        
        // Handle YouTube URLs
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            await this.loadYouTubeVideo(url);
            return;
        }
        
        // Handle M3U8 URLs
        if (url.toLowerCase().includes('.m3u8')) {
            await this.loadM3U8Video(url);
            return;
        }
        
        // Handle direct MP4 and other formats
        await this.loadDirectMedia(url);
    }
    
    async loadYouTubeVideo(url) {
        this.updateStatus('loading', 'Loading YouTube video...');
        this.log(`YouTube URL: ${url}`);
        
        // Extract video ID
        let videoId = null;
        const patterns = [
            /(?:youtube\.com\/watch\?v=)([^&\n?#]+)/,
            /(?:youtu\.be\/)([^&\n?#]+)/,
            /(?:youtube\.com\/embed\/)([^&\n?#]+)/,
            /(?:youtube\.com\/shorts\/)([^&\n?#]+)/
        ];
        
        for (let pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                videoId = match[1];
                break;
            }
        }
        
        if (!videoId) {
            throw new Error('Could not extract YouTube video ID');
        }
        
        this.log(`YouTube Video ID: ${videoId}`);
        
        // Check if YouTube IFrame API is loaded
        if (!window.YT) {
            await this.loadYouTubeAPI();
        }
        
        // Create or get YouTube player container
        let youtubeContainer = document.getElementById('youtubePlayer');
        if (!youtubeContainer) {
            youtubeContainer = document.createElement('div');
            youtubeContainer.id = 'youtubePlayer';
            youtubeContainer.style.width = '100%';
            youtubeContainer.style.height = '100%';
            this.videoElement.style.display = 'none';
            this.playerContainer.appendChild(youtubeContainer);
        } else {
            youtubeContainer.style.display = 'block';
            this.videoElement.style.display = 'none';
        }
        
        // Destroy existing YouTube player if any
        if (this.youtubePlayer) {
            this.youtubePlayer.destroy();
        }
        
        // Create new YouTube player
        this.youtubePlayer = new YT.Player('youtubePlayer', {
            videoId: videoId,
            playerVars: {
                'autoplay': 1,
                'controls': 1,
                'rel': 0,
                'modestbranding': 1
            },
            events: {
                'onReady': (event) => {
                    this.updateStatus('success', 'YouTube video loaded! Playing...');
                    this.log('YouTube player ready');
                    event.target.playVideo();
                },
                'onStateChange': (event) => {
                    this.log(`YouTube player state: ${event.data}`);
                    if (event.data === YT.PlayerState.ENDED) {
                        this.log('YouTube video ended');
                    } else if (event.data === YT.PlayerState.PLAYING) {
                        this.updateStatus('success', 'Playing YouTube video');
                    } else if (event.data === YT.PlayerState.PAUSED) {
                        this.updateStatus('success', 'YouTube video paused');
                    } else if (event.data === YT.PlayerState.BUFFERING) {
                        this.updateStatus('loading', 'Buffering...');
                    }
                },
                'onError': (event) => {
                    this.log('YouTube error:', event.data);
                    this.updateStatus('error', `YouTube error: ${event.data}`);
                }
            }
        });
        
        // Update video info
        this.videoInfo.innerHTML = `
            <div style="display: grid; gap: 8px;">
                <div><strong>🎬 YouTube Video:</strong><br>${videoId}</div>
                <div><strong>🔗 URL:</strong><br>${this.truncateUrl(url, 80)}</div>
                <div><strong>📺 Type:</strong> YouTube</div>
            </div>
        `;
    }
    
    async loadM3U8Video(url) {
        this.updateStatus('loading', 'Loading M3U8 stream...');
        this.log(`M3U8 URL: ${url}`);
        
        // Show video element, hide any YouTube container
        this.videoElement.style.display = 'block';
        const youtubeContainer = document.getElementById('youtubePlayer');
        if (youtubeContainer) {
            youtubeContainer.style.display = 'none';
        }
        
        // Destroy existing HLS player
        if (this.hlsPlayer) {
            this.hlsPlayer.destroy();
        }
        
        // Check if HLS.js is supported
        if (window.Hls && window.Hls.isSupported()) {
            this.hlsPlayer = new window.Hls({
                debug: false,
                enableWorker: true,
                lowLatencyMode: true
            });
            
            this.hlsPlayer.loadSource(url);
            this.hlsPlayer.attachMedia(this.videoElement);
            
            this.hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED, () => {
                this.updateStatus('success', 'M3U8 stream loaded! Playing...');
                this.log('M3U8 manifest parsed, attempting to play');
                this.videoElement.play().catch(e => {
                    this.log('Auto-play blocked:', e);
                    this.updateStatus('success', 'Click play to start');
                });
            });
            
            this.hlsPlayer.on(window.Hls.Events.ERROR, (event, data) => {
                this.log('HLS Error:', data);
                if (data.fatal) {
                    this.updateStatus('error', `M3U8 error: ${data.type}`);
                    switch(data.type) {
                        case window.Hls.ErrorTypes.NETWORK_ERROR:
                            this.log('Network error, trying to recover...');
                            this.hlsPlayer.startLoad();
                            break;
                        case window.Hls.ErrorTypes.MEDIA_ERROR:
                            this.log('Media error, recovering...');
                            this.hlsPlayer.recoverMediaError();
                            break;
                        default:
                            this.updateStatus('error', 'Cannot play M3U8 stream');
                            break;
                    }
                }
            });
            
        } else if (this.videoElement.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari)
            this.videoElement.src = url;
            this.videoElement.addEventListener('loadedmetadata', () => {
                this.updateStatus('success', 'M3U8 stream loaded! Playing...');
                this.videoElement.play().catch(e => this.log('Auto-play blocked:', e));
            });
        } else {
            throw new Error('HLS not supported in this browser');
        }
        
        // Update video info
        this.videoInfo.innerHTML = `
            <div style="display: grid; gap: 8px;">
                <div><strong>🎬 M3U8 Stream:</strong><br>${this.truncateUrl(url, 80)}</div>
                <div><strong>📺 Type:</strong> HLS / M3U8</div>
                <div><strong>🔧 Player:</strong> ${window.Hls ? 'HLS.js' : 'Native'}</div>
            </div>
        `;
    }
    
    async loadDirectMedia(url) {
        this.updateStatus('loading', 'Loading video...');
        this.log(`Direct media URL: ${url}`);
        
        // Show video element, hide YouTube container
        this.videoElement.style.display = 'block';
        const youtubeContainer = document.getElementById('youtubePlayer');
        if (youtubeContainer) {
            youtubeContainer.style.display = 'none';
        }
        
        // Destroy HLS player if exists
        if (this.hlsPlayer) {
            this.hlsPlayer.destroy();
            this.hlsPlayer = null;
        }
        
        // Set video source
        this.videoElement.src = url;
        
        // Wait for metadata to load
        this.videoElement.addEventListener('loadedmetadata', () => {
            this.updateStatus('success', 'Video loaded! Playing...');
            this.log(`Duration: ${this.videoElement.duration}s`);
            this.videoElement.play().catch(e => {
                this.log('Auto-play blocked:', e);
                this.updateStatus('success', 'Click play to start');
            });
        });
        
        this.videoElement.addEventListener('error', (e) => {
            this.log('Video error:', e);
            this.updateStatus('error', 'Failed to load video');
        });
        
        // Update video info
        this.videoInfo.innerHTML = `
            <div style="display: grid; gap: 8px;">
                <div><strong>🎬 Direct Video:</strong><br>${this.truncateUrl(url, 80)}</div>
                <div><strong>📺 Type:</strong> Direct Stream</div>
            </div>
        `;
    }
    
    loadYouTubeAPI() {
        return new Promise((resolve, reject) => {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
            
            window.onYouTubeIframeAPIReady = () => {
                this.log('YouTube API loaded');
                resolve();
            };
            
            setTimeout(() => {
                if (!window.YT) {
                    reject(new Error('YouTube API load timeout'));
                }
            }, 5000);
        });
    }
    
    async playVideo(mpdUrl, token) {
        this.updateStatus('loading', 'Loading DRM video...');
        
        // Show video element, hide YouTube container
        this.videoElement.style.display = 'block';
        const youtubeContainer = document.getElementById('youtubePlayer');
        if (youtubeContainer) {
            youtubeContainer.style.display = 'none';
        }
        
        try {
            const netEngine = this.player.getNetworkingEngine();
            netEngine.clearAllRequestFilters();
            
            // EXACT REQUEST FILTER FROM ORIGINAL SITE
            netEngine.registerRequestFilter((type, request) => {
                if (type === window.shaka.net.NetworkingEngine.RequestType.LICENSE) {
                    this.log('🔐 Adding token to license request');
                    this.log('License URL:', request.uris[0]);
                    
                    // EXACT HEADER from original site
                    request.headers['pallycon-customdata-v2'] = token;
                    
                    // Additional headers for CORS (matches original)
                    request.headers['Origin'] = window.location.origin;
                    request.headers['X-Requested-With'] = 'XMLHttpRequest';
                    
                    // Log the request for debugging
                    this.log('Headers set:', Object.keys(request.headers));
                }
            });
            
            // Load MPD with token in URL
            const urlWithToken = `${mpdUrl}${mpdUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
            this.log(`Loading MPD...`);
            
            await this.player.load(urlWithToken);
            
            this.playerContainer.style.display = 'block';
            this.updateStatus('success', 'Video loaded! Playing...');
            
            // Auto-play
            this.videoElement.play().catch(e => {
                this.log('Auto-play blocked, trying muted...');
                this.videoElement.muted = true;
                this.videoElement.play().catch(err => {
                    this.log('Auto-play failed, click play button');
                });
            });
            
        } catch (error) {
            this.log('Failed to load video:', error);
            this.updateStatus('error', `Failed: ${error.message}`);
            throw error;
        }
    }
    
    handleShakaError(error) {
        this.log('Shaka Error:', error);
        
        let errorMessage = '';
        let errorCode = error.code || (error.detail ? error.detail.code : 'Unknown');
        
        switch(errorCode) {
            case 6007:
                errorMessage = 'License request failed - Token may be expired or invalid';
                this.log('💡 Check if token is valid');
                this.log('💡 Verify license server is accessible: ' + this.licenseServerUrl);
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
    
    handleError(error) {
        console.error('Error:', error);
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
        if (lines.length > 150) {
            this.debugLog.textContent = lines.slice(-150).join('\n');
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
    
    // Load HLS.js for M3U8 support
    if (!window.Hls) {
        const hlsScript = document.createElement('script');
        hlsScript.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
        hlsScript.onload = () => {
            if (window.drmPlayer) {
                window.drmPlayer.initHLSPlayer();
            }
        };
        document.head.appendChild(hlsScript);
    }
});