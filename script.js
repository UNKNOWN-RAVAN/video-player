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
        
        // License server URL — TU NE JO DIYA
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
        this.log(`License server configured: ${this.licenseServerUrl}`);
    }
    
    initShakaPlayer() {
        if (!this.videoElement) return;
        
        if (!window.shaka) {
            this.updateStatus('error', 'Shaka Player not loaded');
            return;
        }
        
        this.player = new shaka.Player(this.videoElement);
        
        // IMPORTANT: Configure DRM with license server
        this.player.configure({
            drm: {
                servers: {
                    'com.widevine.alpha': this.licenseServerUrl
                },
                retryParameters: {
                    maxAttempts: 5,
                    baseDelay: 1000,
                    backoffFactor: 2
                },
                // Custom headers for license request
                headers: {
                    'Content-Type': 'application/octet-stream'
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
            manifest: {
                dash: {
                    ignoreMinBufferTime: false,
                    defaultPresentationDelay: 0
                }
            }
        });
        
        // Error handler
        this.player.addEventListener('error', (event) => {
            this.handleShakaError(event.detail);
        });
        
        // Event listeners for debugging
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
                this.log(`Quality: ${tracks[0].height}p`);
            }
        });
        
        // Monitor network requests
        const netEngine = this.player.getNetworkingEngine();
        if (netEngine) {
            netEngine.registerRequestFilter((type, request) => {
                if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
                    this.log('🔐 License request to:', request.uris[0]);
                    this.log('License headers:', request.headers);
                }
            });
            
            netEngine.registerResponseFilter((type, response) => {
                if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
                    this.log('✅ License response received');
                    if (response.data) {
                        this.log(`Response size: ${response.data.byteLength} bytes`);
                    }
                }
            });
        }
        
        this.log('Shaka Player initialized with license server');
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
        this.updateStatus('loading', 'Loading video stream...');
        
        try {
            // Configure networking to add token to license requests
            const netEngine = this.player.getNetworkingEngine();
            
            // Clear previous filters
            netEngine.clearAllRequestFilters();
            
            // Add new filter for token
            netEngine.registerRequestFilter((type, request) => {
                // Add token to all requests
                request.headers['Authorization'] = `Bearer ${token}`;
                request.headers['X-Token'] = token;
                
                // Special handling for license requests
                if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
                    this.log('🔑 Adding token to license request');
                    
                    // Try to add token to body if it's JSON
                    if (request.body && request.body.byteLength) {
                        try {
                            const decoder = new TextDecoder('utf-8');
                            const bodyStr = decoder.decode(request.body);
                            
                            // Check if body is JSON
                            if (bodyStr.trim().startsWith('{')) {
                                const bodyJson = JSON.parse(bodyStr);
                                bodyJson.token = token;
                                request.body = new TextEncoder().encode(JSON.stringify(bodyJson));
                                this.log('Added token to license request body');
                            } else {
                                // Append token to existing body
                                const newBody = bodyStr + (bodyStr.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
                                request.body = new TextEncoder().encode(newBody);
                                this.log('Appended token to license request body');
                            }
                        } catch(e) {
                            this.log('Could not modify license body:', e.message);
                        }
                    }
                }
            });
            
            // Construct MPD URL with token
            const urlWithToken = `${mpdUrl}${mpdUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
            this.log(`Loading MPD: ${urlWithToken.substring(0, 200)}...`);
            
            // Load the video
            await this.player.load(urlWithToken);
            
            // Show player
            this.playerContainer.style.display = 'block';
            this.updateStatus('success', 'Video loaded! Playing...');
            
            // Auto-play
            this.videoElement.play().catch(e => {
                this.log('Auto-play blocked, click play button');
            });
            
        } catch (error) {
            this.log('Failed with URL token, trying without...');
            
            try {
                // Try without token in URL
                await this.player.load(mpdUrl);
                this.playerContainer.style.display = 'block';
                this.updateStatus('success', 'Video loaded!');
            } catch (altError) {
                throw new Error(`Failed to load video: ${altError.message}`);
            }
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
                errorMessage = 'License server error - Check token validity';
                this.log('💡 Token might be expired or invalid');
                break;
            case 6010:
                errorMessage = 'DRM session error';
                break;
            case 6012:
                errorMessage = 'License server not configured - Check if license URL is correct';
                this.log(`💡 Current license server: ${this.licenseServerUrl}`);
                this.log('💡 Make sure this URL is accessible');
                break;
            default:
                errorMessage = error.detail?.message || error.message || 'Unknown error';
        }
        
        this.updateStatus('error', `Error ${errorCode}: ${errorMessage}`);
        
        if (errorCode === 6012) {
            this.log('\n🔧 FIXES:');
            this.log('1. License server URL might be wrong');
            this.log('2. Try: https://license.videocrypt.com/validateLicense');
            this.log('3. Check if token includes license server info');
            this.log('4. Some videos need different license server');
        }
    }
    
    updateVideoInfo(videoData) {
        let html = `
            <div style="display: grid; gap: 8px;">
                <div><strong>🎬 MPD URL:</strong><br>${this.truncateUrl(videoData.file_url, 80)}</div>
                <div><strong>🔑 License Server:</strong><br>${this.licenseServerUrl}</div>
                <div><strong>🆔 Token:</strong><br>${videoData.token.substring(0, 40)}...</div>
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
    window.drmPlayer = new DRMVideoPlayer();
});