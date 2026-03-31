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
        
        // Store current video data for download
        this.currentMpdUrl = null;
        this.currentToken = null;
        this.currentVideoData = null;
        
        this.init();
    }
    
    init() {
        this.initShakaPlayer();
        this.loadBtn.addEventListener('click', () => this.loadVideo());
        this.apiUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.loadVideo();
        });
        
        // Add download button if it doesn't exist
        this.addDownloadButton();
        
        this.log('Player initialized. Ready to load video.');
        this.log(`License server: ${this.licenseServerUrl}`);
    }
    
    addDownloadButton() {
        // Check if download button already exists
        if (document.getElementById('downloadBtn')) return;
        
        const inputGroup = document.querySelector('.input-group');
        if (inputGroup) {
            const downloadBtn = document.createElement('button');
            downloadBtn.id = 'downloadBtn';
            downloadBtn.className = 'btn-primary';
            downloadBtn.style.background = 'linear-gradient(135deg, #28a745 0%, #20c997 100%)';
            downloadBtn.style.marginLeft = '10px';
            downloadBtn.textContent = '⬇ Download Merged Video';
            downloadBtn.disabled = true;
            downloadBtn.onclick = () => this.downloadAndMergeSegments();
            inputGroup.appendChild(downloadBtn);
            
            // Add progress area
            const progressArea = document.createElement('div');
            progressArea.id = 'downloadProgressArea';
            progressArea.style.cssText = 'margin-top: 12px; display: none;';
            progressArea.innerHTML = `
                <div style="font-size: 13px; color: #495057; margin-bottom: 5px;" id="downloadStatusText">Preparing download...</div>
                <div style="background: #e9ecef; border-radius: 20px; overflow: hidden; height: 8px;">
                    <div id="downloadProgressBar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #28a745, #20c997); transition: width 0.3s;"></div>
                </div>
            `;
            inputGroup.parentNode.insertBefore(progressArea, inputGroup.nextSibling);
            
            this.downloadBtn = downloadBtn;
            this.progressArea = progressArea;
            this.downloadStatusText = document.getElementById('downloadStatusText');
            this.downloadProgressBar = document.getElementById('downloadProgressBar');
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
        
        // Add manifest request filter to add token to MPD request
        const netEngine = this.player.getNetworkingEngine();
        if (netEngine) {
            netEngine.registerRequestFilter((type, request) => {
                // Add token to manifest requests too!
                if (type === window.shaka.net.NetworkingEngine.RequestType.MANIFEST) {
                    if (this.currentToken) {
                        this.log('🔐 Adding token to MANIFEST request');
                        const separator = request.uris[0].includes('?') ? '&' : '?';
                        request.uris[0] = `${request.uris[0]}${separator}token=${encodeURIComponent(this.currentToken)}`;
                    }
                }
                
                if (type === window.shaka.net.NetworkingEngine.RequestType.LICENSE) {
                    this.log('🔐 Adding token to license request');
                    request.headers['pallycon-customdata-v2'] = this.currentToken;
                    request.headers['Origin'] = window.location.origin;
                    request.headers['X-Requested-With'] = 'XMLHttpRequest';
                }
                
                // Also add token to segment requests if needed
                if (type === window.shaka.net.NetworkingEngine.RequestType.SEGMENT) {
                    if (this.currentToken && !request.uris[0].includes('token=')) {
                        const separator = request.uris[0].includes('?') ? '&' : '?';
                        request.uris[0] = `${request.uris[0]}${separator}token=${encodeURIComponent(this.currentToken)}`;
                    }
                }
            });
        }
        
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
        
        if (this.downloadBtn) this.downloadBtn.disabled = true;
        
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
            
            this.currentMpdUrl = mpdUrl;
            this.currentToken = token;
            this.currentVideoData = videoData;
            
            this.log(`MPD URL: ${mpdUrl}`);
            this.log(`Token: ${token.substring(0, 50)}...`);
            
            this.updateVideoInfo(videoData);
            await this.playVideo(mpdUrl, token);
            
            if (this.downloadBtn) this.downloadBtn.disabled = false;
            
        } catch (error) {
            this.handleError(error);
            if (this.downloadBtn) this.downloadBtn.disabled = true;
        }
    }
    
    async playVideo(mpdUrl, token) {
        this.updateStatus('loading', 'Loading DRM video...');
        
        try {
            // Load MPD with token in URL
            const urlWithToken = `${mpdUrl}${mpdUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
            this.log(`Loading MPD with token...`);
            
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
    
    // NEW: Download and merge all segments
    async downloadAndMergeSegments() {
        if (!this.currentMpdUrl || !this.currentToken) {
            this.updateStatus('error', 'No video loaded. Please load a video first.');
            return;
        }
        
        if (this.downloadBtn) this.downloadBtn.disabled = true;
        if (this.progressArea) this.progressArea.style.display = 'block';
        if (this.downloadStatusText) this.downloadStatusText.innerText = 'Fetching MPD manifest...';
        if (this.downloadProgressBar) this.downloadProgressBar.style.width = '0%';
        
        this.log("Starting full segment download & merge...");
        
        try {
            // 1. Fetch MPD with token
            const mpdUrlWithToken = `${this.currentMpdUrl}${this.currentMpdUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.currentToken)}`;
            const mpdResponse = await fetch(mpdUrlWithToken, {
                headers: {
                    'Origin': window.location.origin,
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });
            const mpdText = await mpdResponse.text();
            this.log("MPD fetched, parsing segments...");
            
            // 2. Parse MPD
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(mpdText, "text/xml");
            
            // Get base URL
            let baseUrl = '';
            const baseUrlElem = xmlDoc.querySelector('BaseURL');
            if (baseUrlElem) baseUrl = baseUrlElem.textContent.trim();
            
            // Find video AdaptationSet
            const periods = xmlDoc.querySelectorAll('Period');
            let segmentUrls = [];
            let initializationUrl = null;
            
            for (let period of periods) {
                const adaptationSets = period.querySelectorAll('AdaptationSet');
                for (let as of adaptationSets) {
                    const mimeType = as.getAttribute('mimeType') || '';
                    if (mimeType.includes('video') || segmentUrls.length === 0) {
                        const representation = as.querySelector('Representation');
                        if (!representation) continue;
                        
                        // Check for SegmentTemplate
                        let segmentTemplate = representation.querySelector('SegmentTemplate');
                        if (!segmentTemplate) segmentTemplate = as.querySelector('SegmentTemplate');
                        
                        if (segmentTemplate) {
                            const mediaTemplate = segmentTemplate.getAttribute('media');
                            const initialization = segmentTemplate.getAttribute('initialization');
                            const startNumber = parseInt(segmentTemplate.getAttribute('startNumber') || '1');
                            
                            // Get initialization URL
                            if (initialization) {
                                let initUrl = initialization.replace('$RepresentationID$', representation.getAttribute('id') || '');
                                initUrl = initUrl.replace('$Bandwidth$', representation.getAttribute('bandwidth') || '');
                                initUrl = this.resolveUrl(initUrl, baseUrl, this.currentMpdUrl);
                                initializationUrl = initUrl;
                            }
                            
                            // Check for SegmentTimeline
                            const timeline = segmentTemplate.querySelector('SegmentTimeline');
                            if (timeline) {
                                const sElements = timeline.querySelectorAll('S');
                                let idx = startNumber;
                                for (let s of sElements) {
                                    const repeat = parseInt(s.getAttribute('r') || '0');
                                    for (let i = 0; i <= repeat; i++) {
                                        let segUrl = mediaTemplate.replace('$Number$', idx);
                                        segUrl = segUrl.replace('$RepresentationID$', representation.getAttribute('id') || '');
                                        segUrl = segUrl.replace('$Bandwidth$', representation.getAttribute('bandwidth') || '');
                                        segUrl = this.resolveUrl(segUrl, baseUrl, this.currentMpdUrl);
                                        segmentUrls.push(segUrl);
                                        idx++;
                                    }
                                }
                            } else {
                                // Estimate segments (up to 500)
                                for (let i = startNumber; i < startNumber + 500; i++) {
                                    let segUrl = mediaTemplate.replace('$Number$', i);
                                    segUrl = segUrl.replace('$RepresentationID$', representation.getAttribute('id') || '');
                                    segUrl = this.resolveUrl(segUrl, baseUrl, this.currentMpdUrl);
                                    segmentUrls.push(segUrl);
                                }
                            }
                            break;
                        }
                        
                        // Check for SegmentList
                        const segmentList = representation.querySelector('SegmentList');
                        if (segmentList) {
                            const segUrls = segmentList.querySelectorAll('SegmentURL');
                            for (let seg of segUrls) {
                                let mediaUrl = seg.getAttribute('media');
                                mediaUrl = this.resolveUrl(mediaUrl, baseUrl, this.currentMpdUrl);
                                segmentUrls.push(mediaUrl);
                            }
                            
                            const initSeg = segmentList.querySelector('Initialization');
                            if (initSeg && initSeg.getAttribute('sourceURL')) {
                                initializationUrl = this.resolveUrl(initSeg.getAttribute('sourceURL'), baseUrl, this.currentMpdUrl);
                            }
                            break;
                        }
                    }
                }
                if (segmentUrls.length > 0) break;
            }
            
            if (segmentUrls.length === 0) {
                throw new Error("No segment URLs extracted from MPD");
            }
            
            this.log(`Extracted ${segmentUrls.length} segment URLs`);
            if (initializationUrl) this.log(`Init URL: ${initializationUrl.substring(0, 80)}...`);
            
            // Download and merge all segments
            let mergedBuffer = new Uint8Array(0);
            
            // Download initialization segment first
            if (initializationUrl) {
                if (this.downloadStatusText) this.downloadStatusText.innerText = 'Downloading initialization segment...';
                try {
                    const initData = await this.downloadSegmentWithToken(initializationUrl);
                    mergedBuffer = this.concatBuffers(mergedBuffer, initData);
                    this.log(`Init segment: ${initData.length} bytes`);
                } catch (e) {
                    this.log(`Init segment failed: ${e.message}, continuing...`);
                }
            }
            
            // Download all media segments
            let downloaded = 0;
            for (let i = 0; i < segmentUrls.length; i++) {
                const segUrl = segmentUrls[i];
                if (this.downloadStatusText) {
                    this.downloadStatusText.innerText = `Downloading segment ${i+1}/${segmentUrls.length}`;
                }
                if (this.downloadProgressBar) {
                    const percent = (i / segmentUrls.length) * 100;
                    this.downloadProgressBar.style.width = `${percent}%`;
                }
                
                try {
                    const segData = await this.downloadSegmentWithToken(segUrl);
                    mergedBuffer = this.concatBuffers(mergedBuffer, segData);
                    downloaded++;
                } catch (err) {
                    this.log(`Segment ${i+1} failed: ${err.message}, stopping at ${downloaded} segments`);
                    break;
                }
            }
            
            if (this.downloadProgressBar) this.downloadProgressBar.style.width = '100%';
            if (this.downloadStatusText) {
                this.downloadStatusText.innerText = `Creating video file from ${downloaded} segments...`;
            }
            
            // Determine file extension
            const firstSeg = segmentUrls[0] || '';
            const isTs = firstSeg.includes('.ts') || firstSeg.endsWith('.ts');
            const extension = isTs ? 'ts' : 'mp4';
            const mimeType = isTs ? 'video/mp2t' : 'video/mp4';
            
            // Create and trigger download
            const blob = new Blob([mergedBuffer], { type: mimeType });
            const downloadUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const fileName = this.currentVideoData?.title 
                ? this.currentVideoData.title.replace(/[^a-z0-9]/gi, '_') 
                : `video_${Date.now()}`;
            a.download = `${fileName}_merged.${extension}`;
            a.href = downloadUrl;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);
            
            if (this.downloadStatusText) {
                const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
                this.downloadStatusText.innerText = `✅ Download complete! ${sizeMB} MB saved.`;
            }
            this.log(`✅ Download finished: ${downloaded}/${segmentUrls.length} segments merged, ${(blob.size / (1024*1024)).toFixed(2)} MB`);
            this.updateStatus('success', 'Video downloaded & merged!');
            
        } catch (error) {
            this.log("Download error:", error);
            if (this.downloadStatusText) {
                this.downloadStatusText.innerText = `❌ Error: ${error.message}`;
            }
            this.updateStatus('error', `Download failed: ${error.message}`);
        } finally {
            if (this.downloadBtn) this.downloadBtn.disabled = false;
            setTimeout(() => {
                if (this.progressArea) this.progressArea.style.display = 'none';
            }, 5000);
        }
    }
    
    async downloadSegmentWithToken(url) {
        const separator = url.includes('?') ? '&' : '?';
        const urlWithToken = `${url}${separator}token=${encodeURIComponent(this.currentToken)}`;
        
        const response = await fetch(urlWithToken, {
            headers: {
                'Origin': window.location.origin,
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        return new Uint8Array(await response.arrayBuffer());
    }
    
    resolveUrl(relativeUrl, baseUrl, mpdBaseUrl) {
        if (!relativeUrl) return '';
        if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
            return relativeUrl;
        }
        
        // Try baseUrl from MPD
        if (baseUrl && (baseUrl.startsWith('http://') || baseUrl.startsWith('https://'))) {
            const basePath = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
            return basePath + relativeUrl;
        }
        
        // Fallback to MPD directory
        const mpdPath = mpdBaseUrl.substring(0, mpdBaseUrl.lastIndexOf('/') + 1);
        return mpdPath + relativeUrl;
    }
    
    concatBuffers(a, b) {
        const result = new Uint8Array(a.length + b.length);
        result.set(a, 0);
        result.set(b, a.length);
        return result;
    }
    
    handleShakaError(error) {
        this.log('Shaka Error:', error);
        
        let errorMessage = '';
        let errorCode = error.code || (error.detail ? error.detail.code : 'Unknown');
        
        switch(errorCode) {
            case 6001:
                errorMessage = 'Manifest request failed - Token may be invalid or expired';
                this.log('💡 Make sure token is added to MPD URL');
                break;
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
                <div><strong>⬇ Download:</strong> Click green button after video loads</div>
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