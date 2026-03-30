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
        
        this.init();
    }
    
    init() {
        // Initialize Shaka Player
        this.initShakaPlayer();
        
        // Add event listeners
        this.loadBtn.addEventListener('click', () => this.loadVideo());
        
        // Add enter key support
        this.apiUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.loadVideo();
        });
        
        this.log('Player initialized. Ready to load video.');
    }
    
    initShakaPlayer() {
        if (!this.videoElement) return;
        
        // Check if browser supports DRM
        if (!window.shaka) {
            this.updateStatus('error', 'Shaka Player not loaded');
            return;
        }
        
        this.player = new shaka.Player(this.videoElement);
        
        // Configure DRM settings
        this.player.configure({
            drm: {
                servers: {
                    'com.widevine.alpha': 'https://widevine-proxy.appspot.com/proxy' // Default, will be updated from MPD
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
        
        // Add error handler
        this.player.addEventListener('error', (event) => {
            this.handleError(event.detail);
        });
        
        // Add event listeners for debugging
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
        
        this.log('Shaka Player initialized successfully');
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
            
            // Load video with token
            await this.playVideo(mpdUrl, token);
            
        } catch (error) {
            this.handleError(error);
        }
    }
    
    async playVideo(mpdUrl, token) {
        this.updateStatus('loading', 'Loading video stream...');
        
        try {
            // Construct URL with token
            const urlWithToken = `${mpdUrl}${mpdUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
            
            this.log(`Loading MPD with token: ${urlWithToken}`);
            
            // Load the video
            await this.player.load(urlWithToken);
            
            // Show player container
            this.playerContainer.style.display = 'block';
            
            this.updateStatus('success', 'Video loaded successfully! Playing...');
            
            // Auto-play if possible
            this.videoElement.play().catch(e => {
                this.log('Auto-play failed, user interaction needed');
            });
            
        } catch (error) {
            // Try alternative method - some servers need token in headers
            this.log('Trying alternative loading method...');
            
            try {
                // Configure with custom headers for token
                this.player.configure({
                    networking: {
                        beforeRequestHeaders: (headers, requestType) => {
                            if (requestType === shaka.net.NetworkingEngine.RequestType.LICENSE) {
                                headers['Authorization'] = `Bearer ${token}`;
                            }
                            return headers;
                        }
                    }
                });
                
                await this.player.load(mpdUrl);
                this.playerContainer.style.display = 'block';
                this.updateStatus('success', 'Video loaded with header auth!');
                
            } catch (altError) {
                throw new Error(`Failed to load video: ${altError.message}`);
            }
        }
    }
    
    updateVideoInfo(videoData) {
        const info = {
            'File URL': videoData.file_url ? this.truncateUrl(videoData.file_url) : 'N/A',
            'Token': videoData.token ? `${videoData.token.substring(0, 30)}...` : 'N/A',
            'Ads Enabled': videoData.ad_enable ? 'Yes' : 'No',
            'VR Video': videoData.is_vr_video ? 'Yes' : 'No',
            'Live Status': videoData.live_status === 0 ? 'VOD' : 'Live'
        };
        
        let html = '<div style="display: grid; gap: 5px;">';
        for (const [key, value] of Object.entries(info)) {
            html += `<div><strong>${key}:</strong> ${value}</div>`;
        }
        html += '</div>';
        
        this.videoInfo.innerHTML = html;
    }
    
    updateStatus(type, message) {
        const icons = {
            loading: '⏳',
            success: '✅',
            error: '❌'
        };
        
        this.statusIcon.textContent = icons[type] || 'ℹ️';
        this.statusDiv.textContent = message;
        
        // Update status color
        const statusContainer = document.querySelector('.status');
        statusContainer.style.borderLeftColor = type === 'error' ? '#dc3545' : 
                                               type === 'success' ? '#28a745' : '#667eea';
    }
    
    handleError(error) {
        console.error('Error:', error);
        
        let errorMessage = 'Unknown error';
        
        if (error instanceof Error) {
            errorMessage = error.message;
        } else if (typeof error === 'object' && error.message) {
            errorMessage = error.message;
        } else if (typeof error === 'string') {
            errorMessage = error;
        }
        
        this.updateStatus('error', `Error: ${errorMessage}`);
        this.log('ERROR:', errorMessage);
        
        // Show detailed error
        if (error.detail) {
            this.log('Detailed error:', error.detail);
        }
    }
    
    log(...args) {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
        ).join(' ')}`;
        
        console.log(logMessage);
        
        // Add to debug panel
        const currentLog = this.debugLog.textContent;
        this.debugLog.textContent = currentLog + '\n' + logMessage;
        
        // Keep last 100 lines
        const lines = this.debugLog.textContent.split('\n');
        if (lines.length > 100) {
            this.debugLog.textContent = lines.slice(-100).join('\n');
        }
    }
    
    truncateUrl(url) {
        if (url.length <= 60) return url;
        return url.substring(0, 40) + '...' + url.substring(url.length - 20);
    }
}

// Initialize player when page loads
window.addEventListener('DOMContentLoaded', () => {
    window.drmPlayer = new DRMVideoPlayer();
});