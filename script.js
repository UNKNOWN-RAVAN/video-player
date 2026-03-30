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
        
        // EXACT LICENSE SERVER FROM ORIGINAL SITE
        this.licenseServerUrl = 'https://license.videocrypt.com/validateLicense';
        
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
            const tracks = this.player.getVariantTracks();
            this.log(`Tracks available: ${tracks.length}`);
            if (tracks.length > 0) {
                const heights = [...new Set(tracks.map(t => t.height))].sort((a,b)=>b-a);
                this.log(`Qualities available: ${heights.join('p, ')}p`);
            }
        });
        
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
    
    async playVideo(mpdUrl, token) {
        this.updateStatus('loading', 'Loading DRM video...');
        
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
});