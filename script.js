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
        
        // Install polyfills (IMPORTANT!)
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
        
        // EXACT DRM CONFIGURATION FROM ORIGINAL SITE
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
            },
            abr: {
                enabled: true,
                defaultBandwidthEstimate: 1e6
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
            // Fetch video details
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
            
            // Update video info
            this.updateVideoInfo(videoData);
            
            // Play video with token
            await this.playVideo(mpdUrl, token);
            
        } catch (error) {
            this.handleError(error);
        }
    }
    
    async playVideo(mpdUrl, token) {
        this.updateStatus('loading', 'Loading DRM video...');
        
        try {
            // IMPORTANT: Add token to license requests (EXACTLY LIKE ORIGINAL SITE)
            const netEngine = this.player.getNetworkingEngine();
            
            // Clear previous filters
            netEngine.clearAllRequestFilters();
            
            // Register request filter for license requests
            netEngine.registerRequestFilter((type, request) => {
                // THIS IS THE KEY — original site uses this header
                if (type === window.shaka.net.NetworkingEngine.RequestType.LICENSE) {
                    this.log('🔐 Adding token to license request');
                    // EXACT header from original site
                    request.headers['pallycon-customdata-v2'] = token;
                    // Additional headers for compatibility
                    request.headers['Authorization'] = `Bearer ${token}`;
                    request.headers['X-Token'] = token;
                }
            });
            
            // Try to load with token in URL
            const urlWithToken = `${mpdUrl}${mpdUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
            this.log(`Loading MPD with token...`);
            
            // Load the video
            await this.player.load(urlWithToken);
            
            // Show player
            this.playerContainer.style.display = 'block';
            this.updateStatus('success', 'Video loaded! Playing...');
            
            // Auto-play with mute fallback
            this.videoElement.play().catch(e => {
                this.log('Auto-play blocked, trying muted...');
                this.videoElement.muted = true;
                this.videoElement.play().catch(err => {
                    this.log('Auto-play failed, click play button');
                });
            });
            
            // Track playback
            this.videoElement.addEventListener('playing', () => {
                this.updateStatus('success', 'Video playing');
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
            case 1000:
                errorMessage = 'Network error - Check connection';
                break;
            case 1001:
                errorMessage = 'MPD file not accessible';
                break;
            case 1002:
                errorMessage = 'Invalid MPD format';
                break;
            case 2000:
            case 6007:
                errorMessage = 'License request failed - Token may be expired';
                this.log('💡 Check if token is valid');
                break;
            case 6012:
                errorMessage = 'License server not configured';
                this.log(`💡 License server: ${this.licenseServerUrl}`);
                break;
            case 6010:
                errorMessage = 'DRM session error - Missing PSSH';
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
                <div><strong>🆔 Token:</strong><br>${videoData.token.substring(0, 50)}...</div>
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

// Wait for Shaka Player to load
window.addEventListener('DOMContentLoaded', () => {
    // Check if Shaka is loaded
    if (window.shaka) {
        window.drmPlayer = new DRMVideoPlayer();
    } else {
        // Load Shaka Player dynamically
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