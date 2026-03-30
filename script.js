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
        this.mpdData = null;
        
        this.init();
    }
    
    init() {
        this.initShakaPlayer();
        this.loadBtn.addEventListener('click', () => this.loadVideo());
        this.apiUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.loadVideo();
        });
        this.log('Player initialized. Ready to load video.');
    }
    
    initShakaPlayer() {
        if (!this.videoElement) return;
        
        if (!window.shaka) {
            this.updateStatus('error', 'Shaka Player not loaded');
            return;
        }
        
        this.player = new shaka.Player(this.videoElement);
        
        // Advanced DRM configuration
        this.player.configure({
            drm: {
                servers: {
                    'com.widevine.alpha': '' // Will be set dynamically
                },
                clearKeys: {},
                advanced: {},
                retryParameters: {
                    maxAttempts: 5,
                    baseDelay: 1000,
                    backoffFactor: 2
                },
                // Custom license request headers
                headers: {}
            },
            streaming: {
                rebufferingGoal: 2,
                bufferingGoal: 10,
                retryParameters: {
                    maxAttempts: 5,
                    baseDelay: 1000,
                    backoffFactor: 2
                },
                // Allow cross-origin credentials
                useNativeHlsOnSafari: false
            },
            manifest: {
                dash: {
                    clockSyncUri: '',
                    ignoreMinBufferTime: false,
                    defaultPresentationDelay: 0,
                    xlinkFailGracefully: true
                }
            },
            networking: {
                retryParameters: {
                    maxAttempts: 5,
                    baseDelay: 1000,
                    backoffFactor: 2
                }
            }
        });
        
        // Add error handler with detailed info
        this.player.addEventListener('error', (event) => {
            this.handleShakaError(event.detail);
        });
        
        // Add event listeners
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
        
        // Listen for DRM info
        this.player.getNetworkingEngine().registerRequestFilter((type, request) => {
            if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
                this.log('License request detected');
                this.log('License URL:', request.uris[0]);
                if (request.headers) {
                    this.log('License headers:', request.headers);
                }
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
            
            // First fetch and parse MPD to extract license URL and PSSH
            await this.fetchAndParseMPD(mpdUrl, token);
            
            // Update video info
            this.updateVideoInfo(videoData);
            
            // Load video
            await this.playVideo(mpdUrl, token);
            
        } catch (error) {
            this.handleError(error);
        }
    }
    
    async fetchAndParseMPD(mpdUrl, token) {
        try {
            const urlWithToken = `${mpdUrl}${mpdUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
            this.log('Fetching MPD:', urlWithToken);
            
            const response = await fetch(urlWithToken);
            const mpdText = await response.text();
            
            this.log('MPD fetched, parsing...');
            
            // Parse MPD XML
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(mpdText, 'text/xml');
            
            // Extract ContentProtection info
            const contentProtection = xmlDoc.getElementsByTagName('ContentProtection');
            this.log(`Found ${contentProtection.length} ContentProtection elements`);
            
            let licenseUrl = null;
            let pssh = null;
            
            for (let i = 0; i < contentProtection.length; i++) {
                const cp = contentProtection[i];
                const schemeIdUri = cp.getAttribute('schemeIdUri');
                
                this.log(`ContentProtection ${i}: schemeIdUri=${schemeIdUri}`);
                
                // Check for Widevine
                if (schemeIdUri === 'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed') {
                    // Extract PSSH from cenc:pssh
                    const psshElement = cp.getElementsByTagName('cenc:pssh')[0];
                    if (psshElement) {
                        pssh = psshElement.textContent;
                        this.log(`Found Widevine PSSH: ${pssh.substring(0, 50)}...`);
                    }
                }
                
                // Look for license URL in various places
                const laUrl = cp.getElementsByTagName('ms:laurl')[0] || 
                             cp.getElementsByTagName('dashif:laurl')[0] ||
                             cp.getElementsByTagName('LicenseUrl')[0];
                
                if (laUrl) {
                    licenseUrl = laUrl.getAttribute('licenseUrl') || laUrl.textContent;
                    this.log(`Found license URL: ${licenseUrl}`);
                }
            }
            
            // Check for common license URL locations in MPD
            if (!licenseUrl) {
                const location = xmlDoc.getElementsByTagName('Location');
                if (location.length > 0) {
                    licenseUrl = location[0].textContent;
                    this.log(`Found Location: ${licenseUrl}`);
                }
            }
            
            // Store for later use
            this.mpdData = {
                licenseUrl: licenseUrl,
                pssh: pssh,
                mpdXml: mpdText
            };
            
            // If we found license URL, configure DRM
            if (licenseUrl) {
                this.log(`Configuring DRM with license URL: ${licenseUrl}`);
                this.player.configure({
                    drm: {
                        servers: {
                            'com.widevine.alpha': licenseUrl
                        }
                    }
                });
            } else {
                this.log('No license URL found in MPD, will try to extract from player_params');
            }
            
            // Log full MPD structure for debugging
            this.log('MPD structure:', {
                rootElement: xmlDoc.documentElement.nodeName,
                contentProtectionCount: contentProtection.length,
                hasLicenseUrl: !!licenseUrl,
                hasPSSH: !!pssh
            });
            
        } catch (error) {
            this.log('Error parsing MPD:', error);
            // Continue anyway, maybe player will handle
        }
    }
    
    async playVideo(mpdUrl, token) {
        this.updateStatus('loading', 'Loading video stream...');
        
        try {
            // Try different methods to pass token
            const urlWithToken = `${mpdUrl}${mpdUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
            
            // Configure networking to add token to all requests
            const netEngine = this.player.getNetworkingEngine();
            
            // Add request filter to inject token in headers
            netEngine.registerRequestFilter((type, request) => {
                // Add token to all requests
                request.headers['Authorization'] = `Bearer ${token}`;
                request.headers['X-Token'] = token;
                
                if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
                    this.log('Sending license request with token');
                    // Add token to license request body if needed
                    if (request.body && this.mpdData && this.mpdData.pssh) {
                        try {
                            const body = JSON.parse(request.body);
                            body.token = token;
                            request.body = JSON.stringify(body);
                        } catch(e) {
                            // If not JSON, add as form data
                            if (request.body instanceof ArrayBuffer) {
                                const str = new TextDecoder().decode(request.body);
                                request.body = new TextEncoder().encode(str + `&token=${token}`);
                            }
                        }
                    }
                }
            });
            
            this.log('Loading MPD with token in URL and headers');
            
            // Try to load
            await this.player.load(urlWithToken);
            
            this.playerContainer.style.display = 'block';
            this.updateStatus('success', 'Video loaded successfully! Playing...');
            
            // Try to autoplay
            this.videoElement.play().catch(e => {
                this.log('Auto-play blocked, user interaction needed');
            });
            
        } catch (error) {
            // If fails, try without token in URL
            this.log('First method failed, trying without URL token...');
            
            try {
                await this.player.load(mpdUrl);
                this.playerContainer.style.display = 'block';
                this.updateStatus('success', 'Video loaded with header auth only!');
            } catch (altError) {
                throw new Error(`Failed to load video: ${altError.message}`);
            }
        }
    }
    
    handleShakaError(error) {
        this.log('Shaka Error:', error);
        
        let errorMessage = '';
        let errorCode = '';
        
        if (error && error.detail) {
            const detail = error.detail;
            errorCode = detail.code || 'Unknown';
            
            switch(errorCode) {
                case 1000:
                    errorMessage = 'Network error - Check your internet connection';
                    break;
                case 1001:
                    errorMessage = 'Manifest request failed - MPD file not accessible';
                    break;
                case 1002:
                    errorMessage = 'Manifest parse failed - Invalid MPD format';
                    break;
                case 2000:
                    errorMessage = 'DRM license server error - License request failed';
                    break;
                case 6007:
                    errorMessage = 'DRM license request failed - Check token and license server';
                    this.log('Possible issues:');
                    this.log('- License server URL not found in MPD');
                    this.log('- Token expired or invalid');
                    this.log('- CORS issues with license server');
                    this.log('- Widevine not supported in this browser');
                    break;
                case 6010:
                    errorMessage = 'DRM session not created - Missing PSSH data';
                    break;
                default:
                    errorMessage = `Error ${errorCode}: ${detail.message || 'Unknown error'}`;
            }
        } else {
            errorMessage = error.message || 'Unknown error';
        }
        
        this.updateStatus('error', `Shaka Error ${errorCode}: ${errorMessage}`);
        
        // Suggest solutions
        if (errorCode === 6007) {
            this.log('\n💡 SOLUTIONS:');
            this.log('1. Check if token is still valid');
            this.log('2. Verify license server URL is accessible');
            this.log('3. Try with Chrome browser (best Widevine support)');
            this.log('4. Check if the video URL is still active');
            this.log('5. Open browser console for more details');
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
        if (lines.length > 100) {
            this.debugLog.textContent = lines.slice(-100).join('\n');
        }
    }
    
    truncateUrl(url) {
        if (url.length <= 60) return url;
        return url.substring(0, 40) + '...' + url.substring(url.length - 20);
    }
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    window.drmPlayer = new DRMVideoPlayer();
});